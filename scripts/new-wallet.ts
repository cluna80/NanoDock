/**
 * Generate fresh wallets for every role (buyer + 4 agents).
 *
 * Prints to stdout in .env format. Redirect to append to your .env:
 *     npm run wallets:new >> .env.wallets
 *
 * DO NOT commit the output. These keys go in your gitignored .env.
 */
import { Wallet } from 'ethers';

const roles = [
  'BUYER',
  'ORCHESTRATOR',
  'DOCKING_AGENT',
  'ADMET_AGENT',
  'VALIDATOR_AGENT',
];

console.log(`# Generated ${new Date().toISOString()}`);
console.log('# Fund each address at https://faucet.circle.com (select Arc testnet)');
console.log();

for (const role of roles) {
  const w = Wallet.createRandom();
  const suffix = role === 'BUYER' ? '' : '_ADDRESS';
  console.log(`${role}_PRIVATE_KEY=${w.privateKey}`);
  if (role !== 'BUYER') {
    console.log(`${role}_ADDRESS=${w.address}`);
  } else {
    console.log(`# Buyer address: ${w.address}`);
  }
  console.log();
}

console.log('# Fund all FIVE addresses above on https://faucet.circle.com before running the demo.');
