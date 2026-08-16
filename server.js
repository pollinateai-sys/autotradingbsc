// ============================================================
//  SERVER.JS — Entry point for persistent hosting
//  (VPS, Railway, Render, Docker, your own PC — anything that
//  can run "node server.js" and keep it alive 24/7)
//
//  This starts:
//   1. The Express web server (dashboard + API)
//   2. A fast loop that checks open positions for SL/TP
//   3. A slower loop that scans for new entries (if botRunning)
//
//  NOT needed on Vercel — Vercel uses api/index.js directly
//  plus the /api/cron/scan route on a schedule instead.
// ============================================================

// ── Friendly check: catch the #1 first-run mistake ──────────
// (running `npm start` before `npm install`) with a clear fix
// instead of Node's raw MODULE_NOT_FOUND stack trace. Checked
// before any third-party require, so it doesn't matter which
// package Node would have hit first.
const fs   = require("fs");
const path = require("path");
if (!fs.existsSync(path.join(__dirname, "node_modules"))) {
  console.error("\n❌ Dependencies are not installed yet.\n");
  console.error("   Run this first, from inside the autotradingbsc folder:\n");
  console.error("     npm install\n");
  console.error("   Then run:\n");
  console.error("     npm start\n");
  process.exit(1);
}

require("dotenv").config();

const app = require("./api/index");
const { checkAllPositions, scanForNewEntries } = require("./api/lib/scanner");
const { getSettings, updateStats } = require("./api/lib/redis");
const { getAddress, getBnbBalance } = require("./api/lib/wallet");
const telegram = require("./api/lib/telegram");

const PORT = process.env.PORT || 3000;

const POSITION_CHECK_SECONDS = parseInt(process.env.POSITION_CHECK_INTERVAL_SECONDS || "60");

const BANNER = `
╔══════════════════════════════════════════════════════════╗
║          HALAL BSC TRADING BOT — v2.0                    ║
║          Spot Only | BEP20 | PancakeSwap V2               ║
║          No AI | No Leverage | No Interest                ║
╚══════════════════════════════════════════════════════════╝`;

let scanTimer = null;

// ── Fast loop: always checks SL/TP on open positions ────────
async function positionMonitorLoop() {
  try {
    const results = await checkAllPositions();
    if (results.length > 0) {
      console.log(`  🔎 Position check | ${results.length} position(s) evaluated`);
      results.forEach(r => {
        if (r.action && r.action !== "HOLD") {
          console.log(`     → ${r.symbol}: ${r.action} (${r.changePct?.toFixed(2)}%)`);
        }
      });
    }
  } catch (e) {
    console.error("  ❌ Position monitor error:", e.message);
  }
  setTimeout(positionMonitorLoop, POSITION_CHECK_SECONDS * 1000);
}

// ── Slower loop: scans for new entries (respects botRunning) ─
async function scanLoop() {
  try {
    const settings = await getSettings();
    if (settings.botRunning) {
      console.log(`\n  🔍 Running full scan cycle...`);
      const results = await scanForNewEntries();
      console.log(
        `  ✅ Scan complete | Opened: ${results.opened.length} | ` +
        `Skipped: ${results.skipped.length} | Errors: ${results.errors.length}`
      );
      await updateStats({ lastScan: new Date().toISOString() });
    } else {
      console.log(`  ⏸️  Bot stopped — skipping entry scan (positions still monitored)`);
    }

    const nextSettings = await getSettings();
    const intervalMs   = Math.max(1, nextSettings.scanIntervalMinutes) * 60 * 1000;
    scanTimer = setTimeout(scanLoop, intervalMs);

  } catch (e) {
    console.error("  ❌ Scan loop error:", e.message);
    scanTimer = setTimeout(scanLoop, 60 * 1000); // retry in 1 min on error
  }
}

// ── Startup ──────────────────────────────────────────────────
async function start() {
  console.log(BANNER);

  try {
    const address = getAddress();
    const balance = await getBnbBalance();
    console.log(`  💼 Wallet    : ${address}`);
    console.log(`  💰 Balance   : ${balance.toFixed(6)} BNB`);
  } catch (e) {
    console.error(`  ❌ Wallet error: ${e.message}`);
    console.error(`  ⚠️  Set PRIVATE_KEY in your .env file.`);
    process.exit(1);
  }

  const settings = await getSettings();
  console.log(`  📐 Strategy  : ${settings.activeStrategy}`);
  console.log(`  🔘 Bot state : ${settings.botRunning ? "RUNNING" : "STOPPED"}`);
  console.log(`  💵 Bankroll  : ${settings.bankrollPercent}% per trade`);
  console.log(`  📊 Auto-trade: ${settings.autoTrade ? "LIVE (real trades)" : "SIGNAL-ONLY (simulated)"}`);

  app.listen(PORT, () => {
    console.log(`\n  ✅ Dashboard running at http://localhost:${PORT}`);
    console.log(`  ✅ Position monitor: every ${POSITION_CHECK_SECONDS}s`);
    console.log(`  ✅ Entry scanner   : every ${settings.scanIntervalMinutes} min (when bot is running)\n`);
  });

  telegram.sendInfo(`🤖 Bot server started\nWallet: ${getAddress()}\nStrategy: ${settings.activeStrategy}`);

  // Start both loops
  positionMonitorLoop();
  scanLoop();
}

// ── Graceful shutdown ────────────────────────────────────────
process.on("SIGINT", async () => {
  console.log("\n\n  ⛔ Shutting down gracefully...");
  if (scanTimer) clearTimeout(scanTimer);
  await telegram.sendInfo("🛑 Bot server stopped (SIGINT)");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n  ⛔ SIGTERM received — shutting down...");
  if (scanTimer) clearTimeout(scanTimer);
  await telegram.sendInfo("🛑 Bot server stopped (SIGTERM)");
  process.exit(0);
});

process.on("uncaughtException", async (err) => {
  console.error("  ❌ Uncaught exception:", err);
  await telegram.sendError(`Uncaught exception: ${err.message}`);
  // Don't exit — keep the dashboard alive, just log it
});

start().catch((e) => {
  console.error("❌ Fatal startup error:", e.message);
  process.exit(1);
});
