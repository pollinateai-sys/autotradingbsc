// ============================================================
//  MOCK REDIS — in-memory store for testing (same API surface
//  as the real Upstash-backed lib/redis.js)
// ============================================================
const DEFAULT_TOKENS = require("../../api/config/tokens");

const store = {}; // simple in-memory key-value store

function getJson(key, fallback) {
  return store[key] !== undefined ? JSON.parse(JSON.stringify(store[key])) : fallback;
}
function setJson(key, value) {
  store[key] = JSON.parse(JSON.stringify(value));
}

async function getPositions()          { return getJson("bot:positions", {}); }
async function savePositions(positions){ return setJson("bot:positions", positions); }
async function getPosition(symbol)     { const p = await getPositions(); return p[symbol] || null; }
async function setPosition(symbol, data) { const p = await getPositions(); p[symbol] = data; await savePositions(p); }
async function deletePosition(symbol)  { const p = await getPositions(); delete p[symbol]; await savePositions(p); }

async function appendTradeLog(entry) {
  const log = getJson("bot:tradelog", []);
  log.unshift({ ...entry, time: new Date().toISOString() });
  setJson("bot:tradelog", log.slice(0, 300));
}
async function getTradeLog() { return getJson("bot:tradelog", []); }

async function getStats() {
  return getJson("bot:stats", { totalTrades: 0, wins: 0, losses: 0, lastScan: null, lastScanDurationMs: null });
}
async function updateStats(patch) {
  const stats = await getStats();
  const updated = { ...stats, ...patch };
  setJson("bot:stats", updated);
  return updated;
}

const DEFAULT_SETTINGS = {
  activeStrategy: "A", bankrollPercent: 0.5, maxOpenTrades: 3,
  maxSlippagePercent: 1.0, minLiquidityUsd: 10000, autoTrade: true,
  botRunning: false, scanIntervalMinutes: 30, minBnbReserve: 0.01,
};
async function getSettings() { return { ...DEFAULT_SETTINGS, ...getJson("bot:settings", {}) }; }
async function updateSettings(patch) {
  const current = await getSettings();
  const updated = { ...current, ...patch };
  setJson("bot:settings", updated);
  return updated;
}

async function getTokens() {
  const saved = getJson("bot:tokens", null);
  if (saved === null) { setJson("bot:tokens", DEFAULT_TOKENS); return DEFAULT_TOKENS; }
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
  getRedis: () => { throw new Error("getRedis not available in mock"); },
  getPositions, savePositions, getPosition, setPosition, deletePosition,
  appendTradeLog, getTradeLog, getStats, updateStats,
  getSettings, updateSettings, getTokens, saveTokens, addToken, removeToken, toggleToken,
  _debugStore: store, // exposed for test assertions only
};
