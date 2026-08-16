// GET /api/status — full dashboard snapshot in one call
const express = require("express");
const router  = express.Router();
const { getBnbBalance, getAddress } = require("../lib/wallet");
const { getPositions, getStats, getSettings, getTokens } = require("../lib/redis");
const { getStrategy } = require("../config/strategies");

router.get("/", async (req, res) => {
  try {
    const [balance, positions, stats, settings, tokens] = await Promise.all([
      getBnbBalance(),
      getPositions(),
      getStats(),
      getSettings(),
      getTokens(),
    ]);
    const strategy = getStrategy(settings.activeStrategy);

    res.json({
      ok: true,
      wallet: {
        address:    getAddress(),
        bnbBalance: balance,
      },
      settings,
      strategy: { key: settings.activeStrategy, ...strategy },
      positions: Object.values(positions),
      openCount: Object.keys(positions).length,
      stats,
      tokenCount: tokens.length,
      enabledTokenCount: tokens.filter(t => t.enabled).length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
