// ============================================================
//  STRATEGY ROUTES (per profile) — full CRUD
//  GET    /api/strategies          → this profile's strategies + active key
//  POST   /api/strategies          → { name, stopLoss, takeProfits[] } → create
//  POST   /api/strategies/update   → { key, name?, stopLoss?, takeProfits? } → edit
//  POST   /api/strategies/delete   → { key } → delete (guarded)
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const store = require("../lib/strategies");
const { getSettings } = require("../lib/redis");

router.get("/", requireProfile, async (req, res) => {
  try {
    const [strategies, settings] = await Promise.all([
      store.getStrategies(req.profileId),
      getSettings(req.profileId),
    ]);
    res.json({ ok: true, strategies, activeStrategy: settings.activeStrategy });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/", requireProfile, async (req, res) => {
  try {
    const strategy   = await store.createStrategy(req.profileId, req.body || {});
    const strategies = await store.getStrategies(req.profileId);
    res.json({ ok: true, strategy, strategies });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/update", requireProfile, async (req, res) => {
  try {
    const { key, ...patch } = req.body || {};
    if (!key) return res.status(400).json({ ok: false, error: "Missing strategy key" });
    const strategy = await store.updateStrategy(req.profileId, key, patch);
    res.json({ ok: true, strategy });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/delete", requireProfile, async (req, res) => {
  try {
    const { key } = (req.body || {});
    if (!key) return res.status(400).json({ ok: false, error: "Missing strategy key" });
    const removed = await store.deleteStrategy(req.profileId, key);
    res.json({ ok: true, removed: { key: removed.key, name: removed.name } });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
