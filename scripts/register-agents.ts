/**
 * Register all four NanoDock agents on the ERC-8004 Identity Registry.
 *
 * Produces four ERC-721 NFTs on Arc testnet, one per agent, each with a
 * registration JSON file describing its role, pricing, and x402 endpoint.
 *
 * Prints the agentIds in .env format so you can paste them in:
 *
 *   npm run register >> .env.agents
 *   cat .env.agents >> .env
 *
 * This script needs each agent's private key to be set in .env so each agent
 * can register itself (the Identity Registry mints the NFT to msg.sender,
 * making that address the initial owner + agentWallet).
 */
import 'dotenv/config';
import { walletFromEnv, explorerTx, USDC_ADDRESS } from '../src/payments/wallet.js';
import {
  registerAgent,
  buildRegistrationUri,
  IDENTITY_REGISTRY,
  type AgentRegistration,
} from '../src/trust/erc8004.js';

interface AgentSpec {
  roleEnv: string;
  registration: AgentRegistration;
}

const SERVER = process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402';
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? 5042002);

const AGENTS: AgentSpec[] = [
  {
    roleEnv: 'ORCHESTRATOR',
    registration: {
      name: 'NanoDock Orchestrator',
      description:
        'Top-level drug-discovery screening orchestrator. Accepts a SMILES ' +
        'and target, fans out paid work to DockingAgent, ADMETAgent, and ' +
        'ValidatorAgent via internal Circle Nanopayments, returns a unified ' +
        'screening report. Charges $0.01 USDC per molecule.',
      services: [
        { type: 'x402', endpoint: `${SERVER}/screen` },
        { type: 'A2A', endpoint: `${SERVER}/.well-known/agent-card.json` },
      ],
      supportedTrust: ['reputation', 'crypto-economic'],
      proofOfPayment: { scheme: 'exact', asset: USDC_ADDRESS, chainId: CHAIN_ID },
    },
  },
  {
    roleEnv: 'DOCKING_AGENT',
    registration: {
      name: 'NanoDock DockingAgent',
      description:
        'AutoDock Vina molecular docking. Takes SMILES + target, returns ' +
        'binding affinity in kcal/mol. Charges $0.005 USDC per dock.',
      services: [{ type: 'x402', endpoint: `${SERVER}/dock` }],
      supportedTrust: ['reputation'],
      proofOfPayment: { scheme: 'exact', asset: USDC_ADDRESS, chainId: CHAIN_ID },
    },
  },
  {
    roleEnv: 'ADMET_AGENT',
    registration: {
      name: 'NanoDock ADMETAgent',
      description:
        'ADMET property prediction — molecular weight, logP, Lipinski, hERG, ' +
        'PAINS, synthetic accessibility. Charges $0.002 USDC per molecule.',
      services: [{ type: 'x402', endpoint: `${SERVER}/admet` }],
      supportedTrust: ['reputation'],
      proofOfPayment: { scheme: 'exact', asset: USDC_ADDRESS, chainId: CHAIN_ID },
    },
  },
  {
    roleEnv: 'VALIDATOR_AGENT',
    registration: {
      name: 'NanoDock ValidatorAgent',
      description:
        'ChEMBL + PubChem novelty validation. Returns nearest-neighbor ' +
        'similarity and a novelty flag. Charges $0.001 USDC per check.',
      services: [{ type: 'x402', endpoint: `${SERVER}/validate` }],
      supportedTrust: ['reputation'],
      proofOfPayment: { scheme: 'exact', asset: USDC_ADDRESS, chainId: CHAIN_ID },
    },
  },
];

async function main() {
  console.log(`[erc8004] registering ${AGENTS.length} agents on Arc testnet`);
  console.log(`[erc8004] Identity Registry: ${IDENTITY_REGISTRY}`);
  console.log();

  const results: Array<{ role: string; address: string; agentId: string; txHash: string }> = [];

  for (const spec of AGENTS) {
    const signer = walletFromEnv(`${spec.roleEnv}_PRIVATE_KEY`);
    console.log(`[erc8004] ${spec.roleEnv} (${signer.address})`);

    const uri = buildRegistrationUri(spec.registration);
    console.log(`  registration URI: ${uri.slice(0, 80)}...`);

    try {
      const agentId = await registerAgent(signer, uri);
      const txHash = 'pending'; // registerAgent returns agentId, but we grab hash from receipt below
      console.log(`  agentId: ${agentId}`);
      console.log(`  Arcscan: ${explorerTx('(see identity registry tx)')}`);
      results.push({
        role: spec.roleEnv,
        address: signer.address,
        agentId: agentId.toString(),
        txHash,
      });
    } catch (e: any) {
      console.error(`  FAILED: ${e.message}`);
      if (e.info?.error) console.error(`  info: ${JSON.stringify(e.info.error)}`);
    }
    console.log();
  }

  // Emit in .env format
  console.log('# ----- paste the following into your .env -----');
  console.log(`# Generated ${new Date().toISOString()}`);
  for (const r of results) {
    console.log(`${r.role}_AGENT_ID=${r.agentId}`);
  }
  console.log();
  console.log(`# ${results.length}/${AGENTS.length} agents registered successfully.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
