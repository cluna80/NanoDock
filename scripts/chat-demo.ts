/**
 * Gemini chat demo.
 *
 *   npm run demo:chat
 *   npm run demo:chat -- "Screen these EGFR fragments: CCO, CC(=O)O, c1ccccc1. Only show me Lipinski hits."
 *
 * Reads a prompt from argv or stdin, hands it to the Gemini orchestrator,
 * prints the final answer. All paid tool calls go through /screen.
 */
import 'dotenv/config';
import { runAgent } from '../src/gemini/orchestrator.js';
import { readFileSync } from 'node:fs';

const DEFAULT_PROMPT = `
I want to screen these molecules against EGFR and rank them by docking affinity.
Only show me the ones that pass Lipinski's rule of five AND are novel vs. ChEMBL.
Explain the economics of doing this campaign at 10,000 molecules vs Ethereum L1.

Molecules:
  CC(=O)OC1=CC=CC=C1C(=O)O
  COC1=CC2=C(C=C1OC)N=CN=C2NC3=CC=CC(=C3)C#C
  CS(=O)(=O)CCNCC1=CC=C(O1)C2=CC3=NC=NC(=C3C=C2)NC4=CC(=C(C=C4)F)Cl
  CC1=C(C(=NN1C2=CC=C(C=C2)S(=O)(=O)N)C3=CC=C(C=C3)F)C(=O)N
  Nc1ncnc2c1ncn2C1OC(CO)C(O)C1O
`;

async function main() {
  let prompt = process.argv.slice(2).join(' ').trim();
  if (!prompt) {
    // Check if something was piped in
    if (!process.stdin.isTTY) {
      prompt = readFileSync(0, 'utf8').trim();
    }
  }
  if (!prompt) prompt = DEFAULT_PROMPT;

  console.log('=== prompt ===');
  console.log(prompt);
  console.log('\n=== gemini thinking... ===\n');

  const answer = await runAgent(prompt);

  console.log('\n=== final answer ===\n');
  console.log(answer);
}

main().catch((e) => {
  console.error('chat-demo failed:', e);
  process.exit(1);
});
