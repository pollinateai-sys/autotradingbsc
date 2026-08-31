// ============================================================
//  SERVER.JS — persistent hosting entry point
//  (Node.js hosting, VPS, Railway, Render, Docker, Termux, PC)
//
//  Two deliberately separate jobs:
//   1. EXITS: api/lib/livefeed.js subscribes to every new BSC
//      block over WebSocket and immediately checks every open
//      position. A slower HTTP watchdog always runs as backup.
//   2. ENTRIES: a lightweight scheduler only decides when each
//      profile's editable entry scan is due. Entry timing does
//      not affect live SL/TP protection.
//
//  Vercel/serverless cannot hold a WebSocket open; it continues
//  to use /api/cron/scan. Persistent Node.js hosting is required
//  for true live position monitoring.
// ============================================================

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

try {
  require("./api/lib/crypto").getEncryptionKey();
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
}

const app = require("./api/index");
const { checkAllPositions, scanForNewEntries } = require("./api/lib/scanner");
const { startLiveMonitor, stopLiveMonitor, getLiveStatus } = require("./api/lib/livefeed");
const {
  getAllProfileIds, getProfileMeta, getSettings, getStats, updateStats, hasWallet,
} = require("./api/lib/redis");
const telegram = require("./api/lib/telegram");

const PORT = process.env.PORT || 3000;
const ENTRY_LOOP_SECONDS = Math.max(1, parseInt(process.env.ENTRY_LOOP_INTERVAL_SECONDS || "3", 10) || 3);
const WATCHDOG_SECONDS   = Math.max(5, parseInt(process.env.POSITION_WATCHDOG_INTERVAL_SECONDS || "15", 10) || 15);

const BANNER = `
╔══════════════════════════════════════════════════════════╗
║          HALAL BSC TRADING BOT — v2.2 LIVE               ║
║          Multi-profile · Spot Only · BEP20 · Multi-DEX    ║
║          Live exits | No leverage | No interest           ║
╚══════════════════════════════════════════════════════════╝`;

let entryTicking = false;
let watchdogTicking = false;
let entryTimer = null;
let watchdogTimer = null;
let httpServer = null;
let shuttingDown = false;

function printExitResults(profileLabel, results, source) {
  for (const result of results) {
    if (result.action && !["HOLD", "BUSY"].includes(result.action)) {
      console.log(`  ${source === "watchdog" ? "🛟" : "🔎"} [${profileLabel}] ${result.symbol}: ${result.action} (${Number(result.changePct || 0).toFixed(2)}%)`);
    }
  }
}

// ── Entry scheduler only ─────────────────────────────────────
async function entryTick() {
  if (entryTicking || shuttingDown) return;
  entryTicking = true;
  try {
    const profileIds = await getAllProfileIds();
    for (const profileId of profileIds) {
      try {
        const settings = await getSettings(profileId);
        if (!settings.botRunning || !(await hasWallet(profileId))) continue;

        const stats = await getStats(profileId);
        const intervalMs = Math.max(1, settings.scanIntervalSeconds) * 1000;
        const due = !stats.lastScan
          || Date.now() - new Date(stats.lastScan).getTime() >= intervalMs;
        if (!due) continue;

        const meta = await getProfileMeta(profileId);
        const label = meta?.username || profileId;
        console.log(`  🔍 [${label}] Running entry scan...`);
        const results = await scanForNewEntries(profileId);
        console.log(`  ✅ [${label}] Opened: ${results.opened.length} | Skipped: ${results.skipped.length} | Errors: ${results.errors.length}`);
        for (const error of results.errors) console.log(`  ❌ [${label}] ${error.symbol}: ${error.error}`);
        await updateStats(profileId, { lastScan: new Date().toISOString() });
      } catch (e) {
        console.error(`  ❌ Entry scheduler error for ${profileId}:`, e.message);
        await telegram.sendError(`Entry scheduler error (profile ${profileId}): ${e.message}`);
      }
    }
  } finally {
    entryTicking = false;
  }
}

// ── HTTP watchdog — always active, even while WSS is healthy ─
// This is intentionally slower than live blocks. If the socket silently dies,
// stale detection reconnects it; if reconnect is impossible, this still exits.
async function watchdogTick() {
  if (watchdogTicking || shuttingDown) return;
  watchdogTicking = true;
  try {
    const profileIds = await getAllProfileIds();
    for (const profileId of profileIds) {
      try {
        const results = await checkAllPositions(profileId, { source: "watchdog" });
        if (results.length) {
          const meta = await getProfileMeta(profileId);
          printExitResults(meta?.username || profileId, results, "watchdog");
        }
      } catch (e) {
        console.error(`  ❌ Watchdog error for profile ${profileId}:`, e.message);
        await telegram.sendError(`Position watchdog error (profile ${profileId}): ${e.message}`);
      }
    }
  } finally {
    watchdogTicking = false;
  }
}

// ── Startup ──────────────────────────────────────────────────
async function start() {
  console.log(BANNER);
  const profileIds = await getAllProfileIds();
  console.log(`  👥 Profiles registered : ${profileIds.length}`);
  console.log(`  ⚡ Position exits      : every new BSC block (WebSocket)`);
  console.log(`  🛟 HTTP safety watchdog: every ${WATCHDOG_SECONDS}s`);
  console.log(`  🔍 Entry scheduler     : checks due scans every ${ENTRY_LOOP_SECONDS}s`);
  console.log(`  ℹ️  Entry scans keep their per-profile interval; once bought,`);
  console.log(`     the position is protected independently on every block.\n`);

  httpServer = app.listen(PORT, () => {
    console.log(`  ✅ Dashboard running at http://localhost:${PORT}\n`);
  });

  // Do not hold dashboard startup hostage to a slow/dead public WSS endpoint.
  // startLiveMonitor handles its own errors and reconnect loop.
  startLiveMonitor().then(() => {
    const live = getLiveStatus();
    if (live.mode === "fallback") console.log("  🛟 Started in HTTP watchdog fallback mode");
  }).catch(e => console.error("  ⚠️  Live monitor startup error:", e.message));

  await telegram.sendInfo(`🤖 Bot server started — live BSC position monitoring enabled for ${profileIds.length} profile(s)`);

  entryTick();
  watchdogTick();
  entryTimer = setInterval(entryTick, ENTRY_LOOP_SECONDS * 1000);
  watchdogTimer = setInterval(watchdogTick, WATCHDOG_SECONDS * 1000);
}

// ── Graceful shutdown ────────────────────────────────────────
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ⛔ ${signal} received — shutting down gracefully...`);
  if (entryTimer) clearInterval(entryTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  await stopLiveMonitor();
  await telegram.sendInfo(`🛑 Bot server stopped (${signal})`);
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", async (err) => {
  console.error("  ❌ Uncaught exception:", err);
  await telegram.sendError(`Uncaught exception: ${err.message}`);
  // Keep the dashboard + watchdog alive for other profiles.
});
process.on("unhandledRejection", async (err) => {
  console.error("  ❌ Unhandled rejection:", err);
  await telegram.sendError(`Unhandled rejection: ${err?.message || err}`);
});

start().catch((e) => {
  console.error("❌ Fatal startup error:", e.message);
  process.exit(1);
});
