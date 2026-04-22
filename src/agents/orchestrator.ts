/**
 * OrchestratorAgent — the top-level agent the user pays.
 *
 * Flow:
 *   1. User pays Orchestrator $0.01 (one x402 call to /screen)
 *   2. Orchestrator pays DockingAgent $0.005 (internal x402 call)
 *   3. Orchestrator pays ADMETAgent $0.002 (internal x402 call)
 *   4. Orchestrator pays ValidatorAgent $0.001 (internal x402 call)
 *   5. Orchestrator keeps $0.002 margin and returns combined result
 *
 * Every hop is a real signed EIP-3009 authorization, settled via
 * Circle Nanopayments / our direct-submit fallback. Four txns per
 * screening request — a 25-molecule demo = 100 txns.
 */
import { Wallet } from 'ethers';
import { signUsdcAuthorization, encodeX402Payment } from '../payments/nanopay.js';
import { runDock, type DockResult } from './docking-agent.js';
import { runAdmet, type AdmetResult } from './admet-agent.js';
import { runValidate, type ValidationResult } from './validator-agent.js';

export interface ScreenResult {
  dock: DockResult;
  admet: AdmetResult;
  validation: ValidationResult;
  payments: Array<{ from: string; to: string; amount: string; label: string; txHash?: string }>;
}

/**
 * Given an already-paid-for user request, orchestrate the full pipeline,
 * spawning internal nanopayments to each sub-agent.
 *
 * `callPaid` is injected so we can reuse the real x402 client against
 * localhost during the demo, or swap in a fake for unit tests.
 */
export async function orchestrate(
  orchestratorWallet: Wallet,
  subAgentUrls: { docking: string; admet: string; validator: string },
  subAgentAddresses: { docking: string; admet: string; validator: string },
  smiles: string,
  target: string,
  callPaid: (url: string, body: any, authHeader: string) => Promise<any>,
): Promise<ScreenResult> {
  const payments: ScreenResult['payments'] = [];

  // ----- Hop 1: Orchestrator → DockingAgent ($0.005) -----
  const dockAuth = await signUsdcAuthorization(
    orchestratorWallet,
    subAgentAddresses.docking,
    process.env.PRICE_PER_DOCK_USDC ?? '0.005',
  );
  const dockHeader = encodeX402Payment(dockAuth);
  const dockResp = await callPaid(subAgentUrls.docking, { smiles, target }, dockHeader);
  payments.push({
    from: orchestratorWallet.address,
    to: subAgentAddresses.docking,
    amount: process.env.PRICE_PER_DOCK_USDC ?? '0.005',
    label: 'orchestrator→docking',
    txHash: dockResp._txHash,
  });

  // ----- Hop 2: Orchestrator → ADMETAgent ($0.002) -----
  const admetAuth = await signUsdcAuthorization(
    orchestratorWallet,
    subAgentAddresses.admet,
    process.env.PRICE_PER_ADMET_USDC ?? '0.002',
  );
  const admetHeader = encodeX402Payment(admetAuth);
  const admetResp = await callPaid(subAgentUrls.admet, { smiles }, admetHeader);
  payments.push({
    from: orchestratorWallet.address,
    to: subAgentAddresses.admet,
    amount: process.env.PRICE_PER_ADMET_USDC ?? '0.002',
    label: 'orchestrator→admet',
    txHash: admetResp._txHash,
  });

  // ----- Hop 3: Orchestrator → ValidatorAgent ($0.001) -----
  const valAuth = await signUsdcAuthorization(
    orchestratorWallet,
    subAgentAddresses.validator,
    process.env.PRICE_PER_VALIDATE_USDC ?? '0.001',
  );
  const valHeader = encodeX402Payment(valAuth);
  const valResp = await callPaid(subAgentUrls.validator, { smiles }, valHeader);
  payments.push({
    from: orchestratorWallet.address,
    to: subAgentAddresses.validator,
    amount: process.env.PRICE_PER_VALIDATE_USDC ?? '0.001',
    label: 'orchestrator→validator',
    txHash: valResp._txHash,
  });

  return {
    dock: dockResp.result as DockResult,
    admet: admetResp.result as AdmetResult,
    validation: valResp.result as ValidationResult,
    payments,
  };
}

// Re-export the single-agent runners so the server can use them directly
// inside its endpoint handlers without a second HTTP hop.
export { runDock, runAdmet, runValidate };
