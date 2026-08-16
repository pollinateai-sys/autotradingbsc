// ============================================================
//  UPSTASH REDIS CLIENT
//  Stores ALL bot state: positions, trade log, settings, tokens.
//  This is what makes the bot editable live from the dashboard.
// ============================================================

const { Redis } = require("@upstash/redis");
const DEFAULT_TOKENS = require("../config/tokens");

let redis;

function getRedis() {
  if (!redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars."
      );
    }
    redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

async function getJson(key, fallback) {
  const r   = getRedis();
  const raw = await r.get(key);
  if (raw === null || raw === undefined) return fallback;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function setJson(key, value) {
  const r = getRedis();
  await r.set(key, JSON.stringify(value));
}

// ── POSITIONS ──────────────────────────────────────────────
async function getPositions()          { return getJson("bot:positions", {}); }
async function savePositions(positions){ return setJson("bot:positions", positions); }
async function getPosition(symbol)     { const p = await getPositions(); return p[symbol] || null; }
async function setPosition(symbol, data) {
  const p = await getPositions(); p[symbol] = data; await savePositions(p);
}
async function deletePosition(symbol) {
  const p = await getPositions(); delete p[symbol]; await savePositions(p);
}

// ── TRADE LOG ──────────────────────────────────────────────
async function appendTradeLog(entry) {
  const log = await getJson("bot:tradelog", []);
  log.unshift({ ...entry, time: new Date().toISOString() });
  await setJson("bot:tradelog", log.slice(0, 300));
}
async function getTradeLog() { return getJson("bot:tradelog", []); }

// ── STATS ──────────────────────────────────────────────────
async function getStats() {
  return getJson("bot:stats", {
    totalTrades: 0, wins: 0, losses: 0, lastScan: null, lastScanDurationMs: null,
  });
}
async function updateStats(patch) {
  const stats = await getStats();
  const updated = { ...stats, ...patch };
  await setJson("bot:stats", updated);
  return updated;
}

// ── SETTINGS (editable live from dashboard) ─────────────────
const DEFAULT_SETTINGS = {
  activeStrategy:      "A",
  bankrollPercent:     0.5,
  maxOpenTrades:       3,
  maxSlippagePercent:  1.0,
  minLiquidityUsd:     10000,
  autoTrade:           true,   // false = signal-only, no real trades
  botRunning:          false,  // master on/off switch
  scanIntervalMinutes: 30,
  minBnbReserve:       0.01,
};

async function getSettings() {
  const saved = await getJson("bot:settings", {});
  return { ...DEFAULT_SETTINGS, ...saved };
}
async function updateSettings(patch) {
  const current = await getSettings();
  const updated = { ...current, ...patch };
  await setJson("bot:settings", updated);
  return updated;
}

// ── TOKENS (editable live — add by contract address) ────────
async function getTokens() {
  const saved = await getJson("bot:tokens", null);
  if (saved === null) {
    // First run — seed with defaults from config/tokens.js
    await setJson("bot:tokens", DEFAULT_TOKENS);
    return DEFAULT_TOKENS;
  }
  return saved;
}
async function saveTokens(tokens) { return setJson("bot:tokens", tokens); }

async function addToken(token) {
  const tokens = await getTokens();
  const exists = tokens.find(t => t.contract.toLowerCase() === token.contract.toLowerCase());
  if (exists) throw new Error(`Token ${token.contract} already in list as ${exists.symbol}`);
  tokens.push(token);
  await saveTokens(tokens);
  return tokens;
}

async function removeToken(symbol) {
  const tokens = await getTokens();
  const filtered = tokens.filter(t => t.symbol !== symbol);
  await saveTokens(filtered);
  return filtered;
}

async function toggleToken(symbol, enabled) {
  const tokens = await getTokens();
  const t = tokens.find(t => t.symbol === symbol);
  if (!t) throw new Error(`Token ${symbol} not found`);
  t.enabled = enabled;
  await saveTokens(tokens);
  return t;
}

module.exports = {
  getRedis,
  getPositions, savePositions, getPosition, setPosition, deletePosition,
  appendTradeLog, getTradeLog,
  getStats, updateStats,
  getSettings, updateSettings,
  getTokens, saveTokens, addToken, removeToken, toggleToken,
};
