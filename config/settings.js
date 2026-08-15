// ============================================================
//  BOT SETTINGS & FEATURE TOGGLES
//  Change values here — no need to touch any other file.
// ============================================================

const SETTINGS = {

  // ── STRATEGY SELECTION ─────────────────────────────────────
  // "A" = Strategy A: 0.25-0.5% bankroll, SL -40%, TP 50/100/200/400 (25% each)
  // "B" = Strategy B: SL -40%, TP 50/100/200/400 (30/25/25/20%)
  activeStrategy: "A",

  // ── TRADE SIZING ───────────────────────────────────────────
  // Percentage of total BNB balance to use per trade
  // Strategy A recommends 0.25–0.5% of bankroll
  bankrollPercent: 0.5,        // 0.5% of your BNB per trade
  minBnbReserve:  0.01,        // Always keep this much BNB for gas

  // ── SCAN SETTINGS ──────────────────────────────────────────
  scanIntervalMs:    30 * 60 * 1000,  // Scan every 30 minutes
  priceCheckMs:      10 * 1000,       // Check prices every 10 seconds
  maxOpenTrades:     3,               // Max simultaneous open positions

  // ── SAFETY ─────────────────────────────────────────────────
  maxSlippagePercent:       1.0,      // Abort trade if slippage > 1%
  minLiquidityUsd:          10000,    // Skip tokens with < $10k liquidity
  requireVerifiedContract:  true,     // Only BscScan-verified contracts

  // ── FEATURES ───────────────────────────────────────────────
  autoTrade:         true,    // Execute real trades (false = signal log only)
  telegramAlerts:    true,    // Send Telegram notifications
  logToFile:         true,    // Save all activity to logs/

  // ── PANCAKESWAP ────────────────────────────────────────────
  pancakeRouterV2:   "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  pancakeRouterV3:   "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  wbnbAddress:       "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  useV2Router:       true,    // V2 is simpler and more reliable for most tokens
};

module.exports = SETTINGS;
