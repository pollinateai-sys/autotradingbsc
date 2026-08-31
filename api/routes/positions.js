// ============================================================
//  POSITIONS ROUTES (per profile)
//  GET /api/positions      → open positions enriched with live price
//  GET /api/positions/log  → trade history
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { getPositions, getTradeLog, getSettings } = require("../lib/redis");
const { getCurrentPriceBnb, getExecutableSellPriceBnb } = require("../lib/dex");
const { getProvider } = require("../lib/wallet");
const { resolvePositionStrategy } = require("../lib/strategies");

router.get("/", requireProfile, async (req, res) => {
  try {
    const positions = await getPositions(req.profileId);
    const symbols    = Object.keys(positions);
    const provider   = getProvider();

    const settings = await getSettings(req.profileId);

    const enriched = await Promise.all(symbols.map(async (symbol) => {
      const pos = positions[symbol];
      // The live server persists a fresh executable-price snapshot every few
      // seconds. Reuse it for the dashboard; only hit RPC directly if that
      // snapshot is missing/stale (e.g. Vercel or watchdog fallback).
      const snapshotAt = pos.lastPriceAt ? new Date(pos.lastPriceAt).getTime() : 0;
      const snapshotFresh = pos.currentPrice != null && Date.now() - snapshotAt < 10_000;
      let price = snapshotFresh ? pos.currentPrice : null;
      if (!price && typeof getExecutableSellPriceBnb === "function") {
        price = await getExecutableSellPriceBnb(provider, pos.contract, pos.remainingTokens).catch(() => null);
      }
      if (!price) price = await getCurrentPriceBnb(provider, pos.contract).catch(() => null);
      const strategy = await resolvePositionStrategy(req.profileId, pos, settings);
      const changePct = price
        ? ((price - pos.entryPriceBnb) / pos.entryPriceBnb) * 100
        : null;

      const nextTpIndex = strategy.takeProfits.findIndex((_, i) => !pos.tpHit.includes(i));
      const nextTp = nextTpIndex >= 0 ? strategy.takeProfits[nextTpIndex] : null;

      return {
        ...pos,
        currentPrice: price,
        changePct,
        strategyName: strategy.name,
        stopLoss:     strategy.stopLoss,
        tpProgress:   `${pos.tpHit.length}/${strategy.takeProfits.length}`,
        nextTpTarget: nextTp ? nextTp.targetPercent : null,
        heldHours:    (Date.now() - pos.openTime) / 3600000,
      };
    }));

    res.json({ ok: true, positions: enriched, count: enriched.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/log", requireProfile, async (req, res) => {
  try {
    const log = await getTradeLog(req.profileId);
    res.json({ ok: true, log, count: log.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
