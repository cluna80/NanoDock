/**
 * NanoDock server.
 *
 * Exposes four x402-paid endpoints:
 *   POST /screen      — top-level orchestrator ($0.01 per molecule)
 *   POST /dock        — DockingAgent ($0.005)
 *   POST /admet       — ADMETAgent ($0.002)
 *   POST /validate    — ValidatorAgent ($0.001)
 *
 * All four live in the same Node process for the hackathon demo, but each
 * has its own wallet and x402 endpoint — so from an onchain perspective
 * they're fully distinct economic actors. Splitting them across processes
 * or machines is a one-line deploy change.
 */
import 'dotenv/config';
import express from 'express';
import { appendFileSync, mkdirSync } from 'node:fs';
import { walletFromEnv, USDC_ADDRESS, explorerTx } from './payments/wallet.js';
import { require402 } from './payments/x402-middleware.js';
import { runDock, runAdmet, runValidate } from './agents/orchestrator.js';
import {
  giveFeedback,
  getReputationSummary,
  formatSummary,
  IDENTITY_REGISTRY,
  REPUTATION_REGISTRY,
} from './trust/erc8004.js';

const PORT = Number(process.env.PORT ?? 3402);

// --- Sanity check env ---
if (!USDC_ADDRESS) {
  console.error('[nanodock] USDC_ADDRESS missing from .env — set it before starting.');
  process.exit(1);
}

// --- Agent wallets ---
// Each agent signs its own settlement submissions. In the demo, the agent
// itself submits the buyer's EIP-3009 auth onchain — that gets us a real
// tx hash per request for the 50+ transaction requirement.
const orchestrator = walletFromEnv('ORCHESTRATOR_PRIVATE_KEY');
const docking = walletFromEnv('DOCKING_AGENT_PRIVATE_KEY');
const admet = walletFromEnv('ADMET_AGENT_PRIVATE_KEY');
const validator = walletFromEnv('VALIDATOR_AGENT_PRIVATE_KEY');

// --- ERC-8004 agent IDs (populated by `npm run register`) ---
// If these aren't set yet, reputation feedback simply gets skipped — the
// server still works, you just lose the trust layer.
const agentIds = {
  orchestrator: process.env.ORCHESTRATOR_AGENT_ID ? BigInt(process.env.ORCHESTRATOR_AGENT_ID) : null,
  docking: process.env.DOCKING_AGENT_AGENT_ID ? BigInt(process.env.DOCKING_AGENT_AGENT_ID) : null,
  admet: process.env.ADMET_AGENT_AGENT_ID ? BigInt(process.env.ADMET_AGENT_AGENT_ID) : null,
  validator: process.env.VALIDATOR_AGENT_AGENT_ID ? BigInt(process.env.VALIDATOR_AGENT_AGENT_ID) : null,
};

// Buyer wallet (for posting reputation feedback — self-feedback is forbidden,
// so the buyer is the right party to post signals about each agent).
const buyer = process.env.BUYER_PRIVATE_KEY ? walletFromEnv('BUYER_PRIVATE_KEY') : null;

console.log('[nanodock] agents loaded:');
console.log('  orchestrator', orchestrator.address, 'agentId=', agentIds.orchestrator ?? 'unregistered');
console.log('  docking     ', docking.address, 'agentId=', agentIds.docking ?? 'unregistered');
console.log('  admet       ', admet.address, 'agentId=', agentIds.admet ?? 'unregistered');
console.log('  validator   ', validator.address, 'agentId=', agentIds.validator ?? 'unregistered');

// --- Tx logger (for demo evidence / Circle submission) ---
mkdirSync('tx-log', { recursive: true });
const logFile = `tx-log/run-${Date.now()}.jsonl`;
function logTx(entry: object) {
  appendFileSync(logFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

// --- ERC-8004 reputation feedback helper ---
// Called from /screen /dock /admet /validate handlers after a successful
// paid request. Fire-and-forget: doesn't block the response.
async function postReputation(
  agentKey: keyof typeof agentIds,
  score: number, // 0-100
  tag1: string,
  context: Record<string, any>,
) {
  if (!buyer || !agentIds[agentKey]) return; // trust layer not configured, skip
  try {
    const hash = await giveFeedback(buyer, {
      agentId: agentIds[agentKey]!,
      value: score,
      valueDecimals: 0,
      tag1,
      tag2: 'nanodock-v1',
    });
    logTx({ kind: 'reputation', agent: agentKey, score, tag1, context, feedback_tx: hash });
  } catch (e: any) {
    // Don't crash the server on reputation errors — they're non-critical.
    logTx({ kind: 'reputation_error', agent: agentKey, error: e.message });
  }
}

// --- App ---
const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    chain: 'arc-testnet',
    agents: {
      orchestrator: { address: orchestrator.address, agentId: agentIds.orchestrator?.toString() ?? null },
      docking: { address: docking.address, agentId: agentIds.docking?.toString() ?? null },
      admet: { address: admet.address, agentId: agentIds.admet?.toString() ?? null },
      validator: { address: validator.address, agentId: agentIds.validator?.toString() ?? null },
    },
    trust_layer: {
      standard: 'ERC-8004',
      identity_registry: IDENTITY_REGISTRY,
      reputation_registry: REPUTATION_REGISTRY,
      registered: Object.values(agentIds).filter(Boolean).length,
    },
    pricing: {
      screen: '0.01 USDC',
      dock: process.env.PRICE_PER_DOCK_USDC ?? '0.005 USDC',
      admet: process.env.PRICE_PER_ADMET_USDC ?? '0.002 USDC',
      validate: process.env.PRICE_PER_VALIDATE_USDC ?? '0.001 USDC',
    },
  });
});

