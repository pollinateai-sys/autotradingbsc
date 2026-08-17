# 🕌 Halal BSC Trading Bot

A **spot-only** trading bot for BEP20 tokens on Binance Smart Chain, controlled from a
full web dashboard. **Multi-profile** — any number of people can share one deployment,
each with their own wallet, strategy, token list, and trade history, isolated from
everyone else's.

No AI, no leverage, no margin, no interest-bearing positions. Pure rule-based strategy:
a stop-loss and a multi-level take-profit ladder that each person picks for themselves.

**Self-host anywhere** — a VPS, Railway, Render, Docker, Termux, your own PC, or Vercel.

---

## ✨ How it works

There's no shared login. Each person:

1. **Creates their own profile** — a name + a personal API key they choose (or generate).
   That key is their only credential from then on; there's no password reset, so they
   keep it somewhere safe.
2. **Connects their own wallet** — pastes their BEP20 private key into the dashboard
   once. It's encrypted (AES-256-GCM) and stored server-side so the bot can keep trading
   for them even while they're offline. The raw key is never shown again after this.
3. **Picks a strategy, adds their halal tokens, hits Start.** Everything from here — the
   dashboard sections below — is scoped only to that person.

| Section | What it does |
|---|---|
| **Bot Controls** | Start/stop, live vs. simulated trading, bankroll % per trade, max open trades, slippage, min liquidity, scan interval |
| **Strategy Manager** | Three built-in stop-loss / take-profit ladders (A/B/C) — click to switch instantly |
| **Token Manager** | Add any BEP20 contract address; the bot reads its symbol/name on-chain |
| **Open Positions** | Live entry/current price, P&L, TP progress, next target, time held |
| **Trade History** | Every buy / TP / stop-loss / manual close, with win rate and BscScan links |

---

## 🔐 The security model — read this before adding real funds

Because the bot needs to keep trading while someone is offline, the server itself must
be able to decrypt any connected wallet's private key on its own — no per-person
passphrase is kept around to gate that. Concretely:

- Every private key is encrypted with **one server-wide `ENCRYPTION_KEY`** before being
  stored in Redis.
- **Whoever controls that `ENCRYPTION_KEY` (and the server/Redis it runs on) can, in
  principle, decrypt every connected wallet** — not just their own.
- This is the necessary trade-off for "starts trading and keeps going even after I close
  the app." If that trade-off isn't acceptable for everyone using a shared deployment,
  each person should run their own separate instance with their own `ENCRYPTION_KEY`
  instead of sharing one.

Beyond that:
- **Spot only** — every trade is a direct token swap on PancakeSwap V2, settled
  immediately into the trader's own wallet. No margin, no borrowing, no perpetuals.
- **Exact-amount approvals only** — never unlimited token allowance.
- **Slippage capped**, **liquidity floor** enforced per-profile.
- **Position monitoring never stops** for a profile with open positions, even if that
  profile's bot is toggled "off" — off only stops *new* entries.
- **Per-profile isolation** — one person's tokens, settings, positions, and wallet are
  never visible to another profile, enforced at every API route (covered by the test
  suite, including an explicit cross-contamination check).

None of this makes a trade a certified halal transaction — see the disclaimer at the end.

---

## ⚡ Quick Start

