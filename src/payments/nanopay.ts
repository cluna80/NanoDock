/**
 * EIP-3009 `transferWithAuthorization` signer.
 *
 * This is the offchain-signature primitive that Circle Nanopayments uses.
 * The buyer signs a typed-data authorization; the facilitator (Circle Gateway)
 * validates it, adjusts an internal ledger, and batches onchain settlement.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-3009
 *
 * Once this function returns a signature, the buyer has "paid" from the
 * seller's point of view — settlement happens later, gas-free from the
 * buyer/seller perspective (amortized across a batch).
 */
import { Wallet, parseUnits, hexlify, randomBytes } from 'ethers';
import { CHAIN_ID, USDC_ADDRESS } from './wallet.js';

export interface AuthorizationPayload {
  from: string;
  to: string;
  value: string;           // raw units string (e.g. "5000" for 0.005 USDC @ 6 decimals)
  validAfter: number;      // unix seconds
  validBefore: number;     // unix seconds
  nonce: string;           // 0x-prefixed 32-byte hex
  signature: string;       // 65-byte 0x-prefixed
}

/**
 * Sign an EIP-3009 transferWithAuthorization message.
 *
 * This is what flows into x402's X-Payment header. The facilitator decodes it,
 * validates the signature against the USDC contract's DOMAIN_SEPARATOR, and
 * either settles immediately or batches it.
 */
export async function signUsdcAuthorization(
  buyer: Wallet,
  recipient: string,
  amountUsdc: string,
  opts?: { validForSeconds?: number },
): Promise<AuthorizationPayload> {
  if (!USDC_ADDRESS) throw new Error('USDC_ADDRESS not set in .env');

  const now = Math.floor(Date.now() / 1000);
  const validForSeconds = opts?.validForSeconds ?? 60 * 10; // 10 min default

  // Raw units — USDC is 6 decimals on Arc.
  const value = parseUnits(amountUsdc, 6).toString();
  const nonce = hexlify(randomBytes(32));
  const validAfter = now - 5;
  const validBefore = now + validForSeconds;

  const domain = {
    name: 'USDC',
    version: '2',
    chainId: CHAIN_ID,
    verifyingContract: USDC_ADDRESS,
  };

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  };

  const message = {
    from: buyer.address,
    to: recipient,
    value,
    validAfter,
    validBefore,
    nonce,
  };

  const signature = await buyer.signTypedData(domain, types, message);

  return {
    from: buyer.address,
    to: recipient,
    value,
    validAfter,
    validBefore,
    nonce,
    signature,
  };
}

/**
 * Encode the payload for the x402 `X-Payment` header.
 * x402 spec: base64-encoded JSON of the payment payload.
 */
export function encodeX402Payment(auth: AuthorizationPayload): string {
  const payload = {
    scheme: 'exact',
    network: 'arc-testnet',
    asset: USDC_ADDRESS,
    payload: auth,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** Decode the header server-side. */
export function decodeX402Payment(header: string): {
  scheme: string;
  network: string;
  asset: string;
  payload: AuthorizationPayload;
} {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
}
