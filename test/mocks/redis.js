// ============================================================
//  MOCK REDIS — in-memory, profile-scoped (mirrors the real
//  Upstash-backed api/lib/redis.js API surface exactly, including
//  the profile registry and wallet record storage).
// ============================================================
const DEFAULT_TOKENS = require("../../api/config/tokens");
const {
  hashPassword, verifyPassword, hashToken, generateSessionToken, newProfileId,
} = require("../../api/lib/crypto"); // pure functions (bcrypt/sha256), safe to use for real in tests

const store = {}; // simple in-memory key-value store

function getJson(key, fallback) {
  return store[key] !== undefined ? JSON.parse(JSON.stringify(store[key])) : fallback;
}
function setJson(key, value) { store[key] = JSON.parse(JSON.stringify(value)); }
function delKey(key) { delete store[key]; }

// ── Profile registry — username + password, permanent sessions ──
function normalizeUsername(u) { return String(u || "").trim().toLowerCase(); }

async function registerProfile(username, password) {
  const uname = normalizeUsername(username);
  if (uname.length < 3) throw new Error("Username must be at least 3 characters.");
  if (!/^[a-z0-9_.\-]+$/.test(uname)) {
    throw new Error("Username can only contain letters, numbers, dots, dashes and underscores.");
  }
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");

  const existing = getJson(`profiles:byusername:${uname}`, null);
  if (existing) throw new Error("That username is already taken.");

  const id           = newProfileId();
  const passwordHash = await hashPassword(password);
  const meta = { id, username: String(username).trim(), passwordHash, createdAt: new Date().toISOString() };

  setJson(`profiles:byusername:${uname}`, id);
  setJson(`profiles:meta:${id}`, meta);
  const all = getJson("profiles:all", []);
  all.push(id);
  setJson("profiles:all", all);

  const sessionToken = await issueSessionToken(id);
  return { profile: { id, username: meta.username }, sessionToken };
}

async function loginProfile(username, password) {
  const uname     = normalizeUsername(username);
  const profileId = getJson(`profiles:byusername:${uname}`, null);
  if (!profileId) throw new Error("Incorrect username or password.");

  const meta = getJson(`profiles:meta:${profileId}`, null);
  if (!meta) throw new Error("Incorrect username or password.");

  const ok = await verifyPassword(password, meta.passwordHash);
  if (!ok) throw new Error("Incorrect username or password.");

  const sessionToken = await issueSessionToken(profileId);
  return { profile: { id: profileId, username: meta.username }, sessionToken };
}

async function issueSessionToken(profileId) {
  const token = generateSessionToken();
  setJson(`profiles:bytoken:${hashToken(token)}`, profileId);
  return token;
}

async function getProfileIdByToken(token) {
  return getJson(`profiles:bytoken:${hashToken(token)}`, null);
}

async function getProfileMeta(profileId) {
  const meta = getJson(`profiles:meta:${profileId}`, null);
  if (!meta) return null;
  const { passwordHash, ...safe } = meta; // never leak the hash, matching real redis.js
  return safe;
}
async function getAllProfileIds() { return getJson("profiles:all", []); }

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
  botRunning: false, scanIntervalSeconds: 5, minBnbReserve: 0.01,
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
  registerProfile, loginProfile, getProfileIdByToken, getProfileMeta, getAllProfileIds,
  getWalletRecord, setWalletRecord, deleteWalletRecord, hasWallet,
  getPositions, savePositions, getPosition, setPosition, deletePosition,
  appendTradeLog, getTradeLog, getStats, updateStats,
  getSettings, updateSettings, getTokens, saveTokens, addToken, removeToken, toggleToken,
  _debugStore: store, // exposed for test assertions only
};
