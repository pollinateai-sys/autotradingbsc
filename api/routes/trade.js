// ============================================================
//  MANUAL TRADE ROUTES
//  POST /api/trade/buy   { symbol } → manually open a position
//  POST /api/trade/close { symbol } → manually close a position fully
//  POST /api/trade/check { symbol } → check SL/TP for one position
// ============================================================

const express = require("express");
const router  = express.Router();
const { openPosition, checkAndExecuteExits, closePositionManual } = require("../lib/strategy");
const { getPosition, getPositions, getTokens, getSettings } = require("../lib/redis");

function auth(req, res, next) {
  const secret = process.env.BOT_SECRET;
  if (secret && req.headers["x-bot-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

router.post("/buy", auth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });

    const tokens = await getTokens();
    const token  = tokens.find(t => t.symbol === symbol && t.enabled);
    if (!token) return res.status(404).json({ ok: false, error: `Token ${symbol} not found or disabled` });

    const existing = await getPosition(symbol);
    if (existing) return res.status(409).json({ ok: false, error: `Already have open position for ${symbol}` });

    const settings  = await getSettings();
    const positions = await getPositions();
    if (Object.keys(positions).length >= settings.maxOpenTrades) {
      return res.status(429).json({ ok: false, error: `Max open trades (${settings.maxOpenTrades}) reached` });
    }

    const position = await openPosition(token);
    res.json({ ok: true, position });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/close", auth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const result = await closePositionManual(symbol);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/check", auth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const result = await checkAndExecuteExits(symbol);
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
