// ============================================================
//  SCAN ROUTES
//  GET  /api/cron/scan   → auto scan (respects botRunning + cron auth)
//  POST /api/scan/now    → manual scan from dashboard (ignores botRunning)
// ============================================================

const express = require("express");
const router  = express.Router();
const { runScanCycle } = require("../lib/scanner");

function auth(req, res, next) {
  const secret = process.env.BOT_SECRET;
  if (secret && req.headers["x-bot-secret"] !== secret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

// Called by external cron (Vercel Cron, cron-job.org, or your own scheduler)
router.get("/cron/scan", async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers["authorization"];
    const manual     = req.headers["x-bot-secret"];
    const validCron  = authHeader === `Bearer ${cronSecret}`;
    const validManual= manual === process.env.BOT_SECRET;
    if (!validCron && !validManual) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
  }
  try {
    const result = await runScanCycle({ force: false });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Called manually from the dashboard "Scan Now" button
router.post("/scan/now", auth, async (req, res) => {
  try {
    const result = await runScanCycle({ force: true });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
