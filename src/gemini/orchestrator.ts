/**
 * Gemini-driven meta-orchestrator.
 *
 * Lets a user (or another agent) describe a screening campaign in natural
 * language, then uses Gemini 3's Function Calling to drive our paid
 * x402 endpoints autonomously.
 *
 * Example prompt:
 *   "Screen these 10 molecules against EGFR: [list]. Only tell me about
 *    hits with affinity under -8 and Lipinski-compliant."
 *
 * Gemini gets tools for:
 *   - screen_molecule(smiles, target)  → calls our paid /screen endpoint
 *   - get_wallet_balance(address)      → reads USDC on Arc
 *   - explain_economics(n_molecules)   → returns cost/margin table
 *
 * Every tool call that hits /screen is a real nanopayment on Arc, so the
 * "AI agent autonomously spends money" story is literal, not a demo prop.
 *
 * This hits the Gemini / Google AI Studio bonus track ($10k GCP credits)
 * alongside the primary Nanopayments tracks.
 */
import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';
import { paidPost } from '../client.js';
import { usdcBalance, explorerTx } from '../payments/wallet.js';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-3-flash';
const SERVER = process.env.SERVER_PUBLIC_URL ?? 'http://localhost:3402';

// ----- Tool definitions (what Gemini can call) -----
// Cast to `any` because @google/genai's Tool[] type uses a strict
// Record<string, Schema> index signature that trips on heterogeneous
// function declarations sharing a single tools array.
const tools: any = [
  {
    functionDeclarations: [
      {
        name: 'screen_molecule',
        description:
          'Submit a single SMILES to the NanoDock pipeline. Pays $0.01 USDC via ' +
          'Circle Nanopayments on Arc, generating 4 onchain transactions (one ' +
          'top-level + three internal agent settlements). Returns docking ' +
          'affinity (kcal/mol), ADMET profile, and novelty check.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            smiles: { type: Type.STRING, description: 'Valid SMILES string' },
            target: {
              type: Type.STRING,
              description: 'Protein target, e.g. "EGFR" or "HIV-1 Protease"',
            },
          },
          required: ['smiles', 'target'],
        },
      },
      {
        name: 'get_wallet_balance',
        description: 'Returns the USDC balance (decimal string) of an Arc testnet address.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            address: { type: Type.STRING },
          },
          required: ['address'],
        },
      },
      {
        name: 'explain_economics',
        description:
          'Returns the economic comparison between Arc + Nanopayments and a ' +
          'traditional L1 gas model for a given screening campaign size.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            n_molecules: { type: Type.INTEGER },
          },
          required: ['n_molecules'],
        },
      },
    ],
  },
];

// ----- Tool executors (what actually runs) -----
async function dispatchTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'screen_molecule': {
      const result = await paidPost(
        `${SERVER}/screen`,
        { smiles: args.smiles, target: args.target },
        'BUYER_PRIVATE_KEY',
      );
      return {
        smiles: args.smiles,
        target: args.target,
        docking_affinity: result?.result?.dock?.affinity_kcal_mol,
        lipinski_pass: result?.result?.admet?.lipinski_pass,
        herg_risk: result?.result?.admet?.herg_risk,
        synthetic_accessibility: result?.result?.admet?.synthetic_accessibility,
        novel: result?.result?.validation?.novel,
        tx_hash: result?._txHash,
        tx_url: result?._txHash ? explorerTx(result._txHash) : undefined,
      };
    }

    case 'get_wallet_balance': {
      const bal = await usdcBalance(args.address);
      return { address: args.address, balance_usdc: bal };
    }

    case 'explain_economics': {
      const n = args.n_molecules as number;
      const revenue = n * 0.01;
      const gasTradL1 = n * 4 * 0.5; // 4 txns/molecule, ~$0.50 each on L1
      const gasArcBatched = n * 4 * 0.0001; // amortized via Gateway batching
      return {
        molecules: n,
        revenue_usdc: revenue.toFixed(4),
        gas_cost_ethereum_l1_usd: gasTradL1.toFixed(2),
        gas_cost_arc_batched_usd: gasArcBatched.toFixed(6),
        net_ethereum_l1: (revenue - gasTradL1).toFixed(2),
        net_arc: (revenue - gasArcBatched).toFixed(4),
        verdict:
          gasTradL1 > revenue
            ? `Traditional L1 gas (${gasTradL1.toFixed(2)}) would eat ${((gasTradL1 / revenue) * 100).toFixed(0)}% of revenue. Unviable.`
            : 'Both models viable at this scale.',
      };
    }

    default:
      return { error: `unknown tool: ${name}` };
  }
}

// ----- Main loop -----
export async function runAgent(userPrompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not set in .env');
  }

  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction =
    'You are a drug-discovery orchestrator running on the NanoDock platform. ' +
    'You have access to a paid compute pipeline that screens SMILES molecules ' +
    'for binding affinity, ADMET compliance, and chemical novelty. Every ' +
    'screen_molecule call costs $0.01 USDC and produces 4 onchain transactions ' +
    'on Arc testnet — so be deliberate. When the user asks you to screen ' +
    'molecules, call screen_molecule once per SMILES, then summarize the ' +
    'results with attention to affinity (lower is better), Lipinski compliance, ' +
    'and novelty. Always include the Arcscan tx URL for one representative ' +
    'transaction at the end of your summary.';

  const contents: any[] = [{ role: 'user', parts: [{ text: userPrompt }] }];
  const maxTurns = 12;

  for (let turn = 0; turn < maxTurns; turn++) {
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction,
        tools,
      },
    });

    const candidate = resp.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    // Check for function calls
    const functionCalls = parts.filter((p: any) => p.functionCall);
    if (functionCalls.length === 0) {
      // No more tools to call — final text response
      const text = parts.map((p: any) => p.text ?? '').join('');
      return text;
    }

    // Append the model's turn (with tool calls) to history
    contents.push({ role: 'model', parts });

    // Execute each tool, append results
    const toolResponses: any[] = [];
    for (const p of functionCalls) {
      const fc = p.functionCall;
      if (!fc?.name) continue;
      const { name, args } = fc;
      console.log(`  [gemini] → calling ${name}(${JSON.stringify(args)})`);
      const result = await dispatchTool(name, args);
      console.log(`  [gemini] ← ${JSON.stringify(result).slice(0, 120)}`);
      toolResponses.push({
        functionResponse: { name, response: result },
      });
    }
    contents.push({ role: 'user', parts: toolResponses });
  }

  return '[exceeded max turns without final answer]';
}
