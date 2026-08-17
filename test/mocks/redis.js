// ============================================================
//  MOCK REDIS — in-memory, profile-scoped (mirrors the real
//  Upstash-backed api/lib/redis.js API surface exactly, including
//  the profile registry and wallet record storage).
// ============================================================
const DEFAULT_TOKENS = require("../../api/config/tokens");
const { hashApiKey, newProfileId } = require("../../api/lib/crypto"); // pure, no env needed

const store = {}; // simple in-memory key-value store

function getJson(key, fallback) {
  return store[key] !== undefined ? JSON.parse(JSON.stringify(store[key])) : fallback;
}
function setJson(key, value) { store[key] = JSON.parse(JSON.stringify(value)); }
function delKey(key) { delete store[key]; }

// ── Profile registry ─────────────────────────────────────────
async function createProfile(name, apiKey) {
  const hash = hashApiKey(apiKey);
  const existing = getJson(`profiles:byhash:${hash}`, null);
  if (existing) throw new Error("This API key is already registered to a profile.");
  const id = newProfileId();
  const meta = { id, name, createdAt: new Date().toISOString() };
  setJson(`profiles:byhash:${hash}`, id);
  setJson(`profiles:meta:${id}`, meta);
  const all = getJson("profiles:all", []);
  all.push(id);
  setJson("profiles:all", all);
  return meta;
}
async function getProfileIdByApiKey(apiKey) { return getJson(`profiles:byhash:${hashApiKey(apiKey)}`, null); }
async function getProfileMeta(profileId)    { return getJson(`profiles:meta:${profileId}`, null); }
async function getAllProfileIds()           { return getJson("profiles:all", []); }

// ── Wallet record storage (shared source of truth for mock wallet.js) ──
async function getWalletRecord(profileId)     { return getJson(`profile:${profileId}:wallet`, null); }
async function setWalletRecord(profileId, r)   { return setJson(`profile:${profileId}:wallet`, r); }
async function deleteWalletRecord(profileId)   { return delKey(`profile:${profileId}:wallet`); }
async function hasWallet(profileId)            { return (await getWalletRecord(profileId)) !== null; }

// ── Positions ─────────────────────────────────────────────────
async function getPositions(profileId)            { return getJson(`profile:${profileId}:positions`, {}); }
async function savePositions(profileId, p)         { return setJson(`profile:${profileId}:positions`, p); }
async function getPosition(profileId, symbol) {
  const p = await getPositions(profileId); return p[symbol] || null;
}
async function setPosition(profileId, symbol, data) {
  const p = await getPositions(profileId); p[symbol] = data; await savePositions(profileId, p);
}
async function deletePosition(profileId, symbol) {
  const p = await getPositions(profileId); delete p[symbol]; await savePositions(profileId, p);
}

// ── Trade log ─────────────────────────────────────────────────
async function appendTradeLog(profileId, entry) {
  const log = getJson(`profile:${profileId}:tradelog`, []);
  log.unshift({ ...entry, time: new Date().toISOString() });
  setJson(`profile:${profileId}:tradelog`, log.slice(0, 300));
}
async function getTradeLog(profileId) { return getJson(`profile:${profileId}:tradelog`, []); }

// ── Stats ─────────────────────────────────────────────────────
async function getStats(profileId) {
  return getJson(`profile:${profileId}:stats`, { totalTrades: 0, wins: 0, losses: 0, lastScan: null, lastScanDurationMs: null });
}
async function updateStats(profileId, patch) {
  const stats = await getStats(profileId);
  const updated = { ...stats, ...patch };
  setJson(`profile:${profileId}:stats`, updated);
  return updated;
}

// ── Settings ──────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  activeStrategy: "A", bankrollPercent: 0.5, maxOpenTrades: 3,
  maxSlippagePercent: 1.0, minLiquidityUsd: 10000, autoTrade: true,
  botRunning: false, scanIntervalMinutes: 30, minBnbReserve: 0.01,
};
async function getSettings(profileId) { return { ...DEFAULT_SETTINGS, ...getJson(`profile:${profileId}:settings`, {}) }; }
async function updateSettings(profileId, patch) {
  const current = await getSettings(profileId);
  const updated = { ...current, ...patch };
  setJson(`profile:${profileId}:settings`, updated);
  return updated;
}

// ── Tokens ────────────────────────────────────────────────────
async function getTokens(profileId) {
  const saved = getJson(`profile:${profileId}:tokens`, null);
  if (saved === null) { setJson(`profile:${profileId}:tokens`, DEFAULT_TOKENS); return DEFAULT_TOKENS; }
  return saved;
}
async function saveTokens(profileId, tokens) { return setJson(`profile:${profileId}:tokens`, tokens); }
async function addToken(profileId, token) {
  const tokens = await getTokens(profileId);
  const exists = tokens.find(t => t.contract.toLowerCase() === token.contract.toLowerCase());
  if (exists) throw new Error(`Token ${token.contract} already in list as ${exists.symbol}`);
  tokens.push(token);
  await saveTokens(profileId, tokens);
  return tokens;
}
async function removeToken(profileId, symbol) {
  const tokens = await getTokens(profileId);
  const filtered = tokens.filter(t => t.symbol !== symbol);
  await saveTokens(profileId, filtered);
  return filtered;
}
async function toggleToken(profileId, symbol, enabled) {
  const tokens = await getTokens(profileId);
  const t = tokens.find(t => t.symbol === symbol);
  if (!t) throw new Error(`Token ${symbol} not found`);
  t.enabled = enabled;
  await saveTokens(profileId, tokens);
  return t;
}

module.exports = {
  getRedis: () => { throw new Error("getRedis not available in mock"); },
  createProfile, getProfileIdByApiKey, getProfileMeta, getAllProfileIds,
  getWalletRecord, setWalletRecord, deleteWalletRecord, hasWallet,
  getPositions, savePositions, getPosition, setPosition, deletePosition,
  appendTradeLog, getTradeLog, getStats, updateStats,
  getSettings, updateSettings, getTokens, saveTokens, addToken, removeToken, toggleToken,
  _debugStore: store, // exposed for test assertions only
};
