// ============================================================
//  SETTINGS ROUTES
//  GET  /api/settings          → current settings + available strategies
//  POST /api/settings/update   → patch settings (strategy, bankroll%, etc)
//  POST /api/settings/start    → set botRunning = true
//  POST /api/settings/stop     → set botRunning = false
// ============================================================

const express = require("express");
const router  = express.Router();
const { getSettings, updateSettings } = require("../lib/redis");
const { STRATEGIES, getStrategy } = require("../config/strategies");

function auth(req, res, next) {
  const secret = process.env.BOT_SECRET;
  if (secret && req.headers["x-bot-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

const ALLOWED_FIELDS = [
  "activeStrategy", "bankrollPercent", "maxOpenTrades",
  "maxSlippagePercent", "minLiquidityUsd", "autoTrade",
  "botRunning", "scanIntervalMinutes", "minBnbReserve",
];

router.get("/", async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      ok: true,
      settings,
      strategies: Object.entries(STRATEGIES).map(([key, s]) => ({ key, ...s })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/update", auth, async (req, res) => {
  try {
    const patch = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, error: "No valid fields provided" });
    }

    // Validate strategy exists
    if (patch.activeStrategy) {
      getStrategy(patch.activeStrategy); // throws if invalid
    }
    // Validate numeric bounds
    if (patch.bankrollPercent !== undefined) {
      patch.bankrollPercent = Math.max(0.01, Math.min(10, parseFloat(patch.bankrollPercent)));
    }
    if (patch.maxOpenTrades !== undefined) {
      patch.maxOpenTrades = Math.max(1, Math.min(20, parseInt(patch.maxOpenTrades)));
    }
    if (patch.maxSlippagePercent !== undefined) {
      patch.maxSlippagePercent = Math.max(0.1, Math.min(5, parseFloat(patch.maxSlippagePercent)));
    }
    if (patch.minLiquidityUsd !== undefined) {
      patch.minLiquidityUsd = Math.max(0, parseFloat(patch.minLiquidityUsd));
    }
    if (patch.scanIntervalMinutes !== undefined) {
      patch.scanIntervalMinutes = Math.max(1, Math.min(1440, parseInt(patch.scanIntervalMinutes)));
    }

    const updated = await updateSettings(patch);
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/start", auth, async (req, res) => {
  try {
    const updated = await updateSettings({ botRunning: true });
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/stop", auth, async (req, res) => {
  try {
    const updated = await updateSettings({ botRunning: false });
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
