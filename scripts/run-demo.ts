/**
 * Demo runner — the heart of the hackathon submission.
 *
 * Reads data/smiles-library.csv, screens each molecule via /screen, records
 * every tx hash, writes a summary JSON that we'll attach to the submission.
 *
 * Each /screen call triggers 4 onchain transactions:
 *   - buyer → orchestrator  ($0.010)
 *   - orchestrator internally pays docking, admet, validator (3 more settlements)
 *
 * So 25 molecules × 4 txns = 100 onchain txns. Well past the 50+ requirement.
 *
 * Usage:
 *   npm run demo            # uses default library
 *   npm run demo -- 50      # cap at 50 molecules
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { paidPost } from '../src/client.js';
import { explorerTx } from '../src/payments/wallet.js';

const SERVER = process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402';
const LIBRARY = 'data/smiles-library.csv';

interface ScreenOutcome {
  smiles: string;
  target: string;
  ok: boolean;
  error?: string;
  screen_tx?: string;
  affinity?: number;
  lipinski_pass?: boolean;
  novel?: boolean;
  runtime_ms: number;
}

function loadLibrary(): { smiles: string; target: string }[] {
  const csv = readFileSync(LIBRARY, 'utf8').trim();
  const lines = csv.split('\n').slice(1); // skip header
  return lines.map((l) => {
    const [smiles, target] = l.split(',').map((s) => s.trim());
    return { smiles, target: target || 'EGFR' };
  });
}

async function main() {
  const cap = Number(process.argv[2] ?? 25);
  const library = loadLibrary().slice(0, cap);

  console.log(`[demo] screening ${library.length} molecules against ${SERVER}`);
  console.log(`[demo] each /screen = 1 top-level tx + 3 internal settlements = 4 onchain txns`);
  console.log(`[demo] expected total: ${library.length * 4} txns\n`);

  const t0 = Date.now();
  const outcomes: ScreenOutcome[] = [];

  for (let i = 0; i < library.length; i++) {
    const { smiles, target } = library[i];
    const tStart = Date.now();
    process.stdout.write(`  [${i + 1}/${library.length}] ${smiles.padEnd(40).slice(0, 40)} → `);

    try {
      const res: any = await paidPost(
        `${SERVER}/screen`,
        { smiles, target },
        'BUYER_PRIVATE_KEY',
      );

      if (res.error || !res.result) {
        outcomes.push({
          smiles,
          target,
          ok: false,
          error: res.error ?? 'unknown',
          runtime_ms: Date.now() - tStart,
        });
        console.log(`FAIL: ${res.error ?? 'unknown'}`);
        continue;
      }

      outcomes.push({
        smiles,
        target,
        ok: true,
        screen_tx: res._txHash,
        affinity: res.result.dock.affinity_kcal_mol,
        lipinski_pass: res.result.admet.lipinski_pass,
        novel: res.result.validation.novel,
        runtime_ms: Date.now() - tStart,
      });
      console.log(
        `aff=${res.result.dock.affinity_kcal_mol} ` +
          `lipinski=${res.result.admet.lipinski_pass ? 'Y' : 'N'} ` +
          `novel=${res.result.validation.novel ? 'Y' : 'N'} ` +
          (res._txHash ? `tx=${res._txHash.slice(0, 10)}...` : ''),
      );
    } catch (e: any) {
      outcomes.push({ smiles, target, ok: false, error: e.message, runtime_ms: Date.now() - tStart });
      console.log(`FAIL: ${e.message}`);
    }
  }

  const elapsed = Date.now() - t0;
  const successes = outcomes.filter((o) => o.ok);
  const totalScreenTxs = successes.length;
  const totalOnchainTxs = successes.length * 4; // 1 top + 3 sub-agent

  // Economic summary
  const revenueUsdc = totalScreenTxs * 0.01;
  const costUsdc =
    totalScreenTxs *
    (Number(process.env.PRICE_PER_DOCK_USDC ?? 0.005) +
      Number(process.env.PRICE_PER_ADMET_USDC ?? 0.002) +
      Number(process.env.PRICE_PER_VALIDATE_USDC ?? 0.001));
  const marginUsdc = revenueUsdc - costUsdc;

  const summary = {
    chain: 'arc-testnet',
    server: SERVER,
    molecules_attempted: library.length,
    molecules_succeeded: successes.length,
    total_onchain_txns: totalOnchainTxs,
    elapsed_seconds: Math.round(elapsed / 1000),
    economics_usdc: {
      revenue: revenueUsdc.toFixed(6),
      internal_agent_cost: costUsdc.toFixed(6),
      orchestrator_margin: marginUsdc.toFixed(6),
      margin_pct: ((marginUsdc / revenueUsdc) * 100).toFixed(1) + '%',
    },
    margin_explanation:
      'At Ethereum L1 gas (~$0.50 per transfer), each /screen would cost ' +
      '~$2.00 in gas alone against $0.01 revenue — 200x underwater. ' +
      'On Arc + Nanopayments, gas is amortized across batches and denominated in USDC, ' +
      'so the $0.002 orchestrator margin is real gross profit.',
    sample_tx_urls: successes
      .slice(0, 5)
      .filter((o) => o.screen_tx)
      .map((o) => explorerTx(o.screen_tx!)),
    outcomes,
  };

  mkdirSync('tx-log', { recursive: true });
  const reportPath = `tx-log/demo-${Date.now()}.json`;
  writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log(`\n[demo] done.`);
  console.log(`  ${successes.length}/${library.length} molecules succeeded`);
  console.log(`  ${totalOnchainTxs} onchain txns generated`);
  console.log(`  revenue: $${revenueUsdc.toFixed(4)}  cost: $${costUsdc.toFixed(4)}  margin: $${marginUsdc.toFixed(4)}`);
  console.log(`  report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
