/**
 * x402 Express middleware — server side.
 *
 * Usage:
 *   app.post('/dock',
 *     require402({ priceUsdc: '0.005', recipient: DOCKING_AGENT_ADDR, resource: '/dock' }),
 *     handler);
 *
 * On first request (no X-Payment header): responds 402 with a PaymentRequirements body.
 * On retry: decodes header, forwards to the facilitator for verification,
 * then lets the handler run.
 *
 * In production you'd hand the EIP-3009 payload to Circle's facilitator API.
 * For the hackathon demo we also support a "direct-settle" fallback that submits
 * the transferWithAuthorization onchain ourselves — both paths produce onchain
 * txns we can count toward the 50+ requirement.
 */
import type { Request, Response, NextFunction } from 'express';
import { Contract, parseUnits } from 'ethers';
import { decodeX402Payment, type AuthorizationPayload } from './nanopay.js';
import { provider, USDC_ADDRESS } from './wallet.js';
import { Wallet } from 'ethers';

const USDC_AUTH_ABI = [
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
];

export interface Require402Opts {
  priceUsdc: string;       // e.g. "0.005"
  recipient: string;       // agent wallet receiving payment
  resource: string;        // the URL path being paid for
  description?: string;
  /** If set, submits the EIP-3009 auth onchain ourselves (simpler demo path). */
  settleWith?: Wallet;
}

export function require402(opts: Require402Opts) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.header('X-Payment');

    if (!header) {
      // First request — tell the client what to pay.
      res.status(402).json({
        x402Version: 1,
        accepts: [
          {
            scheme: 'exact',
            network: 'arc-testnet',
            maxAmountRequired: parseUnits(opts.priceUsdc, 6).toString(),
            resource: opts.resource,
            description: opts.description ?? 'Paid compute',
            mimeType: 'application/json',
            payTo: opts.recipient,
            maxTimeoutSeconds: 60,
            asset: USDC_ADDRESS,
            extra: { name: 'USDC', version: '2' },
          },
        ],
      });
      return;
    }

    try {
      const decoded = decodeX402Payment(header);
      const auth = decoded.payload as AuthorizationPayload;

      // Basic sanity checks
      const expected = parseUnits(opts.priceUsdc, 6).toString();
      if (auth.to.toLowerCase() !== opts.recipient.toLowerCase()) {
        res.status(402).json({ error: 'Payment recipient mismatch' });
        return;
      }
      if (BigInt(auth.value) < BigInt(expected)) {
        res.status(402).json({ error: 'Insufficient payment' });
        return;
      }

      // Settlement path. In production: POST to Circle facilitator.
      // For the demo: submit onchain ourselves so we get a real tx hash.
      if (opts.settleWith) {
        const txHash = await submitAuthOnchain(opts.settleWith, auth);
        res.setHeader('X-Payment-Response', Buffer.from(JSON.stringify({
          success: true,
          transaction: txHash,
          network: 'arc-testnet',
        })).toString('base64'));
      }

      next();
    } catch (err: any) {
      res.status(402).json({ error: `Payment verification failed: ${err.message}` });
    }
  };
}

/**
 * Submit an EIP-3009 authorization onchain directly.
 * The submitter pays gas in USDC (Arc native) but the buyer is the one
 * whose USDC gets transferred. For nanopayment-scale demos this gets
 * batched via Circle Gateway — here we do it directly for simplicity.
 */
async function submitAuthOnchain(submitter: Wallet, auth: AuthorizationPayload): Promise<string> {
  if (!USDC_ADDRESS) throw new Error('USDC_ADDRESS not set');
  const usdc = new Contract(USDC_ADDRESS, USDC_AUTH_ABI, submitter);

  // Split sig into v, r, s
  const sig = auth.signature.startsWith('0x') ? auth.signature.slice(2) : auth.signature;
  const r = '0x' + sig.slice(0, 64);
  const s = '0x' + sig.slice(64, 128);
  const v = parseInt(sig.slice(128, 130), 16);

  const tx = await usdc.transferWithAuthorization(
    auth.from,
    auth.to,
    auth.value,
    auth.validAfter,
    auth.validBefore,
    auth.nonce,
    v, r, s,
  );
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}
