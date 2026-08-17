// ============================================================
//  SCAN ROUTES
//  POST /api/scan/now   → scan just the authenticated profile
//                          (dashboard "Scan Now" button)
//  GET  /api/cron/scan  → scan ALL profiles (for an external
//                          scheduler / Vercel Cron — no persistent
//                          server.js loop available in that setup)
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { runProfileCycle, runAllProfiles } = require("../lib/scanner");

router.post("/scan/now", requireProfile, async (req, res) => {
  try {
    const result = await runProfileCycle(req.profileId, { force: true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/cron/scan", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers["authorization"];
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  try {
    const result = await runAllProfiles({ force: false });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
