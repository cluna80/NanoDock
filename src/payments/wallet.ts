/**
 * Wallet + Arc chain helpers.
 *
 * NanoDock uses a multi-wallet architecture: every agent in the pipeline
 * (Orchestrator, Docking, ADMET, Validator) runs as its own onchain identity
 * with its own Circle Wallet / ethers.Wallet. This is what makes the
 * agent-to-agent payment loop work — each hop is a real USDC transfer.
 */
import { JsonRpcProvider, Wallet, Contract, formatUnits, parseUnits } from 'ethers';
import 'dotenv/config';

// Minimal ERC-20 ABI — Arc uses USDC as native gas, but balance/transfer
// still goes through the USDC contract for non-gas operations.
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

export const RPC_URL = process.env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
export const CHAIN_ID = Number(process.env.ARC_CHAIN_ID ?? 5042002);
export const USDC_ADDRESS = process.env.USDC_ADDRESS ?? '';
export const EXPLORER = process.env.ARC_EXPLORER ?? 'https://testnet.arcscan.app';

/** Shared provider — cheap to reuse. */
export const provider = new JsonRpcProvider(RPC_URL, {
  chainId: CHAIN_ID,
  name: 'arc-testnet',
});

/** Build a Wallet from a private-key env var. Throws if missing. */
export function walletFromEnv(envKey: string): Wallet {
  const pk = process.env[envKey];
  if (!pk) throw new Error(`Missing ${envKey} in .env`);
  return new Wallet(pk, provider);
}

/** Read USDC balance (returns a decimal string, e.g. "9.872341"). */
export async function usdcBalance(address: string): Promise<string> {
  if (!USDC_ADDRESS) throw new Error('USDC_ADDRESS not set in .env');
  const token = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const [raw, decimals] = await Promise.all([
    token.balanceOf(address),
    token.decimals(),
  ]);
  return formatUnits(raw, decimals);
}

/** Direct onchain USDC transfer (non-nanopayment path). Used for agent funding only. */
export async function directUsdcTransfer(
  signer: Wallet,
  to: string,
  amountUsdc: string,
): Promise<string> {
  if (!USDC_ADDRESS) throw new Error('USDC_ADDRESS not set in .env');
  const token = new Contract(USDC_ADDRESS, ERC20_ABI, signer);
  const decimals: number = await token.decimals();
  const amount = parseUnits(amountUsdc, decimals);
  const tx = await token.transfer(to, amount);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/** Build an Arcscan URL for a tx hash — useful for demo video. */
export function explorerTx(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}
