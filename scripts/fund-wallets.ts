/**
 * Fund agent wallets.
 *
 * After you faucet the BUYER address at https://faucet.circle.com, run this
 * to split a little USDC to each agent so they can pay gas for submitting
 * EIP-3009 authorizations.
 *
 *   npm run fund
 *
 * Not strictly needed if Circle Gateway is batching settlement — but for the
 * direct-submit path each agent needs enough USDC to cover its own gas.
 */
import 'dotenv/config';
import { walletFromEnv, directUsdcTransfer, usdcBalance, explorerTx } from '../src/payments/wallet.js';

const AGENT_ENVS = ['ORCHESTRATOR', 'DOCKING_AGENT', 'ADMET_AGENT', 'VALIDATOR_AGENT'];
const FUND_PER_AGENT = '0.5'; // USDC — enough for hundreds of gas-paid tx on Arc

async function main() {
  const buyer = walletFromEnv('BUYER_PRIVATE_KEY');
  const buyerBal = await usdcBalance(buyer.address);
  console.log(`[fund] buyer ${buyer.address} balance: ${buyerBal} USDC`);

  if (Number(buyerBal) < AGENT_ENVS.length * Number(FUND_PER_AGENT)) {
    console.error(
      `[fund] buyer needs ≥ ${AGENT_ENVS.length * Number(FUND_PER_AGENT)} USDC ` +
        `to fund all agents. Use https://faucet.circle.com first.`,
    );
    process.exit(1);
  }

  for (const role of AGENT_ENVS) {
    const addr = process.env[`${role}_ADDRESS`];
    if (!addr) {
      console.error(`[fund] ${role}_ADDRESS missing from .env`);
      continue;
    }
    console.log(`[fund] sending ${FUND_PER_AGENT} USDC → ${role} (${addr})`);
    const hash = await directUsdcTransfer(buyer, addr, FUND_PER_AGENT);
    console.log(`        tx: ${explorerTx(hash)}`);
  }

  console.log('[fund] done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
