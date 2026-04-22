/**
 * ERC-8004 Trustless Agents — Identity + Reputation client.
 *
 * Registry addresses on Arc Testnet (from erc-8004/erc-8004-contracts README,
 * same CREATE2-deterministic addresses across every testnet):
 *
 *   IdentityRegistry:   0x8004A818BFB912233c491871b3d84c89A494BD9e
 *   ReputationRegistry: 0x8004B663056A597Dffe9eCcC1965A193B7388713
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8004
 * Source: https://github.com/erc-8004/erc-8004-contracts
 *
 * What this gives NanoDock:
 *   1. Each of our 4 agents gets a portable on-chain identity NFT.
 *   2. After every successful /screen call, the buyer posts reputation
 *      feedback keyed to that agent's agentId — building a public
 *      success-rate history for each agent across all campaigns.
 *   3. Other buyers (or other AI orchestrators) can look up an agent's
 *      reputation before deciding to hire it.
 *
 * The spec intentionally doesn't mandate a payment rail, but its registration
 * JSON includes a `proofOfPayment` field specifically designed for x402/USDC
 * — so this pairs naturally with Nanopayments.
 *
 * Minimal hand-rolled ABIs below. For production, pull the canonical ABI JSON
 * from https://github.com/erc-8004/erc-8004-contracts/tree/master/abis and
 * wire them in via `new Contract(addr, canonicalAbi, signer)`.
 */
import { Contract, type Wallet, type JsonRpcProvider } from 'ethers';
import { provider } from '../payments/wallet.js';

export const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
export const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713';

// ABI fragments for the subset of functions we actually call.
// Verify against /abis in the erc-8004-contracts repo before mainnet use.
const IDENTITY_ABI = [
  // mint a new agent NFT pointing to an off-chain registration file
  'function register(string agentURI) returns (uint256 agentId)',
  // update the URI on an already-registered agent
  'function setAgentURI(uint256 agentId, string agentURI)',
  // read the agent's current wallet (defaults to NFT owner, overridable)
  'function getAgentWallet(uint256 agentId) view returns (address)',
  // ERC-721 basics for sanity checks
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  // event to grab the agentId when we don't get it from the return value
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REPUTATION_ABI = [
  // post a feedback entry tied to an agentId
  'function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)',
  // aggregate feedback for an agent (requires non-empty clientAddresses to deter sybils)
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
  // read a single entry
  'function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex) view returns (int128 value, uint8 valueDecimals, string tag1, string tag2, bool isRevoked)',
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex)',
];

// ===== Identity Registry =====

export interface AgentRegistration {
  name: string;
  description: string;
  services: Array<{ type: string; endpoint: string }>;
  supportedTrust?: string[];
  /** x402 payment proof reference per ERC-8004 registration file spec. */
  proofOfPayment?: { scheme: string; asset: string; chainId: number };
}

/**
 * Build a minimal agent registration JSON document that conforms to the
 * ERC-8004 registration file shape. Returns a data: URI so we don't need
 * to set up IPFS for the hackathon demo. Swap for `ipfs://...` in prod.
 */
export function buildRegistrationUri(reg: AgentRegistration): string {
  const body = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: reg.name,
    description: reg.description,
    services: reg.services,
    supportedTrust: reg.supportedTrust ?? ['reputation'],
    proofOfPayment: reg.proofOfPayment,
  };
  const json = JSON.stringify(body);
  return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}

/**
 * Register an agent on the Identity Registry. Returns the minted agentId.
 *
 * The caller's wallet becomes the initial owner of the NFT and the default
 * agentWallet. Since each of our agents has its own private key, each agent
 * should register itself (i.e., pass its own Wallet as signer).
 */
export async function registerAgent(signer: Wallet, agentURI: string): Promise<bigint> {
  const reg = new Contract(IDENTITY_REGISTRY, IDENTITY_ABI, signer);

  // Some deployments return agentId directly; some only emit it via Transfer.
  // We rely on the Transfer event for robustness across ABI variants.
  const tx = await reg.register(agentURI);
  const receipt = await tx.wait();
  if (!receipt) throw new Error('register: no receipt');

  // Parse the Transfer event to get the tokenId that was minted to us.
  const iface = reg.interface;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === 'Transfer' && parsed.args.to.toLowerCase() === signer.address.toLowerCase()) {
        return BigInt(parsed.args.tokenId.toString());
      }
    } catch {
      // not our event, skip
    }
  }
  throw new Error('register: Transfer event not found in receipt');
}

export async function getAgentWallet(agentId: bigint): Promise<string> {
  const reg = new Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);
  return await reg.getAgentWallet(agentId);
}

// ===== Reputation Registry =====

export interface FeedbackInput {
  agentId: bigint;
  value: number;            // e.g. 95 for "95%"
  valueDecimals: number;    // e.g. 0 for integer score, 2 for percentage
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  feedbackURI?: string;
  feedbackHash?: string;    // 0x-prefixed 32-byte hex, or 0x00..00
}

/**
 * Post feedback to the Reputation Registry.
 *
 * IMPORTANT: the caller (signer) MUST NOT be the agent owner or an approved
 * operator. In NanoDock, the BUYER posts feedback about each agent —
 * orchestrator/docking/admet/validator are all different wallets, so this
 * works cleanly.
 */
export async function giveFeedback(signer: Wallet, fb: FeedbackInput): Promise<string> {
  const rep = new Contract(REPUTATION_REGISTRY, REPUTATION_ABI, signer);
  const tx = await rep.giveFeedback(
    fb.agentId,
    fb.value,
    fb.valueDecimals,
    fb.tag1 ?? '',
    fb.tag2 ?? '',
    fb.endpoint ?? '',
    fb.feedbackURI ?? '',
    fb.feedbackHash ?? '0x0000000000000000000000000000000000000000000000000000000000000000',
  );
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/**
 * Read aggregated feedback for an agent from a given set of clients.
 * Returns count + summary value + decimals.
 *
 * Spec requires a non-empty clientAddresses to deter sybil reputation farms.
 */
export async function getReputationSummary(
  agentId: bigint,
  clientAddresses: string[],
  tag1 = '',
  tag2 = '',
): Promise<{ count: number; value: number; decimals: number }> {
  if (clientAddresses.length === 0) {
    throw new Error('getReputationSummary: clientAddresses must be non-empty per ERC-8004 spec');
  }
  const rep = new Contract(REPUTATION_REGISTRY, REPUTATION_ABI, provider);
  const result = await rep.getSummary(agentId, clientAddresses, tag1, tag2);
  return {
    count: Number(result[0]),
    value: Number(result[1]),
    decimals: Number(result[2]),
  };
}

/** Convenience: format a summary as a human-readable decimal. */
export function formatSummary(summary: { value: number; decimals: number }): string {
  if (summary.decimals === 0) return summary.value.toString();
  return (summary.value / 10 ** summary.decimals).toFixed(summary.decimals);
}