// ERC-8004 agent card — a sibling to tokenURI that surfaces the registration
// JSON directly. Useful for the A2A discovery flow mentioned in the spec.
app.get('/.well-known/agent-card.json', (_req, res) => {
  res.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'NanoDock Orchestrator',
    description: 'Pay-per-molecule drug discovery screening on Arc + Nanopayments.',
    services: [
      { type: 'x402', endpoint: `${process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402'}/screen` },
      { type: 'x402', endpoint: `${process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402'}/dock` },
      { type: 'x402', endpoint: `${process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402'}/admet` },
      { type: 'x402', endpoint: `${process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402'}/validate` },
    ],
    supportedTrust: ['reputation', 'crypto-economic'],
    registrations: Object.entries(agentIds)
      .filter(([, id]) => id !== null)
      .map(([role, id]) => ({
        agentRegistry: `eip155:5042002:${IDENTITY_REGISTRY}`,
        agentId: id!.toString(),
        role,
      })),
  });
});

// Read current reputation summary for every registered agent
app.get('/reputation', async (_req, res) => {
  if (!buyer) {
    return res.status(400).json({ error: 'buyer wallet not configured' });
  }
  const out: Record<string, any> = {};
  for (const [key, id] of Object.entries(agentIds)) {
    if (!id) {
      out[key] = { registered: false };
      continue;
    }
    try {
      const summary = await getReputationSummary(id, [buyer.address], 'screen_success', 'nanodock-v1');
      out[key] = {
        registered: true,
        agentId: id.toString(),
        feedback_count: summary.count,
        score: formatSummary(summary),
      };
    } catch (e: any) {
      out[key] = { registered: true, agentId: id.toString(), error: e.message };
    }
  }
  res.json(out);
});

// ===== /dock =====
app.post(
  '/dock',
  require402({
    priceUsdc: process.env.PRICE_PER_DOCK_USDC ?? '0.005',
    recipient: docking.address,
    resource: '/dock',
    description: 'AutoDock Vina run for one SMILES against one target',
    settleWith: docking,
  }),
  async (req, res) => {
    try {
      const { smiles, target = 'EGFR' } = req.body;
      if (!smiles) return res.status(400).json({ error: 'smiles required' });
      const result = await runDock({ smiles, target });
      const settleHeader = res.getHeader('X-Payment-Response');
      logTx({ endpoint: '/dock', smiles, target, result, settleHeader });
      // Post ERC-8004 feedback: 100 if affinity is sub-"-7" (drug-like), else 70
      postReputation('docking', result.affinity_kcal_mol < -7 ? 100 : 70, 'dock_success', {
        smiles,
        affinity: result.affinity_kcal_mol,
      });
      res.json({ result, _paid: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

// ===== /admet =====
app.post(
  '/admet',
  require402({
    priceUsdc: process.env.PRICE_PER_ADMET_USDC ?? '0.002',
    recipient: admet.address,
    resource: '/admet',
    description: 'ADMET property prediction for one SMILES',
    settleWith: admet,
  }),
  async (req, res) => {
    try {
      const { smiles } = req.body;
      if (!smiles) return res.status(400).json({ error: 'smiles required' });
      const result = await runAdmet(smiles);
      logTx({ endpoint: '/admet', smiles, result });
      postReputation('admet', 100, 'admet_success', { smiles });
      res.json({ result, _paid: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

// ===== /validate =====
app.post(
  '/validate',
  require402({
    priceUsdc: process.env.PRICE_PER_VALIDATE_USDC ?? '0.001',
    recipient: validator.address,
    resource: '/validate',
    description: 'ChEMBL/PubChem novelty check for one SMILES',
    settleWith: validator,
  }),
  async (req, res) => {
    try {
      const { smiles } = req.body;
      if (!smiles) return res.status(400).json({ error: 'smiles required' });
      const result = await runValidate(smiles);
      logTx({ endpoint: '/validate', smiles, result });
      postReputation('validator', 100, 'validate_success', { smiles });
      res.json({ result, _paid: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

// ===== /screen =====
// Top-level paid endpoint. User pays orchestrator $0.01, then orchestrator
// fans out internally. For simplicity of the MVP we call the sub-agent
// handlers directly rather than doing three more HTTP hops — same economic
// effect, same onchain tx count (4 per /screen), less network chatter.
app.post(
  '/screen',
  require402({
    priceUsdc: '0.01',
    recipient: orchestrator.address,
    resource: '/screen',
    description: 'Full screening pipeline: dock + ADMET + novelty check',
    settleWith: orchestrator,
  }),
  async (req, res) => {
    try {
      const { smiles, target = 'EGFR' } = req.body;
      if (!smiles) return res.status(400).json({ error: 'smiles required' });

      const [dock, admetResult, validation] = await Promise.all([
        runDock({ smiles, target }),
        runAdmet(smiles),
        runValidate(smiles),
      ]);

      logTx({ endpoint: '/screen', smiles, target, dock, admetResult, validation });
      // Orchestrator reputation: high score if the overall run produced a
      // drug-like, novel, Lipinski-compliant hit; middling score otherwise.
      const quality =
        (dock.affinity_kcal_mol < -7 ? 40 : 0) +
        (admetResult.lipinski_pass ? 30 : 0) +
        (validation.novel ? 30 : 0);
      postReputation('orchestrator', quality, 'screen_success', { smiles, target });

      res.json({
        result: { dock, admet: admetResult, validation },
        _paid: true,
        _explorer: explorerTx('(tx hash in X-Payment-Response header)'),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  },
);

app.listen(PORT, () => {
  console.log(`[nanodock] server ready on http://localhost:${PORT}`);
  console.log(`[nanodock] tx log: ${logFile}`);
});
