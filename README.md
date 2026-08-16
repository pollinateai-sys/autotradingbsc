# 🕌 Halal BSC Trading Bot

A **spot-only** trading bot for BEP20 tokens on Binance Smart Chain, controlled from a
full web dashboard. No AI, no leverage, no margin, no interest-bearing positions.
Pure rule-based strategy: a stop-loss and a multi-level take-profit ladder that you pick,
trading only the tokens you've personally added to your halal list.

**Self-host anywhere** — a VPS, Railway, Render, Docker, your own PC, or Vercel.

---

## ✨ What's in the dashboard

| Section | What it does |
|---|---|
| **Bot Controls** | Start/stop the bot, toggle live vs. simulated trading, set bankroll % per trade, max open trades, slippage, min liquidity, scan interval — all saved live, no redeploy |
| **Strategy Manager** | Three built-in stop-loss / take-profit ladders (A/B/C) — click to switch instantly |
| **Token Manager** | Add any BEP20 contract address; the bot reads its symbol/name on-chain and adds it to your list. Enable/disable or remove anytime |
| **Open Positions** | Live entry price, current price, P&L, TP progress, next target, time held — refreshes every 15s |
| **Trade History** | Full ledger of every buy / TP / stop-loss / manual close, with win rate and BscScan links |

---

## ⚡ Quick Start

### 1. Get a free Upstash Redis database
This is what makes your settings, tokens, and positions persist. Go to
[upstash.com](https://upstash.com) → Create Database → copy the **REST URL** and **REST Token**
(not the `redis://` connection string).

### 2. Install & configure
```bash
git clone https://github.com/pollinateai-sys/autotradingbsc
cd autotradingbsc
npm install
cp .env.example .env
```
Edit `.env` and fill in at minimum: `PRIVATE_KEY`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `BOT_SECRET` (any random string — this is your dashboard password).

### 3. Run it
```bash
npm start
```
Open `http://localhost:3000` — enter your `BOT_SECRET` when prompted, and you're in.

### 4. Run the test suite (optional but recommended)
```bash
npm test
```
Runs 41 checks against mocked wallet/chain/market data — no real funds or network calls involved.

> **`npm install` is required before `npm start` will work.** If you see
> `Error: Cannot find module 'dotenv'` (or any other module), it means step 2 was skipped —
> just run `npm install` and try again.

---

## 📱 Running on Termux (Android)

Works fine, with one catch: **don't clone or run the project inside `~/storage/...`**
(Termux's link into shared Android storage). That path is backed by Android's storage
layer, not a normal Linux filesystem, and `npm install` there is either extremely slow
or fails outright — this is what causes the `Cannot find module` error even right after
installing.

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
If you need files from shared storage (e.g. copying `.env` in from Downloads), copy them
in with `cp ~/storage/downloads/.env .env` rather than running the project from there.

To keep it running after closing Termux, use a session manager like `tmux` or
`termux-wake-lock` + running it inside a `screen`/`tmux` session so Android doesn't kill it.

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

**Note on stop loss:** it exits the *remaining* position at once, not proportionally, since
by definition something has gone wrong and the priority is capital preservation.

---

## 🔐 How safety is enforced

- **Spot only** — every trade is a direct token swap on PancakeSwap V2, settled immediately into your wallet. No margin, no borrowing, no perpetuals.
- **Exact-amount approvals only** — the bot never requests unlimited token allowance, only the exact amount needed for that swap.
- **Slippage capped** — trades abort if execution would exceed your configured max slippage.
- **Liquidity floor** — tokens below your minimum liquidity threshold are skipped automatically.
- **Position monitoring never stops** — even if you toggle the bot "off," open positions are still watched for stop-loss/take-profit. "Off" only stops *new* entries.
- **Private key** — read once from `.env` (or `PRIVATE_KEY` env var on your host), never written to disk, never logged, never sent to the browser.
- **Dashboard actions gated** — every action that touches funds or settings requires your `BOT_SECRET` header.

None of this makes a trade a certified halal transaction — see the disclaimer at the bottom.

---

## 🌐 Hosting options

### Option A — Any VPS / Railway / Render (recommended)
```bash
npm install
npm start          # runs server.js — Express + two background loops
```
`server.js` keeps a fast loop (checks open positions every `POSITION_CHECK_INTERVAL_SECONDS`,
default 60s) and a slower loop (scans for new entries every `scanIntervalMinutes`, set from
the dashboard, default 30 min) running continuously. This is the mode built for 24/7 uptime.

### Option B — Docker
```bash
docker build -t halal-bot .
docker run -d --env-file .env -p 3000:3000 --name halal-bot halal-bot
```

### Option C — Vercel
Vercel's serverless functions don't stay alive between requests, so the continuous
background loops in `server.js` don't apply there. Instead:
- The dashboard and all API routes work as-is (`api/index.js` is exported for this).
- Position exits and new-entry scans run via `GET /api/cron/scan`, triggered by
  [Vercel Cron](https://vercel.com/docs/cron-jobs) (Hobby plan: once/day; Pro: as often as
  every minute) or a free external scheduler like [cron-job.org](https://cron-job.org)
  hitting your `/api/cron/scan` URL with header `x-bot-secret: <your BOT_SECRET>`.
- `vercel.json` is included and pre-configured with a daily cron as a baseline.

---

## ⚙️ Environment variables

See `.env.example` for the full annotated list. The short version — required:
`PRIVATE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `BOT_SECRET`.
Everything else (strategy, bankroll %, max trades, slippage, tokens…) is set from the
dashboard after first run and stored in Redis — not in environment variables.

---

## 📁 Project structure

```
autotradingbsc/
├── api/
│   ├── index.js            ← Express app (routes wired here)
│   ├── config/
│   │   ├── strategies.js   ← Strategy A/B/C definitions
│   │   └── tokens.js       ← Default token seed list (first run only)
│   ├── lib/
│   │   ├── redis.js        ← All persisted state (positions, settings, tokens, log)
│   │   ├── wallet.js       ← Key handling, balances
│   │   ├── pancakeswap.js  ← Spot swap execution
│   │   ├── market.js       ← DexScreener prices + on-chain token metadata
│   │   ├── strategy.js     ← Open/close position logic, TP/SL evaluation
│   │   ├── scanner.js      ← Combines exit-checks + entry-scans into one cycle
│   │   └── telegram.js     ← Optional alerts
│   └── routes/
│       ├── status.js  trade.js  positions.js  tokens.js  settings.js  scan.js
├── public/
│   └── index.html           ← The dashboard (vanilla HTML/CSS/JS, no build step)
├── test/
│   ├── test_direct.js       ← Strategy engine logic tests (mocked)
│   ├── test_http.js         ← Full HTTP API tests (mocked)
│   ├── setup-mocks.js       ← Swaps real chain/redis/market libs for fakes in tests
│   └── mocks/                ← wallet.js, pancakeswap.js, redis.js, market.js
├── server.js                 ← Entry point for persistent hosting (VPS/Railway/Docker)
├── vercel.json                ← Optional Vercel config (serverless + cron)
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
