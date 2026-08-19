// ============================================================
//  SERVER.JS — Entry point for persistent hosting
//  (VPS, Railway, Render, Docker, Termux, your own PC — anything
//  that can run "node server.js" and keep it alive 24/7)
//
//  Multi-profile: one server, any number of people, each with
//  their own wallet/settings/tokens/positions. A single tick
//  loop walks every profile every POSITION_CHECK_INTERVAL_SECONDS
//  (default 5s, matching DexScreener's ~300 req/min allowance):
//   1. Always checks that profile's open positions for SL/TP —
//      even if their bot is "stopped" (protects existing capital)
//   2. Scans for new entries only if botRunning=true, a wallet is
//      connected, AND that profile's own scanIntervalSeconds has
//      elapsed since its last scan
//
//  NOT needed on Vercel — Vercel uses api/index.js directly plus
//  the /api/cron/scan route (scans all profiles) on a schedule.
// ============================================================

// ── Friendly check: catch the #1 first-run mistake ──────────
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

// ── Friendly check: ENCRYPTION_KEY must be valid before anything
// that could touch a wallet runs, or the first "Connect Wallet"
// click would fail with a confusing error deep in crypto.js.
try {
  require("./api/lib/crypto").getEncryptionKey();
} catch (e) {
  console.error(`\n❌ ${e.message}\n`);
  process.exit(1);
}

const app = require("./api/index");
const { checkAllPositions, scanForNewEntries } = require("./api/lib/scanner");
const {
  getAllProfileIds, getProfileMeta, getSettings, getStats, updateStats, hasWallet,
} = require("./api/lib/redis");
const telegram = require("./api/lib/telegram");

const PORT = process.env.PORT || 3000;
const TICK_SECONDS = parseInt(process.env.POSITION_CHECK_INTERVAL_SECONDS || "5");

const BANNER = `
╔══════════════════════════════════════════════════════════╗
║          HALAL BSC TRADING BOT — v3.0                    ║
║          Multi-profile · Spot Only · BEP20 · PancakeSwap  ║
║          No AI | No Leverage | No Interest                ║
╚══════════════════════════════════════════════════════════╝`;

let ticking = false;

async function tick() {
  if (ticking) return; // don't overlap if a previous tick is still running
  ticking = true;
  try {
    const profileIds = await getAllProfileIds();
    if (profileIds.length === 0) return;

    for (const profileId of profileIds) {
      try {
        // 1. Always protect existing capital, regardless of botRunning
        const exitResults = await checkAllPositions(profileId);
        if (exitResults.length > 0) {
          const meta = await getProfileMeta(profileId);
          exitResults.forEach(r => {
            if (r.action && r.action !== "HOLD") {
              console.log(`  🔎 [${meta?.username || profileId}] ${r.symbol}: ${r.action} (${r.changePct?.toFixed(2)}%)`);
            }
          });
        }

        // 2. New entries only if running, wallet connected, and this
        //    profile's own scan interval has elapsed
        const settings = await getSettings(profileId);
        if (!settings.botRunning) continue;
        if (!(await hasWallet(profileId))) continue;

        const stats = await getStats(profileId);
        const intervalMs = Math.max(1, settings.scanIntervalSeconds) * 1000;
        const dueForScan = !stats.lastScan || (Date.now() - new Date(stats.lastScan).getTime()) >= intervalMs;

        if (dueForScan) {
          const meta = await getProfileMeta(profileId);
          console.log(`  🔍 [${meta?.username || profileId}] Running entry scan...`);
          const results = await scanForNewEntries(profileId);
          const summary = `Opened: ${results.opened.length} | Skipped: ${results.skipped.length} | Errors: ${results.errors.length}`;
          console.log(`  ✅ [${meta?.username || profileId}] ${summary}`);
          if (results.errors.length > 0) {
            results.errors.forEach(e => {
              console.log(`  ❌ [${meta?.username || profileId}] ${e.symbol}: ${e.error}`);
            });
          }
          await updateStats(profileId, { lastScan: new Date().toISOString() });
        }
      } catch (e) {
        console.error(`  ❌ Tick error for profile ${profileId}:`, e.message);
        await telegram.sendError(`Tick error (profile ${profileId}): ${e.message}`);
      }
    }
  } finally {
    ticking = false;
  }
}

// ── Startup ──────────────────────────────────────────────────
async function start() {
  console.log(BANNER);

  const profileIds = await getAllProfileIds();
  console.log(`  👥 Profiles registered: ${profileIds.length}`);
  console.log(`  🔁 Tick interval      : every ${TICK_SECONDS}s (checks all profiles)`);
  console.log(`  ℹ️  Each profile's own "Scan interval" setting controls how often`);
  console.log(`     THAT profile looks for new entries; position monitoring runs`);
  console.log(`     every tick for everyone with open positions, always.\n`);

  app.listen(PORT, () => {
    console.log(`  ✅ Dashboard running at http://localhost:${PORT}\n`);
  });

  await telegram.sendInfo(`🤖 Bot server started — ${profileIds.length} profile(s) registered`);

  tick();
  setInterval(tick, TICK_SECONDS * 1000);
}

// ── Graceful shutdown ────────────────────────────────────────
process.on("SIGINT", async () => {
  console.log("\n\n  ⛔ Shutting down gracefully...");
  await telegram.sendInfo("🛑 Bot server stopped (SIGINT)");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n  ⛔ SIGTERM received — shutting down...");
  await telegram.sendInfo("🛑 Bot server stopped (SIGTERM)");
  process.exit(0);
});

process.on("uncaughtException", async (err) => {
  console.error("  ❌ Uncaught exception:", err);
  await telegram.sendError(`Uncaught exception: ${err.message}`);
  // Don't exit — keep the dashboard alive for other profiles, just log it
});

start().catch((e) => {
  console.error("❌ Fatal startup error:", e.message);
  process.exit(1);
});
