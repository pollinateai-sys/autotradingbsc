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
const { evaluateEntryRules } = require("./entryrules");
const { isCooledDown, getCooldownReason, setCooldown } = require("./cooldown");
const telegram = require("./telegram");

// ── Always runs for a profile — protects its existing capital ──
async function checkAllPositions(profileId, options = {}) {
  const results = [];
  // One Redis read each for the full position map + profile settings per
  // block, instead of re-reading both for every symbol.
  const [positions, settings] = await Promise.all([
    getPositions(profileId),
    getSettings(profileId),
  ]);

  for (const symbol of Object.keys(positions)) {
    try {
      const result = await checkAndExecuteExits(profileId, symbol, {
        position: positions[symbol],
        settings,
        provider: options.provider,
        source: options.source,
        blockNumber: options.blockNumber,
      });
      if (result) results.push({
        symbol,
        action: result.action,
        changePct: result.changePct,
        sellPct: result.sellPct,
        tpLevels: result.tpLevels,
      });
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

      // ── ENTRY RULES — the editable buy conditions ─────────
      // The bot no longer buys instantly: a token must satisfy
      // this profile's entry rules (default: "dumped ≥40% in 1h
      // AND still up ≥100% over 24h") before any money moves.
      // Editable per profile from the dashboard; disabled rules
      // restore the old buy-immediately behavior.
      const gate = evaluateEntryRules(settings.entryRules, info);
      if (!gate.pass) {
        results.skipped.push({ symbol: token.symbol, reason: `Waiting for entry setup: ${gate.summary}` });
        continue;
      }

      const position = await openPosition(profileId, token);
      results.opened.push({ symbol: token.symbol, position });

    } catch (e) {
      const msg = `${token.symbol}: ${e.message}`;
      results.errors.push({ symbol: token.symbol, error: e.message });
      console.error(`  ❌ [scanner] ${msg}`);
      await telegram.sendError(`Open position failed: ${msg}`);

      // Only cooldown tokens that are definitively un-tradeable.
      // dex.js already retried all slippage levels internally, so if
      // we get here with a "all slippage levels" message it means the
      // token really is a honeypot — cooldown for 30 min.
      // For other errors (RPC down, low balance, etc.) use 2 min so
      // we retry soon without flooding logs.
      const isHoneypot   = e.message.includes("all slippage levels");
      const isNoLiquidity = e.message.includes("No liquidity found");
      const cooldownMs   = (isHoneypot || isNoLiquidity) ? 30 * 60 * 1000 : 2 * 60 * 1000;
      setCooldown(profileId, token.contract, e.message, cooldownMs);
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