### 1. Get a free Upstash Redis database
Go to [upstash.com](https://upstash.com) → Create Database → copy the **REST URL** and
**REST Token** (not the `redis://` connection string).

### 2. Install & configure
```bash
git clone https://github.com/pollinateai-sys/autotradingbsc
cd autotradingbsc
npm install
cp .env.example .env
```
Generate your encryption key and paste it in:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Edit `.env` and fill in: `ENCRYPTION_KEY` (just generated), `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`. Nobody's wallet key goes in this file — that happens in the
dashboard, per person, after this.

### 3. Run it
```bash
npm start
```
Open `http://localhost:3000`. First visitor: create a profile. Next visitor (on their
own device, or the same one after clicking **Switch**): create a second profile. Each
connects their own wallet from inside their own dashboard.

### 4. Run the test suite (optional but recommended)
```bash
npm test
```
71 checks across encryption round-trips, strategy math, and the full HTTP API — including
a dedicated test that two profiles can never see or affect each other's wallet, positions,
or settings. No real funds, network calls, or Redis instance involved.

> **`npm install` is required before `npm start` will work.** If you see
> `Error: Cannot find module ...`, step 2 was skipped — just run `npm install`.

---

## 📱 Running on Termux (Android)

Works fine, with one catch: **don't clone or run the project inside `~/storage/...`**
(Termux's link into shared Android storage). `npm install` there is either extremely
slow or fails outright.

Use Termux's own home directory instead:
```bash
cd ~                          # Termux's native filesystem, NOT ~/storage/...
git clone https://github.com/pollinateai-sys/autotradingbsc
cd autotradingbsc
npm install
cp .env.example .env
nano .env                     # fill in your values, Ctrl+O then Enter to save, Ctrl+X to exit
npm start
```
To keep it running after closing Termux, run it inside a `tmux`/`screen` session
(plus `termux-wake-lock`) so Android doesn't kill the process.

---

## 📐 Strategies

| | Strategy A | Strategy B | Strategy C |
|---|---|---|---|
| **Stop Loss** | -40% | -40% | -25% |
| **TP1** | +50% → sell 25% | +50% → sell 30% | +30% → sell 30% |
| **TP2** | +100% → sell 25% | +100% → sell 25% | +60% → sell 30% |
| **TP3** | +200% → sell 25% | +200% → sell 25% | +100% → sell 25% |
| **TP4** | +400% → sell 25% | +400% → sell 20% | +150% → sell 15% |

Add your own in `api/config/strategies.js` — sell percentages across all TPs must total 100%.
Stop loss exits the *remaining* position at once (not proportionally), since by
definition something has gone wrong and the priority is capital preservation.

---

## 🌐 Hosting options

### Option A — Any VPS / Railway / Render / Termux (recommended)
```bash
npm install
npm start          # runs server.js — Express + one background tick loop
```
Every `POSITION_CHECK_INTERVAL_SECONDS` (default 60s), the loop walks **every profile**:
checks their open positions for SL/TP (always), and runs an entry scan for them if their
bot is on, their wallet is connected, and their own `scanIntervalMinutes` has elapsed.

### Option B — Docker
```bash
docker build -t halal-bot .
docker run -d --env-file .env -p 3000:3000 --name halal-bot halal-bot
```

### Option C — Vercel
Serverless functions don't stay alive between requests, so `server.js`'s loop doesn't
apply there. Instead:
- The dashboard and API work as-is (`api/index.js` is exported for this).
- `GET /api/cron/scan` scans **all profiles** in one call — trigger it via
  [Vercel Cron](https://vercel.com/docs/cron-jobs) (Hobby: once/day; Pro: as often as
  every minute) or a free scheduler like [cron-job.org](https://cron-job.org), with
  header `Authorization: Bearer <CRON_SECRET>` if you've set one.
- `vercel.json` is included with a daily cron as a baseline.

---

## ⚙️ Environment variables

See `.env.example` for the full annotated list. Required: `ENCRYPTION_KEY`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Everything per-person (strategy,
bankroll %, tokens, wallet…) is set from each person's own dashboard after they create
their profile — not in environment variables.

---

## 📁 Project structure

```
autotradingbsc/
├── api/
│   ├── index.js              ← Express app (routes wired here)
│   ├── config/
│   │   ├── strategies.js     ← Strategy A/B/C definitions
│   │   └── tokens.js         ← Default token seed (new profiles only)
│   ├── middleware/
│   │   └── auth.js           ← Resolves x-api-key → profileId for every route
│   ├── lib/
│   │   ├── crypto.js         ← AES-256-GCM wallet encryption, API key hashing
│   │   ├── redis.js          ← Profile registry + all per-profile state
│   │   ├── wallet.js         ← Connect/disconnect, decrypt-on-demand signer
│   │   ├── pancakeswap.js    ← Spot swap execution (takes an explicit signer)
│   │   ├── market.js         ← DexScreener prices + on-chain token metadata
│   │   ├── strategy.js       ← Open/close position logic, TP/SL evaluation
│   │   ├── scanner.js        ← Per-profile cycle + runs-every-profile helper
│   │   └── telegram.js       ← Optional alerts
│   └── routes/
│       ├── profiles.js        ← Create profile, whoami
│       ├── wallet.js          ← Connect/disconnect/status
│       └── status.js  trade.js  positions.js  tokens.js  settings.js  scan.js
├── public/
│   └── index.html             ← The dashboard (vanilla HTML/CSS/JS, no build step)
├── test/
│   ├── test_crypto.js         ← Encryption round-trip, tamper detection, hashing
│   ├── test_direct.js         ← Strategy engine logic (mocked), profile isolation
│   ├── test_http.js           ← Full HTTP API (mocked), two-profile cross-check
│   ├── setup-mocks.js         ← Swaps real chain/redis/market libs for fakes in tests
│   └── mocks/                  ← wallet.js, pancakeswap.js, redis.js, market.js
├── server.js                   ← Entry point for persistent hosting
├── vercel.json                  ← Optional Vercel config (serverless + cron)
├── Dockerfile
└── .env.example
```

---

## ⚠️ Disclaimer

This bot is provided for educational purposes. Crypto trading carries significant
financial risk, including total loss of capital. The halal-compliance features
(spot-only execution, no leverage/margin/interest, user-curated token list) are
mechanical safeguards, not a religious ruling — always consult a qualified Islamic
finance scholar before trading, and never trade with money you cannot afford to lose.
If you're sharing one deployment with someone else, make sure you've both read the
security model section above and are comfortable with it.
