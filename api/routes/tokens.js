// ============================================================
//  TOKEN MANAGER ROUTES (per profile)
//  GET  /api/tokens              → list this profile's tokens
//  POST /api/tokens/preview      → { contract } → fetch metadata (no save)
//  POST /api/tokens/add          → { contract, symbol?, name? } → add
//  POST /api/tokens/remove       → { symbol } → remove
//  POST /api/tokens/toggle       → { symbol, enabled } → enable/disable
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { getTokens, addToken, removeToken, toggleToken } = require("../lib/redis");
const { getTokenMetadata, getTokenInfo } = require("../lib/market");

router.get("/", requireProfile, async (req, res) => {
  try {
    const tokens = await getTokens(req.profileId);

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

router.post("/preview", requireProfile, async (req, res) => {
  try {
    const { contract } = req.body;
    if (!contract) return res.status(400).json({ ok: false, error: "Missing contract address" });
    const meta = await getTokenMetadata(contract);
    res.json({ ok: true, token: meta });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/add", requireProfile, async (req, res) => {
  try {
    const { contract, symbol, name } = req.body;
    if (!contract) return res.status(400).json({ ok: false, error: "Missing contract address" });

    const meta = await getTokenMetadata(contract);
    const token = {
      symbol:   symbol || meta.symbol,
      name:     name   || meta.name,
      contract: meta.contract,
      enabled:  true,
      addedManually: true,
      addedAt:  new Date().toISOString(),
    };

    const tokens = await addToken(req.profileId, token);
    res.json({ ok: true, token, tokens });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/remove", requireProfile, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
    const tokens = await removeToken(req.profileId, symbol);
    res.json({ ok: true, tokens });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/toggle", requireProfile, async (req, res) => {
  try {
    const { symbol, enabled } = req.body;
    if (!symbol || typeof enabled !== "boolean") {
      return res.status(400).json({ ok: false, error: "Missing symbol or enabled (boolean)" });
    }
    const token = await toggleToken(req.profileId, symbol, enabled);
    res.json({ ok: true, token });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
