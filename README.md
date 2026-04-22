# NanoDock

**Pay-per-molecule drug discovery compute marketplace on Arc.**
A working demonstration of the Agentic Economy: four autonomous AI agents with ERC-8004 on-chain identities, paying each other in sub-cent USDC nanopayments, building public reputation as they run real scientific workflows.

> Built for the [Agentic Economy on Arc](https://lablab.ai/ai-hackathons/nano-payments-arc) hackathon (April 2026).

---

## What this is

NanoDock lets any client (a researcher, another agent, a Gemini-powered orchestrator) submit a SMILES string and a target protein, and receive a complete screening report — docking affinity, ADMET profile, and ChEMBL novelty check — in exchange for **$0.01 USDC** paid as a Circle Nanopayment on Arc.

Inside the server, four autonomous agents each with their own Circle Wallet **and ERC-8004 identity NFT** split the work:

```
  user ──$0.010──▶ OrchestratorAgent   (ERC-8004 agentId #N)
                   │
                   ├──$0.005──▶ DockingAgent      (AutoDock Vina)   #N+1
                   ├──$0.002──▶ ADMETAgent        (property pred.)  #N+2
                   └──$0.001──▶ ValidatorAgent    (ChEMBL novelty)  #N+3
                   │
                   └── $0.002 gross margin
                   
  After every successful /screen:
     buyer ──feedback──▶ ReputationRegistry (0x8004B6...)
                         keyed to each agent's agentId
```

On top of that, a **Gemini 3** orchestrator can drive the whole pipeline from natural language, using Function Calling to autonomously spend USDC on behalf of the user.

Every arrow inside the payment box is a real EIP-3009 USDC authorization settled on Arc testnet. One `/screen` call produces **4 onchain payment transactions + 1 reputation transaction = 5 onchain txns**. A 25-molecule demo run produces **125+ onchain txns**, well above the hackathon's 50+ floor.

---

## Hackathon tracks

Primary: **🧮 Usage-Based Compute Billing** — docking and property prediction charged per molecule with real-time settlement.
Secondary: **🤖 Agent-to-Agent Payment Loop** — each internal agent is an independent economic actor with its own wallet, its own ERC-8004 identity, and its own pricing.
Bonus: **Gemini / Google AI Studio** — natural-language orchestrator with Function Calling drives all paid endpoints.

## Recommended tools used

- **Arc** (settlement layer) · **USDC** (value + gas) · **Circle Nanopayments** (sub-cent pricing via EIP-3009 + Gateway batching) · **Circle Wallets** (per-agent keys) · **x402** (HTTP 402 payment protocol) · **ERC-8004** (on-chain identity + reputation for trustless agent discovery) · **Gemini 3 Flash/Pro** (natural-language orchestrator with Function Calling)

---

## ERC-8004 trust layer

Every NanoDock agent runs as a fully ERC-8004-compliant Trustless Agent:

- **Identity Registry** (`0x8004A818BFB912233c491871b3d84c89A494BD9e` on Arc testnet) — each agent owns an ERC-721 NFT as portable on-chain identity, with a registration JSON describing role, pricing, and x402 endpoint. The registration JSON includes the spec's `proofOfPayment` field referencing our USDC asset on Arc, binding payments to identity.
- **Reputation Registry** (`0x8004B663056A597Dffe9eCcC1965A193B7388713`) — after each successful `/screen`, `/dock`, `/admet`, or `/validate`, the buyer posts a feedback entry scoring the agent's output. Score is computed from real output quality: `-7 kcal/mol` affinity threshold, Lipinski pass, novelty. Self-feedback is forbidden (per spec), so the buyer — a distinct wallet — is the correct signer.
- **A2A discovery** — `GET /.well-known/agent-card.json` on the server exposes the full registration file with all agentIds, so any external agent or orchestrator can discover NanoDock's capabilities via a single HTTP call.

This gives the system three things that normal x402 APIs don't have:

1. **Portable reputation.** A DockingAgent that's processed 10,000 molecules with consistent sub-`-7` affinities can carry that score to a different host, a different protocol, a different orchestrator — it's anchored onchain, not in a proprietary DB.
2. **Trust-minimized agent-to-agent hiring.** A Gemini orchestrator deciding *which* DockingAgent to send a batch to can query `getReputationSummary(agentId, clients)` on-chain and compare scores. No centralized registry needed.
3. **Sybil-resistant discovery.** `getSummary` requires a non-empty `clientAddresses` array, so buyers filter by known-good counterparties — reputation is a DAG of trusted relationships, not a global popularity contest.

Why use the canonical deployed registries rather than deploying our own? The 8004 team deployed them with a CREATE2 vanity "0x8004..." prefix across every major EVM testnet and mainnet, including Arc testnet. Using the canonical addresses means our agents are discoverable from the same registries that TRON, Hedera, Base, and Ethereum mainnet agents already use. A drug-discovery-literate Gemini orchestrator running on Base can find NanoDock's agents on Arc through the exact same API it uses for Base agents.

**Read the live reputation at any time:** `GET http://localhost:3402/reputation` returns a per-agent summary reading directly from the on-chain ReputationRegistry.

---

## Why this fails without Arc + Nanopayments (the margin story)

| Layer | At Ethereum L1 gas | At Arc + Nanopayments |
|---|---|---|
| Revenue per `/screen` | $0.01 | $0.01 |
| Internal agent payments | 3 × $0.50 gas = $1.50 | batched, ≈ $0.0001 amortized |
| Top-level settlement | $0.50 gas | batched via Circle Gateway |
| Net economics | **−$1.99 per call (200× underwater)** | **+$0.002 per call gross profit** |

For a real campaign screening **10,000 molecules**: traditional gas would burn **~$20,000** against **$100** of revenue. On Arc, the same work clears **$20** of actual profit to the service operator, with per-agent fees flowing autonomously.

This is the exact economic primitive that did not exist before Nanopayments. The business model is impossible without it.

---

## What's built during the hackathon window vs. pre-existing

In keeping with the hackathon's originality rule, this repo is MIT-licensed and its code was authored during the hackathon window (April 20–25, 2026). Specifically:

**Built this week (this repo, `nanodock/`):**
- The x402 Express middleware (`src/payments/x402-middleware.ts`)
- EIP-3009 signer + encoder (`src/payments/nanopay.ts`)
- Multi-wallet agent architecture + Arc chain helpers (`src/payments/wallet.ts`)
- All four agent endpoints + orchestrator fan-out (`src/server.ts`, `src/agents/*`)
- x402 client + bulk demo runner (`src/client.ts`, `scripts/run-demo.ts`)
- Gemini Function-Calling orchestration layer (optional; see `src/agents/orchestrator.ts`)

**Pre-existing dependency (separate repo, MIT-licensed):**
- The AutoDock Vina + ADMET + ChEMBL pipeline (`drug_discovery.py`, `autonomous_drug_agent.py`). Imported via the thin shim at `src/docking/vina_bridge.py`.

The FBDD pipeline is treated exactly like a third-party scientific library (think RDKit). The hackathon submission is the **Arc / USDC / Nanopayments / Gemini economic layer** built on top of it.

---

## Setup

### Prerequisites
- Node 20+ and npm
- Python 3.10+ (only required if you're wiring in the real docking backend)
- A Circle Developer account ([signup](https://console.circle.com))

### Install

```bash
git clone <your-fork-url> nanodock
cd nanodock
npm install
cp .env.example .env
```

### Generate wallets

```bash
npm run wallets:new > .env.wallets
cat .env.wallets >> .env   # paste the generated keys into your .env
```

This creates five fresh keypairs: one buyer and four agents.

### Get testnet USDC

1. Visit https://faucet.circle.com
2. Select **Arc Testnet**
3. Fund **the buyer address** first (shown in `.env.wallets`)
4. Run `npm run fund` to move 0.5 USDC to each agent so they can pay gas

### Set the USDC contract address

Grab the USDC contract address for Arc testnet from https://docs.circle.com/arc and paste it into `.env` as `USDC_ADDRESS`.

### Run

```bash
# Terminal 1 — start the server
npm run server

# Terminal 2 — one-shot request
npm run client -- "CCO" EGFR

# Terminal 2 — full 25-molecule demo (100 onchain txns)
npm run demo

# Terminal 2 — natural-language Gemini demo (requires GEMINI_API_KEY)
npm run demo:chat -- "Screen aspirin and caffeine against EGFR, tell me which is more drug-like."
```

The bulk demo writes a full report to `tx-log/demo-<timestamp>.json` with every tx hash and Arcscan link.

---

## Architecture

```
                         ┌─────────────────────────────┐
 ┌────────┐    HTTP 402  │        Arc Testnet          │
 │ Client │◀──────────┐  │  ┌───────────────────────┐  │
 │ (buyer)│───────────┼─▶│  │  USDC ERC-20 contract │  │
 └────────┘  X-Payment│  │  │  (native gas token)   │  │
     │       (EIP-3009│  │  └───────────────────────┘  │
     │       signed)  │  └─────────────────────────────┘
     ▼                │
┌───────────────────────────────────────────┐
│  NanoDock server (Express + x402)         │
│                                           │
│  ┌──────────────────────────────────┐     │
│  │  OrchestratorAgent (wallet A)    │     │
│  │  POST /screen  — $0.01           │     │
│  └────┬──────────────┬───────────┬──┘     │
│       │              │           │        │
│       ▼              ▼           ▼        │
│  ┌─────────┐   ┌──────────┐  ┌──────────┐ │
│  │DockingAgt│   │ADMETAgent│  │ValidatorAgt│
│  │(wallet B)│   │(wallet C)│  │(wallet D)  │
│  │POST /dock│   │POST/admet│  │POST/validate│
│  │ $0.005   │   │  $0.002  │  │  $0.001    │
│  └─────────┘   └──────────┘  └──────────┘ │
│       │                                   │
│       ▼                                   │
│  vina_bridge.py ──▶ drug_discovery.py     │
│                    (pre-existing repo)    │
└───────────────────────────────────────────┘
```

**Key economic properties:**
1. Every agent has its own Circle Wallet address, so agent-to-agent payments are real onchain flows — not internal accounting tricks.
2. Every endpoint is x402-gated. No API keys, no subscriptions: payment *is* auth.
3. Settlement happens through the EIP-3009 `transferWithAuthorization` path, which is exactly what Circle Nanopayments / Circle Gateway consumes. The hackathon demo can run direct-submit for simplicity, but the signed payloads are already in the format the production facilitator expects.

---

## Circle Product Feedback

*(Draft — will be finalized in the submission form. Notes captured during the build.)*

**Products used**
- Arc Testnet (settlement layer, USDC-native gas, chain ID 5042002)
- USDC on Arc (EIP-3009 `transferWithAuthorization`)
- Circle Nanopayments (x402 + Gateway batched settlement)
- Circle Wallets pattern (per-agent keypair architecture; used ethers.Wallet for hackathon simplicity, trivially swappable to Developer-Controlled Wallets for production)
- x402 HTTP standard

**Why these products for this use case**
The combination of (a) USDC-denominated gas, (b) offchain EIP-3009 signatures, and (c) batched Gateway settlement is the *only* stack that makes per-molecule drug discovery pricing economically viable. At Ethereum L1 gas costs, a 10,000-molecule EGFR screen would burn ~$20,000 in gas against $100 of revenue. On Arc with Nanopayments, the same workload settles gas-amortized and leaves real gross profit. No other payment rail we evaluated — Stripe micropayments, Polygon USDC, traditional L2s — comes close on the combination of per-tx cost + settlement latency + USDC denomination.

**What worked well**
1. **Arc's EVM compatibility is a clean win.** We could use ethers.js, standard EIP-3009 domain separators, and existing ERC-20 ABIs without network-specific adapters. Getting from zero to a signed `transferWithAuthorization` for USDC on Arc took under an hour.
2. **USDC-denominated gas removed a whole class of mental overhead.** When every cost is already in the unit you're pricing in, the economic-viability math becomes a spreadsheet, not a guessing game about ETH price.
3. **x402 as an HTTP-native standard is the right abstraction.** Dropping 402 middleware in front of an Express route, with the payment being the auth, is dramatically cleaner than API keys + usage metering + invoicing. We got a paid endpoint running in ~30 lines.
4. **Sub-second finality on Arc** meant we didn't need to design around confirmation latency in our orchestrator loop — per-screen end-to-end latency is bounded by Vina, not the chain.

**Friction / documentation gaps we ran into**
1. **USDC contract address on Arc testnet isn't prominently displayed.** We had to dig through multiple docs pages to find the deployed USDC address for Arc. Putting it next to the chain ID on the top-level Arc docs page would save every new builder ~15 minutes.
2. **EIP-3009 domain separator values for Arc USDC aren't documented in one place.** We had to infer `name: "USDC"`, `version: "2"` from EIP-3009 conventions and hope they matched the deployed contract. A two-line "Arc USDC domain" snippet in the docs would be gold.
3. **The Circle Nanopayments "end-to-end sample" on testnet would benefit from a minimal TypeScript example.** The existing blog post covers the concept well but the 40 lines of code that actually submit a Nanopayment (sign → base64 → header → facilitator) are scattered across multiple files in the sample repo. A single runnable `nanopay.ts` that takes `(buyer, recipient, amount)` and returns a tx hash would be the canonical "hello world" for this category.
4. **Faucet UX is browser-only.** For a hackathon where we're scripting 100+ tx runs across 5 wallets, a CLI faucet (or an API endpoint with rate limits) would have saved repetitive clicking. Also: being able to fund multiple addresses in one faucet request would help agent-to-agent demos.
5. **Gateway deposit flow is conceptually separate from normal ERC-20 transfers and it took us a minute to realize a one-time `deposit` to a Gateway Wallet is different from approving USDC spending.** A side-by-side diagram — "here's a raw ERC-20 transfer, here's the Gateway deposit that unlocks Nanopayments for this address, here's the offchain EIP-3009 path after that" — would clarify the mental model for first-timers.
6. **Testnet block explorer (arcscan.app) could surface EIP-3009 events more prominently.** When we were debugging a `transferWithAuthorization`, it showed up as a normal Transfer event; having a dedicated filter for "paid via offchain auth" would make it easier to audit Nanopayment batches visually.
7. **x402 facilitator endpoint discovery.** We didn't find a single canonical URL for Circle's production x402 facilitator on Arc testnet — had to choose between implementing direct-submit ourselves, using Coinbase's facilitator, or waiting for Gateway batch mode. A `well-known` URL or explicit `https://api.circle.com/v1/...` endpoint in the Arc docs would remove that ambiguity.

**Feature requests**
1. A `@circle/nanopayments` or `@circle/x402-client` official TypeScript SDK with the canonical sign + submit flow, so builders don't reimplement EIP-3009 domain logic.
2. A testnet mode in Circle Wallets that auto-funds newly created wallets with a small USDC balance, avoiding the manual faucet step entirely.
3. Batched faucet requests (e.g. POST with an array of addresses).
4. In-Arcscan view of Gateway batch settlements, so a builder can click "show me the 500 nanopayments in this batch tx."

---

## Built with

- **Arc Testnet** — settlement layer, native USDC gas, chain ID 5042002
- **USDC** — value + gas
- **Circle Nanopayments** — sub-cent pricing, EIP-3009 offchain authorization
- **x402** — HTTP payment protocol
- **Circle Wallets** — per-agent wallet infrastructure
- **Gemini 3 Flash / Pro** — orchestration and reasoning (optional layer)
- **AutoDock Vina** — molecular docking (via pre-existing pipeline)

## License

MIT. See [LICENSE](./LICENSE).
