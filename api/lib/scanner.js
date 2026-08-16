// ============================================================
//  SCANNER — core scan cycle logic
//  Shared by: manual "Scan Now" button, /api/cron/scan route,
//  and the continuous background loop in server.js.
//
//  IMPORTANT SAFETY DESIGN:
//  Position exit monitoring (Stop Loss / Take Profit) ALWAYS
//  runs, even when the bot is "stopped" — because stopping the
//  bot should mean "don't open new trades", not "abandon my
//  open positions without protection".
//  Only NEW entries are gated by botRunning.
// ============================================================

const { getTokens, getPositions, getSettings, updateStats } = require("./redis");
const { checkAndExecuteExits, openPosition } = require("./strategy");
const { getTokenInfo } = require("./market");
const telegram = require("./telegram");

// ── Always runs — protects existing capital ─────────────────
async function checkAllPositions() {
  const results    = [];
  const positions  = await getPositions();

  for (const symbol of Object.keys(positions)) {
    try {
      const result = await checkAndExecuteExits(symbol);
      if (result) results.push({ symbol, action: result.action, changePct: result.changePct });
    } catch (e) {
      results.push({ symbol, action: "ERROR", error: e.message });
      await telegram.sendError(`SL/TP check failed: ${symbol} — ${e.message}`);
    }
  }
  return results;
}

// ── Only runs when botRunning=true (or forced manually) ─────
async function scanForNewEntries() {
  const results  = { opened: [], skipped: [], errors: [] };
  const settings = await getSettings();
  const tokens   = await getTokens();
  const enabled  = tokens.filter(t => t.enabled);

  for (const token of enabled) {
    try {
      const positions = await getPositions();
      const count      = Object.keys(positions).length;

      if (count >= settings.maxOpenTrades) {
        results.skipped.push({ symbol: token.symbol, reason: "Max open trades reached" });
        continue;
      }
      if (positions[token.symbol]) {
        results.skipped.push({ symbol: token.symbol, reason: "Position already open" });
        continue;
      }

      const info = await getTokenInfo(token.contract);
      if (!info) {
        results.skipped.push({ symbol: token.symbol, reason: "No market data / no liquidity pool" });
        continue;
      }
      if (info.liquidityUsd < settings.minLiquidityUsd) {
        results.skipped.push({
          symbol: token.symbol,
          reason: `Low liquidity ($${info.liquidityUsd.toFixed(0)} < $${settings.minLiquidityUsd})`,
        });
        continue;
      }

      const position = await openPosition(token);
      results.opened.push({ symbol: token.symbol, position });

    } catch (e) {
      results.errors.push({ symbol: token.symbol, error: e.message });
      await telegram.sendError(`Open position failed: ${token.symbol} — ${e.message}`);
    }
  }
  return results;
}

// ── Combined cycle used by routes + background loop ─────────
async function runScanCycle({ force = false } = {}) {
  const started  = Date.now();
  const settings = await getSettings();

  // Exits ALWAYS run, regardless of botRunning
  const checked = await checkAllPositions();

  let entryResults = { opened: [], skipped: [], errors: [] };
  let entriesSkippedReason = null;

  if (settings.botRunning || force) {
    entryResults = await scanForNewEntries();
  } else {
    entriesSkippedReason = "Bot is stopped — new entries disabled (existing positions still monitored)";
  }

  const durationMs = Date.now() - started;
  await updateStats({ lastScan: new Date().toISOString(), lastScanDurationMs: durationMs });

  return {
    ok: true,
    durationMs,
    botRunning: settings.botRunning,
    entriesSkippedReason,
    results: { checked, ...entryResults },
  };
}

module.exports = { runScanCycle, checkAllPositions, scanForNewEntries };
