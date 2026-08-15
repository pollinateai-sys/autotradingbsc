// ============================================================
//  TRADING STRATEGIES
//  Each strategy defines: stop loss + multiple take profit levels
//  with what % of your position to sell at each level.
//
//  HOW TO ADD YOUR OWN STRATEGY:
//  1. Copy Strategy A or B block
//  2. Give it a new key like "C"
//  3. Set your SL and TP levels
//  4. Change activeStrategy in settings.js to "C"
// ============================================================

const STRATEGIES = {

  // ── STRATEGY A ─────────────────────────────────────────────
  // Bankroll: 0.25–0.5% per trade
  // Sells 25% of position at each TP level
  A: {
    name:         "Strategy A — Equal Split",
    description:  "0.25-0.5% bankroll, equal 25% sells at each TP",
    stopLoss:     -40,    // Sell 100% if price drops 40%
    takeProfits: [
      { targetPercent: +50,  sellPercent: 25 },   // TP1: +50%  → sell 25%
      { targetPercent: +100, sellPercent: 25 },   // TP2: +100% → sell 25%
      { targetPercent: +200, sellPercent: 25 },   // TP3: +200% → sell 25%
      { targetPercent: +400, sellPercent: 25 },   // TP4: +400% → sell 25%
    ],
    // Total sold: 100%
  },

  // ── STRATEGY B ─────────────────────────────────────────────
  // Heavier first sell, lighter last sell
  B: {
    name:         "Strategy B — Front-Heavy",
    description:  "Sell more early, less at higher levels",
    stopLoss:     -40,    // Sell 100% if price drops 40%
    takeProfits: [
      { targetPercent: +50,  sellPercent: 30 },   // TP1: +50%  → sell 30%
      { targetPercent: +100, sellPercent: 25 },   // TP2: +100% → sell 25%
      { targetPercent: +200, sellPercent: 25 },   // TP3: +200% → sell 25%
      { targetPercent: +400, sellPercent: 20 },   // TP4: +400% → sell 20%
    ],
    // Total sold: 100%
  },

  // ── STRATEGY C (CUSTOM — edit to your liking) ──────────────
  C: {
    name:         "Strategy C — Conservative",
    description:  "Tighter stop loss, lower but safer targets",
    stopLoss:     -25,
    takeProfits: [
      { targetPercent: +30,  sellPercent: 30 },
      { targetPercent: +60,  sellPercent: 30 },
      { targetPercent: +100, sellPercent: 25 },
      { targetPercent: +150, sellPercent: 15 },
    ],
  },

};

/**
 * Validate a strategy is correctly defined.
 * Total sellPercent across all TPs must equal 100.
 */
function validateStrategy(key) {
  const strat = STRATEGIES[key];
  if (!strat) throw new Error(`Strategy "${key}" not found.`);
  const total = strat.takeProfits.reduce((s, tp) => s + tp.sellPercent, 0);
  if (total !== 100) {
    throw new Error(
      `Strategy "${key}" TP sell percentages total ${total}% — must be 100%.`
    );
  }
  return strat;
}

module.exports = { STRATEGIES, validateStrategy };
