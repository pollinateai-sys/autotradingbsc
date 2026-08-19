// ============================================================
//  SETTINGS ROUTES (per profile)
//  GET  /api/settings          → this profile's settings + strategies
//  POST /api/settings/update   → patch settings
//  POST /api/settings/start    → set botRunning = true (needs wallet)
//  POST /api/settings/stop     → set botRunning = false
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { getSettings, updateSettings, hasWallet } = require("../lib/redis");
const { STRATEGIES, getStrategy } = require("../config/strategies");

const ALLOWED_FIELDS = [
  "activeStrategy", "bankrollPercent", "maxOpenTrades",
  "maxSlippagePercent", "minLiquidityUsd", "autoTrade",
  "botRunning", "scanIntervalSeconds", "minBnbReserve",
];

router.get("/", requireProfile, async (req, res) => {
  try {
    const settings = await getSettings(req.profileId);
    res.json({
      ok: true,
      settings,
      strategies: Object.entries(STRATEGIES).map(([key, s]) => ({ key, ...s })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/update", requireProfile, async (req, res) => {
  try {
    const patch = {};
    for (const key of ALLOWED_FIELDS) {
      if (req.body[key] !== undefined) patch[key] = req.body[key];
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ ok: false, error: "No valid fields provided" });
    }

    if (patch.activeStrategy) getStrategy(patch.activeStrategy); // throws if invalid

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
    if (patch.scanIntervalSeconds !== undefined) {
      // Floor of 3s protects against accidental hammering even though
      // DexScreener's pair-data endpoint allows ~300 req/min (5/sec).
      patch.scanIntervalSeconds = Math.max(3, Math.min(3600, parseInt(patch.scanIntervalSeconds)));
    }

    // Can't turn the bot on without a wallet connected
    if (patch.botRunning === true && !(await hasWallet(req.profileId))) {
      return res.status(400).json({ ok: false, error: "Connect your wallet before starting the bot" });
    }

    const updated = await updateSettings(req.profileId, patch);
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/start", requireProfile, async (req, res) => {
  try {
    if (!(await hasWallet(req.profileId))) {
      return res.status(400).json({ ok: false, error: "Connect your wallet before starting the bot" });
    }
    const updated = await updateSettings(req.profileId, { botRunning: true });
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/stop", requireProfile, async (req, res) => {
  try {
    const updated = await updateSettings(req.profileId, { botRunning: false });
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
