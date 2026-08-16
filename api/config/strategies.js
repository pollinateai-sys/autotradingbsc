// ============================================================
//  TRADING STRATEGIES — SL + Multi-TP
//  Change activeStrategy in your Vercel env vars (ACTIVE_STRATEGY)
// ============================================================
const STRATEGIES = {

  // Strategy A — Equal Split (0.25-0.5% bankroll recommended)
  A: {
    name:        "Strategy A — Equal Split",
    stopLoss:    -40,
    takeProfits: [
      { targetPercent: 50,  sellPercent: 25 },
      { targetPercent: 100, sellPercent: 25 },
      { targetPercent: 200, sellPercent: 25 },
      { targetPercent: 400, sellPercent: 25 },
    ],
  },

  // Strategy B — Front Heavy
  B: {
    name:        "Strategy B — Front Heavy",
    stopLoss:    -40,
    takeProfits: [
      { targetPercent: 50,  sellPercent: 30 },
      { targetPercent: 100, sellPercent: 25 },
      { targetPercent: 200, sellPercent: 25 },
      { targetPercent: 400, sellPercent: 20 },
    ],
  },

  // Strategy C — Conservative
  C: {
    name:        "Strategy C — Conservative",
    stopLoss:    -25,
    takeProfits: [
      { targetPercent: 30,  sellPercent: 30 },
      { targetPercent: 60,  sellPercent: 30 },
      { targetPercent: 100, sellPercent: 25 },
      { targetPercent: 150, sellPercent: 15 },
    ],
  },
};

function getStrategy(key) {
  const strat = STRATEGIES[key || "A"];
  if (!strat) throw new Error(`Strategy "${key}" not found.`);
  const total = strat.takeProfits.reduce((s, tp) => s + tp.sellPercent, 0);
  if (total !== 100) throw new Error(`Strategy "${key}" TPs must total 100%.`);
  return strat;
}

module.exports = { STRATEGIES, getStrategy };
