// ============================================================
//  TOKEN MANAGER ROUTES
//  GET    /api/tokens              → list all tokens
//  POST   /api/tokens/preview      → { contract } → fetch metadata (no save)
//  POST   /api/tokens/add          → { contract, symbol?, name? } → add to list
//  POST   /api/tokens/remove       → { symbol } → remove from list
//  POST   /api/tokens/toggle       → { symbol, enabled } → enable/disable
// ============================================================

const express = require("express");
const router  = express.Router();
const { getTokens, addToken, removeToken, toggleToken } = require("../lib/redis");
const { getTokenMetadata, getTokenInfo } = require("../lib/market");

function auth(req, res, next) {
  const secret = process.env.BOT_SECRET;
  if (secret && req.headers["x-bot-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized — missing or wrong x-bot-secret header" });
  }
  next();
}

// ── LIST ──────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const tokens = await getTokens();

    // Enrich with live price data (best-effort, ignore failures)
    const enriched = await Promise.all(tokens.map(async (t) => {
      const info = await getTokenInfo(t.contract).catch(() => null);
      return {
        ...t,
        priceUsd:     info?.priceUsd     ?? null,
        change24h:    info?.change24h    ?? null,
        liquidityUsd: info?.liquidityUsd ?? null,
        volume24h:    info?.volume24h    ?? null,
      };
    }));

    res.json({ ok: true, tokens: enriched });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PREVIEW (fetch metadata before adding) ─────────────────
router.post("/preview", auth, async (req, res) => {
  try {
    const { contract } = req.body;
    if (!contract) return res.status(400).json({ ok: false, error: "Missing contract address" });
    const meta = await getTokenMetadata(contract);
    res.json({ ok: true, token: meta });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── ADD ───────────────────────────────────────────────────
router.post("/add", auth, async (req, res) => {
  try {
    const { contract, symbol, name } = req.body;
    if (!contract) return res.status(400).json({ ok: false, error: "Missing contract address" });

    // Always verify on-chain before adding
    const meta = await getTokenMetadata(contract);

    const token = {
      symbol:   symbol || meta.symbol,
      name:     name   || meta.name,
      contract: meta.contract,
      enabled:  true,
      addedManually: true,
      addedAt:  new Date().toISOString(),
    };

    const tokens = await addToken(token);
    res.json({ ok: true, token, tokens });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── REMOVE ────────────────────────────────────────────────
router.post("/remove", auth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const tokens = await removeToken(symbol);
    res.json({ ok: true, tokens });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ── TOGGLE ENABLE/DISABLE ───────────────────────────────────
router.post("/toggle", auth, async (req, res) => {
  try {
    const { symbol, enabled } = req.body;
    if (!symbol || typeof enabled !== "boolean") {
      return res.status(400).json({ ok: false, error: "Missing symbol or enabled (boolean)" });
    }
    const token = await toggleToken(symbol, enabled);
    res.json({ ok: true, token });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
