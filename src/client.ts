/**
 * NanoDock x402 client.
 *
 * Standalone runner for a single request. For bulk demo runs, use scripts/run-demo.ts.
 *
 * Usage:
 *   npm run client -- "CCO" EGFR
 */
import 'dotenv/config';
import { walletFromEnv } from './payments/wallet.js';
import { signUsdcAuthorization, encodeX402Payment } from './payments/nanopay.js';

const SERVER = process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402';

export async function paidPost(
  url: string,
  body: any,
  buyerPkEnv: string,
): Promise<any> {
  const buyer = walletFromEnv(buyerPkEnv);

  // Step 1: unauthenticated request — server responds 402 with price details.
  let resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (resp.status !== 402) {
    // Either the endpoint isn't paid, or we got an error.
    return resp.json();
  }

  const paymentReqs = await resp.json();
  const req = paymentReqs.accepts[0];

  // Step 2: sign an EIP-3009 authorization for the quoted amount.
  const priceUsdc = (Number(req.maxAmountRequired) / 1e6).toString();
  const auth = await signUsdcAuthorization(buyer, req.payTo, priceUsdc);
  const header = encodeX402Payment(auth);

  // Step 3: retry with payment.
  resp = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': header,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  const paymentResponseHeader = resp.headers.get('x-payment-response');
  if (paymentResponseHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(paymentResponseHeader, 'base64').toString('utf8'));
      data._txHash = decoded.transaction;
    } catch { /* ignore */ }
  }
  return data;
}

async function main() {
  const smiles = process.argv[2] ?? 'CCO';
  const target = process.argv[3] ?? 'EGFR';

  console.log(`[client] paying for /screen on ${smiles} vs ${target}...`);
  const out = await paidPost(`${SERVER}/screen`, { smiles, target }, 'BUYER_PRIVATE_KEY');
  console.log(JSON.stringify(out, null, 2));
}

// Only run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
