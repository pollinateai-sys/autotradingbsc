// ============================================================
//  MANUAL TRADE ROUTES (per profile)
//  POST /api/trade/buy   { symbol } → manually open a position
//  POST /api/trade/close { symbol } → manually close a position fully
//  POST /api/trade/check { symbol } → check SL/TP for one position
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { openPosition, checkAndExecuteExits, closePositionManual } = require("../lib/strategy");
const { getPosition, getPositions, getTokens, getSettings, hasWallet } = require("../lib/redis");

router.post("/buy", requireProfile, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const profileId = req.profileId;

    if (!(await hasWallet(profileId))) {
      return res.status(400).json({ ok: false, error: "Connect your wallet first" });
    }

    const tokens = await getTokens(profileId);
    const token  = tokens.find(t => t.symbol === symbol && t.enabled);
    if (!token) return res.status(404).json({ ok: false, error: `Token ${symbol} not found or disabled` });

    const existing = await getPosition(profileId, symbol);
    if (existing) return res.status(409).json({ ok: false, error: `Already have open position for ${symbol}` });

    const settings  = await getSettings(profileId);
    const positions = await getPositions(profileId);
    if (Object.keys(positions).length >= settings.maxOpenTrades) {
      return res.status(429).json({ ok: false, error: `Max open trades (${settings.maxOpenTrades}) reached` });
    }

    const position = await openPosition(profileId, token);
    res.json({ ok: true, position });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/close", requireProfile, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const result = await closePositionManual(req.profileId, symbol);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/check", requireProfile, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const result = await checkAndExecuteExits(req.profileId, symbol);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
