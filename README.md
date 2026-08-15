# 🕌 Halal BSC Trading Bot

A **100% spot trading** bot for BEP20 tokens on Binance Smart Chain.
No AI. No leverage. No interest. No gambling mechanics.
Pure rule-based strategy with configurable Stop Loss and Take Profit levels.

---

## ⚡ Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up your environment
```bash
cp .env.example .env
# Edit .env and fill in your PRIVATE_KEY and BSCSCAN_API_KEY
```

### 3. Add your halal tokens
Edit `config/tokens.js` — add any BEP20 token contract you have verified as halal.

### 4. Pick your strategy
Edit `config/settings.js` → change `activeStrategy` to `"A"` or `"B"` or `"C"`.

### 5. Run the bot
```bash
npm start
```

---

## 📐 Strategies

| | Strategy A | Strategy B |
|---|---|---|
| **Stop Loss** | -40% | -40% |
| **TP1** | +50% → sell 25% | +50% → sell 30% |
| **TP2** | +100% → sell 25% | +100% → sell 25% |
| **TP3** | +200% → sell 25% | +200% → sell 25% |
| **TP4** | +400% → sell 25% | +400% → sell 20% |

You can add custom strategies in `config/strategies.js`.

---

## ⚙️ Settings (`config/settings.js`)

| Setting | Default | Description |
|---------|---------|-------------|
| `activeStrategy` | `"A"` | Which strategy to use |
| `bankrollPercent` | `0.5` | % of BNB balance per trade |
| `maxOpenTrades` | `3` | Max simultaneous positions |
| `scanIntervalMs` | `30 min` | How often to scan tokens |
| `priceCheckMs` | `10 sec` | How often to check SL/TP |
| `autoTrade` | `true` | Set `false` for signal-only mode |
| `maxSlippagePercent` | `1.0` | Max allowed slippage |

---

## 🔐 Security

- Private key is **never saved to any file** — loaded from `.env` or entered at runtime
- **Exact-amount approvals only** — never unlimited token approval
- `.gitignore` excludes `.env` and log files

---

## 📁 Project Structure

```
autotradingbsc/
├── config/
│   ├── tokens.js       ← YOUR halal token list (edit this)
│   ├── settings.js     ← Bot settings & feature toggles
│   └── strategies.js   ← SL/TP strategy definitions
├── src/
│   ├── main.js         ← Entry point
│   ├── wallet/         ← Key management, BNB balance
│   ├── executor/       ← PancakeSwap V2 trade execution
│   ├── strategy/       ← Strategy A/B/C engine
│   ├── monitor/        ← Open position tracking
│   ├── notifications/  ← Telegram alerts
│   ├── market/         ← Price data (DexScreener)
│   └── logs/           ← Audit logging
├── logs/               ← trades.log, errors.log
├── .env.example        ← Copy to .env and fill in
└── README.md
```

---

## ⚠️ Disclaimer

This bot is provided for educational purposes.
Crypto trading carries significant financial risk.
Always consult a qualified Islamic finance scholar before trading.
Never trade with money you cannot afford to lose.
