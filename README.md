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
| **Entry Logic** | Editable buy conditions (default: 1h dump ≥40% AND 24h gain ≥100%) — the bot waits for your setup instead of buying instantly |
| **Strategy Manager** | Stop-loss / take-profit ladders — edit any SL/TP, add your own strategies, delete unused ones, click a card to switch |
| **Coins Found** | Auto-discovers live BSC coins passing your editable screening filters (liquidity, 24h volume, **minimum age**, market cap, txn count) — enable the ones you want, skip the rest, ask for another 20 |
| **Token Manager** | Add any BEP20 contract address; the bot reads its symbol/name on-chain |
| **Open Positions** | **Every-block live monitoring** over BSC WebSocket, executable current price, P&L, TP progress, next target, time held |
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
  profile's bot is toggled "off" — every new BSC block triggers SL/TP checks, and an
  independent HTTP watchdog protects positions if the WebSocket feed drops.
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
100+ checks across encryption round-trips, strategy math, custom-strategy CRUD and
validation, entry-rule evaluation and scanner gating, and the full HTTP API — including
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

## 📐 Strategies — fully editable

Every profile starts with the built-in ladders below (seeded on first use) — then they're
**fully yours**: edit any stop loss or take-profit, **add your own strategies**, or
**delete** what you don't use, all live from the dashboard's Strategy Manager. No
redeploys, no file edits.

| | Strategy A | Strategy B | Strategy C |
|---|---|---|---|
| **Stop Loss** | -40% | -40% | -25% |
| **TP1** | +50% → sell 25% | +50% → sell 30% | +30% → sell 30% |
| **TP2** | +100% → sell 25% | +100% → sell 25% | +60% → sell 30% |
| **TP3** | +200% → sell 25% | +200% → sell 25% | +100% → sell 25% |
| **TP4** | +400% → sell 25% | +400% → sell 20% | +150% → sell 15% |

Rules enforced when saving (these numbers move real money):
- Stop loss between −95% and 0%; it exits the *remaining* position at once, since by
  definition something has gone wrong and the priority is capital preservation.
- 1–6 take-profit levels, targets strictly ascending, sell percentages (of the
  **original** position) totalling exactly 100%.
- Up to 12 strategies per profile. A strategy can't be deleted while it's your
  active one or while an open position is following it.
- Open positions keep following the strategy they were **opened** with — editing
  that strategy's ladder updates what the position follows from its next check.

API: `GET /api/strategies` · `POST /api/strategies` · `POST /api/strategies/update` ·
`POST /api/strategies/delete` (all scoped to your profile by `x-api-key`).

## 🎯 Entry Logic — when the bot buys (editable)

The bot **no longer buys instantly** when you press Start. Each profile has its own
editable entry rules (dashboard → **Entry Logic**) evaluated on every scan against
DexScreener's price-change data — no extra API calls needed:

- **Default (dip-buy on a runner)**: `1h change ≤ −40%` **AND** `24h change ≥ +100%` —
  only buy a violent dump on something with real momentum.
- Up to **5 conditions**, each on the **5m / 1h / 6h / 24h** window with a **≤ or ≥**
  threshold you choose.
- **ALL must pass** (strict) or **ANY can pass** (loose) mode.
- **Toggle off** to restore the old behavior (buy every enabled token that passes your
  liquidity floor).
- Skipped tokens tell you why: scan results show e.g. `✗ 1h +6.2% (needs ≤ -40%)`.
- Deliberate **manual buys** bypass entry rules — the gate only stops the *automatic* ones.

---

## 🔎 Coins Found — automatic coin discovery

You no longer have to hunt for contract addresses by hand. The **Coins Found** section
sweeps live BSC pairs from DexScreener and shows only the coins that pass **your**
screening filters — every one of them editable from the dashboard:

| Filter | What it does |
|---|---|
| **Min liquidity (USD)** | Pool-depth floor — keeps out coins you couldn't exit |
| **Min 24h volume (USD)** | Requires real trading activity |
| **Min age (days)** | **Coin must be at least this old** (default 30 days) — filters out fresh launches and rug-prone brand-new pairs |
| **Max age (days)** | Optional upper bound (`0` = no limit) if you only want newer coins |
| **Min 24h transactions** | Filters out coins with a handful of trades |
| **Min / max market cap** | Target a size band (`0` = no limit) |
| **Hide stablecoins & WBNB** | They're not trade candidates |
| **Sort by** | Liquidity · volume · age · market cap · 24h change |

How it works:
1. Set your filters → **Save Filters & Find Coins**.
2. You get a batch of **20 coins** that pass, each showing symbol, name, **age**,
   liquidity, 24h volume, market cap, 24h transactions, 24h change, DEX, and a
   BscScan link.
3. **✓ Enable for trading** verifies the token on-chain (real pool on a supported DEX)
   and adds it straight to your halal trading list.
4. **Skip** hides a coin permanently for your profile — so **Show me another 20**
   is always a fresh set, never the same coins again. **Un-skip all** resets that.

