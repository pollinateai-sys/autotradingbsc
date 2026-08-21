// ============================================================
//  SCANNER — per profile, plus a multi-profile runner
//
//  SAFETY DESIGN (unchanged from single-user version):
//  Position exit monitoring (SL/TP) ALWAYS runs for a profile
//  that has open positions, even when that profile's bot is
//  "stopped" — stopping means "don't open new trades," not
//  "abandon my open positions." Only new entries are gated by
//  that profile's own botRunning flag.
// ============================================================

const {
  getTokens, getPositions, getSettings, updateStats, getAllProfileIds, hasWallet,
} = require("./redis");
const { checkAndExecuteExits, openPosition } = require("./strategy");
const { getTokenInfo } = require("./market");
const { isCooledDown, getCooldownReason, setCooldown } = require("./cooldown");
const telegram = require("./telegram");

// ── Always runs for a profile — protects its existing capital ──
async function checkAllPositions(profileId) {
  const results   = [];
  const positions = await getPositions(profileId);

  for (const symbol of Object.keys(positions)) {
    try {
      const result = await checkAndExecuteExits(profileId, symbol);
      if (result) results.push({ symbol, action: result.action, changePct: result.changePct });
    } catch (e) {
      results.push({ symbol, action: "ERROR", error: e.message });
      await telegram.sendError(`SL/TP check failed: ${symbol} — ${e.message}`);
    }
  }
  return results;
}

// ── Only runs when that profile's botRunning=true (or forced) ──
async function scanForNewEntries(profileId) {
  const results  = { opened: [], skipped: [], errors: [] };
  const settings = await getSettings(profileId);
  const tokens   = await getTokens(profileId);
  const enabled  = tokens.filter(t => t.enabled);

  for (const token of enabled) {
    try {
      const positions = await getPositions(profileId);
      const count      = Object.keys(positions).length;

      if (count >= settings.maxOpenTrades) {
        results.skipped.push({ symbol: token.symbol, reason: "Max open trades reached" });
        continue;
      }
      if (positions[token.symbol]) {
        results.skipped.push({ symbol: token.symbol, reason: "Position already open" });
        continue;
      }

      // Skip tokens that failed recently — don't waste gas retrying
      if (isCooledDown(profileId, token.contract)) {
        const reason = getCooldownReason(profileId, token.contract);
        results.skipped.push({ symbol: token.symbol, reason: `Cooldown: ${reason}` });
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

      const position = await openPosition(profileId, token);
      results.opened.push({ symbol: token.symbol, position });

    } catch (e) {
      const msg = `${token.symbol}: ${e.message}`;
      results.errors.push({ symbol: token.symbol, error: e.message });
      console.error(`  ❌ [scanner] ${msg}`);
      await telegram.sendError(`Open position failed: ${msg}`);

      // Put on cooldown so we don't retry endlessly and burn gas
      // on tokens that clearly can't be swapped right now
      setCooldown(profileId, token.contract, e.message, 10 * 60 * 1000); // 10 min
    }
  }
  return results;
}

// ── Combined cycle for ONE profile (used by manual "Scan Now") ──
async function runProfileCycle(profileId, { force = false } = {}) {
  const started  = Date.now();
  const settings = await getSettings(profileId);
  const walletConnected = await hasWallet(profileId);

  const checked = await checkAllPositions(profileId);

  let entryResults = { opened: [], skipped: [], errors: [] };
  let entriesSkippedReason = null;

  if (!walletConnected) {
    entriesSkippedReason = "No wallet connected for this profile";
  } else if (settings.botRunning || force) {
    entryResults = await scanForNewEntries(profileId);
  } else {
    entriesSkippedReason = "Bot is stopped — new entries disabled (existing positions still monitored)";
  }

  const durationMs = Date.now() - started;
  await updateStats(profileId, { lastScan: new Date().toISOString(), lastScanDurationMs: durationMs });

  return {
    ok: true,
    durationMs,
    botRunning: settings.botRunning,
    walletConnected,
    entriesSkippedReason,
    results: { checked, ...entryResults },
  };
}

// ── Runs every profile once — used by external cron (Vercel/cron-job.org) ──
async function runAllProfiles({ force = false } = {}) {
  const ids     = await getAllProfileIds();
  const results = {};
  for (const id of ids) {
    try { results[id] = await runProfileCycle(id, { force }); }
    catch (e) { results[id] = { ok: false, error: e.message }; }
  }
  return { ok: true, profileCount: ids.length, results };
}

module.exports = { checkAllPositions, scanForNewEntries, runProfileCycle, runAllProfiles };
