# Demo Video Shot List

Target: ≤ 4 minutes. Record in OBS, Loom, or similar.
The structure below lets you cut to whichever shot works first — don't try to record in one take.

---

## Shot 1 · Hook (0:00 – 0:15) — 15 seconds

**On screen:** Title card with "NanoDock" and your email.
**Voiceover:**
> "Drug discovery screening at a per-molecule price point has been economically impossible — traditional blockchain gas costs more than the compute being paid for. I built NanoDock on Arc and Circle Nanopayments to show the first model where it actually works."

---

## Shot 2 · The problem (0:15 – 0:45) — 30 seconds

**On screen:** Terminal with a quick `node -e` that prints the margin table, or just show the README's margin table.
**Voiceover:**
> "A 10,000-molecule screening campaign at $0.01 per molecule is $100 of revenue. On Ethereum L1 at 50 cents of gas per transfer, the same campaign burns $20,000 in gas — 200× underwater. Arc denominates gas in USDC and Circle Nanopayments batches settlement through Circle Gateway, which turns that same workload into 60 cents of amortized gas. That's the entire premise."

---

## Shot 3 · Architecture (0:45 – 1:15) — 30 seconds

**On screen:** The ASCII architecture diagram from the README (just screenshot it).
**Voiceover:**
> "Four autonomous agents. Each has its own Circle Wallet and its own ERC-8004 Identity NFT — they're real, discoverable economic actors, not software functions. A user pays the Orchestrator one cent, the Orchestrator pays the Docking Agent, ADMET Agent, and Validator Agent internally. Every arrow is a real EIP-3009-signed USDC transfer settled on Arc."

---

## Shot 4 · The server booting (1:15 – 1:45) — 30 seconds

**On screen:** Terminal 1, run `npm run server`. Show the output:
```
[nanodock] agents loaded:
  orchestrator 0x... agentId= 42
  docking      0x... agentId= 43
  admet        0x... agentId= 44
  validator    0x... agentId= 45
[nanodock] server ready on http://localhost:3402
```
Then hit `curl localhost:3402/.well-known/agent-card.json | jq .` to show the A2A discovery file.

**Voiceover:**
> "Each agent registers itself on the ERC-8004 Identity Registry on Arc — agent IDs 42 through 45. The server exposes an A2A discovery file at the well-known URL, so any external agent can find NanoDock's capabilities, pricing, and registered identities in one HTTP call."

---

## Shot 5 · The demo run (1:45 – 2:45) — 60 seconds

**On screen:** Terminal 2, run `npm run demo`. Let the progress bar roll. Show each line:
```
[1/25] CC(=O)OC1=CC=CC=C1C(=O)O   → aff=-7.8 lipinski=Y novel=N tx=0x4a2b...
[2/25] COC1=CC2=C(C=C1OC)N=...    → aff=-9.2 lipinski=Y novel=Y tx=0x7f1c...
...
```
When it finishes, show the summary output:
```
[demo] done.
  25/25 molecules succeeded
  125 onchain txns generated  (100 payments + 25 reputation)
  revenue: $0.2500  cost: $0.2000  margin: $0.0500
  report: tx-log/demo-1713800000.json
```

**Voiceover:**
> "Twenty-five molecules. Each call is one cent of USDC — the buyer signs an EIP-3009 authorization, the orchestrator submits it, then pays three internal agents with three more signed authorizations, then posts a reputation score after the work completes. That's five on-chain transactions per molecule. Total: 125 onchain transactions in about 90 seconds."

---

## Shot 6 · Proof on Arcscan (2:45 – 3:15) — 30 seconds

**On screen:** Open one of the `tx-log/demo-*.json` entries and click through to the Arcscan URL. Show the transaction confirming on `testnet.arcscan.app`, then navigate to the Identity Registry contract address (`0x8004A818...`) and show the 4 NFTs minted.

**Voiceover:**
> "Every transaction confirms on Arc testnet in under a second. Here are the four agent identity NFTs on the ERC-8004 Identity Registry — portable, transferable, and discoverable by any other agent on any other chain through the same registry contract. And here's the Reputation Registry entry the buyer posted after the screening completed — scored 100 because this molecule passed all three quality checks."

---

## Shot 7 · Gemini driving it (3:15 – 3:45) — 30 seconds

**On screen:** Terminal 3, run:
```
npm run demo:chat -- "Screen aspirin and a known EGFR inhibitor against EGFR, tell me which is more drug-like and explain the economics at scale."
```
Show Gemini's tool calls:
```
[gemini] → calling screen_molecule({...aspirin...})
[gemini] ← {docking_affinity: -6.1, lipinski_pass: true, ...}
[gemini] → calling screen_molecule({...erlotinib-like...})
[gemini] ← {docking_affinity: -9.7, lipinski_pass: true, ...}
[gemini] → calling explain_economics({n_molecules: 10000})
```
Then the final natural-language answer.

**Voiceover:**
> "And because the whole thing is x402-compliant, Gemini can drive it directly through Function Calling. Here I'm asking Gemini to screen two molecules and explain the campaign economics. Watch: each tool call is an autonomous USDC payment that Gemini decided to make on my behalf. The agent isn't just reasoning — it's spending money."

---

## Shot 8 · Close (3:45 – 4:00) — 15 seconds

**On screen:** README table comparing L1 gas vs Arc + Nanopayments, with the "impossible" row highlighted.

**Voiceover:**
> "Nanopayments on Arc don't just make this cheaper — they make this possible. NanoDock. Built for the Agentic Economy on Arc hackathon. Code's on GitHub, link in the submission."

---

## Recording tips

- Do a dry run of the whole demo flow end-to-end before recording — wallets funded, agents registered, server running cleanly.
- Pre-generate one full `demo-*.json` run so you have tx hashes to click through on Arcscan in Shot 6.
- Speak fast. 4 minutes feels short. Target 150 words per minute.
- If the Gemini call is too slow to include live, record it separately and speed up 2×.
- Keep terminal font large (18pt+). Zoom in on tx hashes when pointing at them.
