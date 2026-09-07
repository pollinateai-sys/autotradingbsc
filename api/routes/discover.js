// ============================================================
//  COIN DISCOVERY ROUTES (per profile)
//  GET  /api/discover?offset=0[&force=1] → next batch of coins
//                                          passing your filters
//  POST /api/discover/enable   { contract } → add to trading list
//  POST /api/discover/dismiss  { contract } → hide it, free up a
//                                             slot in the next 20
//  POST /api/discover/reset    → un-dismiss everything
//  POST /api/discover/filters  { ...filters } → save screening rules
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const {
  discoverCoins, validateDiscoveryFilters, DEFAULT_DISCOVERY_FILTERS,
} = require("../lib/discovery");
const {
  getSettings, updateSettings, getTokens, addToken,
  getDismissedCoins, saveDismissedCoins,
} = require("../lib/redis");
const { getTokenMetadata } = require("../lib/market");

router.get("/", requireProfile, async (req, res) => {
  try {
    const settings  = await getSettings(req.profileId);
    const filters   = settings.discoveryFilters || DEFAULT_DISCOVERY_FILTERS;
    const offset    = parseInt(req.query.offset || "0", 10) || 0;
    const force     = req.query.force === "1" || req.query.force === "true";

    // Never show coins already on the trading list, or ones dismissed
    const [tokens, dismissed] = await Promise.all([
      getTokens(req.profileId),
      getDismissedCoins(req.profileId),
    ]);
    const exclude = [...tokens.map(t => t.contract), ...dismissed];

    const result = await discoverCoins({ filters, offset, exclude, force });
    res.json({ ok: true, filters, dismissedCount: dismissed.length, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/filters", requireProfile, async (req, res) => {
  try {
    const filters  = validateDiscoveryFilters(req.body || {});
    const settings = await updateSettings(req.profileId, { discoveryFilters: filters });
    res.json({ ok: true, filters: settings.discoveryFilters });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// Enable a discovered coin = verify it on-chain, then add it to the
// trading list (same validation path as a manually pasted address)
router.post("/enable", requireProfile, async (req, res) => {
  try {
    const { contract } = req.body || {};
    if (!contract) return res.status(400).json({ ok: false, error: "Missing contract address" });

    const meta = await getTokenMetadata(contract);
    if (!meta.hasOnChainPool) {
      return res.status(400).json({ ok: false, error: "No tradeable liquidity pool found on any supported DEX" });
    }

    const token = {
      symbol:     meta.symbol,
      name:       meta.name,
      contract:   meta.contract,
      enabled:    true,
      bestDex:    meta.bestDex,
      addedVia:   "discovery",
      addedAt:    new Date().toISOString(),
    };
    const tokens = await addToken(req.profileId, token);
    res.json({ ok: true, token, tokenCount: tokens.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/dismiss", requireProfile, async (req, res) => {
  try {
    const { contract } = req.body || {};
    if (!contract) return res.status(400).json({ ok: false, error: "Missing contract address" });
    const dismissed = await getDismissedCoins(req.profileId);
    const key = String(contract).toLowerCase();
    if (!dismissed.includes(key)) dismissed.push(key);
    await saveDismissedCoins(req.profileId, dismissed.slice(-500)); // keep it bounded
    res.json({ ok: true, dismissedCount: dismissed.length });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/reset", requireProfile, async (req, res) => {
  try {
    await saveDismissedCoins(req.profileId, []);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