Coins already on your trading list are automatically excluded. The candidate sweep is
cached for 90 seconds and shared across profiles, so paging through batches costs no
extra API calls. Skip lists and filters are **per profile** — nobody sees yours.

> ⚠️ Discovery is a *screener*, not an endorsement. It only proves a coin met your
> numeric thresholds. **Always verify a coin is halal yourself before enabling it.**

API: `GET /api/discover?offset=0` · `POST /api/discover/filters` ·
`POST /api/discover/enable` · `POST /api/discover/dismiss` · `POST /api/discover/reset`

---

## ⚡ Live position monitoring — every BSC block

Entry discovery remains timer-based because 1h/24h signals do not need sub-second
polling. The moment a position opens, exit protection becomes event-driven:

1. `server.js` opens a BSC WebSocket and subscribes to `newHeads` / every new block.
2. Each block immediately checks every open position, whether the profile's bot toggle
   is on or off.
3. The trigger price is an **exact-size executable sell quote** for the remaining position
   across all supported DEXes — including pool price impact — not a stale chart price.
4. If one pump crosses several TP targets, they execute together in **one transaction**.
5. A per-position lock blocks duplicate exits from overlapping block/watchdog/UI checks;
   a per-profile wallet queue also prevents nonce races between two token exits.

Reliability safeguards:
- Chain ID must be **56** or the socket is rejected.
- A feed with no block for `LIVE_STALE_SECONDS` is treated as dead, destroyed, and
  reconnected with exponential backoff.
- The dashboard shows **LIVE · block number**, **CONNECTING**, **RECONNECTING**, or
  **FALLBACK**.
- An independent HTTP watchdog checks all positions every
  `POSITION_WATCHDOG_INTERVAL_SECONDS` (default 15s), even while WSS is healthy.
- Dashboard snapshots refresh every 3s, but trading decisions happen server-side on
  blocks — closing the browser does not stop protection.

### Local test on your device

```bash
npm install
cp .env.example .env       # fill encryption + Upstash values
npm start
```

If `BSC_WSS_URL` is blank, local `npm start` uses the verified public testing endpoint
`wss://bsc-rpc.publicnode.com`. For real-money Node.js hosting, set your own managed
BSC WSS URL from Chainstack, QuickNode, Ankr, NodeReal, or another provider; public
endpoints can rate-limit or disconnect.

> Live monitoring requires persistent Node.js hosting. Vercel/serverless cannot retain
> a WebSocket connection and therefore only has cron/watchdog-style checks.

---

## 🌐 Hosting options

### Option A — Any Node.js host / VPS / Railway / Render / Termux (recommended)
```bash
npm install
npm start          # Express + live WSS exits + HTTP watchdog + entry scheduler
```
Open positions are checked on every new BSC block. The 15-second HTTP watchdog is a
safety fallback, while each profile's own scan interval controls only new entries.

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
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. `BSC_WSS_URL` is optional for
local testing (a public default is provided) but strongly recommended with your own
managed endpoint for real-money hosting. Everything per-person (strategy, bankroll %,
tokens, wallet…) is set from the dashboard.

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
│   │   ├── strategies.js     ← Per-profile editable SL/TP ladders (CRUD + validation)
│   │   ├── entryrules.js     ← Editable "when to buy" conditions (pure logic)
│   │   ├── discovery.js      ← Coin discovery sweep + editable screening filters
│   │   ├── livefeed.js       ← Live BSC blocks, stale detection, reconnect + status
│   │   ├── wallet.js         ← Connect/disconnect, decrypt-on-demand signer
│   │   ├── pancakeswap.js    ← Spot swap execution (takes an explicit signer)
│   │   ├── market.js         ← DexScreener prices + on-chain token metadata
│   │   ├── strategy.js       ← Open/close position logic, TP/SL evaluation
│   │   ├── scanner.js        ← Per-profile cycle + runs-every-profile helper
│   │   └── telegram.js       ← Optional alerts
│   └── routes/
│       ├── auth.js            ← Register/login, session tokens
│       ├── wallet.js          ← Connect/disconnect/status
│       ├── strategies.js      ← Strategy CRUD (add/edit/delete ladders)
│       ├── discover.js        ← Coins Found: batches, filters, enable/skip
│       └── status.js  trade.js  positions.js  tokens.js  settings.js  scan.js
├── public/
│   └── index.html             ← The dashboard (vanilla HTML/CSS/JS, no build step)
├── test/
│   ├── test_crypto.js         ← Encryption round-trip, tamper detection, hashing
│   ├── test_direct.js         ← Strategy engine logic (mocked), profile isolation
│   ├── test_http.js           ← Full HTTP API (mocked), two-profile cross-check
│   ├── test_rules.js          ← Editable strategies, entry rules, coin discovery
│   ├── test_live.js           ← Fake-WSS live blocks, coalescing, reconnect, fallback
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
