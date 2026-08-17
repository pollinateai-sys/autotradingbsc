// ============================================================
//  UPSTASH REDIS CLIENT
//  Every piece of trading state is scoped per-profile:
//    profile:<id>:settings   profile:<id>:tokens
//    profile:<id>:positions  profile:<id>:tradelog
//    profile:<id>:stats      profile:<id>:wallet (encrypted)
//  Plus a profile registry for API-key login:
//    profiles:byhash:<sha256(apiKey)> -> profileId
//    profiles:meta:<id>               -> { id, name, createdAt }
//    profiles:all                     -> [ids...]
// ============================================================

const { Redis } = require("@upstash/redis");
const { hashApiKey, newProfileId } = require("./crypto");
const DEFAULT_TOKENS = require("../config/tokens");

let redis;

function getRedis() {
  if (!redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN env vars.");
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
async function setJson(key, value) { await getRedis().set(key, JSON.stringify(value)); }
async function delKey(key)         { await getRedis().del(key); }

// ══════════════════════════════════════════════════════════
//  PROFILE REGISTRY
// ══════════════════════════════════════════════════════════

async function createProfile(name, apiKey) {
  const hash     = hashApiKey(apiKey);
  const existing = await getJson(`profiles:byhash:${hash}`, null);
  if (existing) throw new Error("This API key is already registered to a profile.");

  const id = newProfileId();
  const meta = { id, name, createdAt: new Date().toISOString() };
  await setJson(`profiles:byhash:${hash}`, id);
  await setJson(`profiles:meta:${id}`, meta);

  const all = await getJson("profiles:all", []);
  all.push(id);
  await setJson("profiles:all", all);

  return meta;
}

async function getProfileIdByApiKey(apiKey) {
  return getJson(`profiles:byhash:${hashApiKey(apiKey)}`, null);
}
async function getProfileMeta(profileId)  { return getJson(`profiles:meta:${profileId}`, null); }
async function getAllProfileIds()         { return getJson("profiles:all", []); }

// ══════════════════════════════════════════════════════════
//  WALLET (encrypted private key storage)
// ══════════════════════════════════════════════════════════

async function getWalletRecord(profileId)      { return getJson(`profile:${profileId}:wallet`, null); }
async function setWalletRecord(profileId, rec)  { return setJson(`profile:${profileId}:wallet`, rec); }
async function deleteWalletRecord(profileId)    { return delKey(`profile:${profileId}:wallet`); }
async function hasWallet(profileId)             { return (await getWalletRecord(profileId)) !== null; }

// ══════════════════════════════════════════════════════════
//  POSITIONS (per profile)
// ══════════════════════════════════════════════════════════

async function getPositions(profileId)           { return getJson(`profile:${profileId}:positions`, {}); }
async function savePositions(profileId, p)        { return setJson(`profile:${profileId}:positions`, p); }
async function getPosition(profileId, symbol) {
  const p = await getPositions(profileId); return p[symbol] || null;
}
async function setPosition(profileId, symbol, data) {
  const p = await getPositions(profileId); p[symbol] = data; await savePositions(profileId, p);
}
async function deletePosition(profileId, symbol) {
  const p = await getPositions(profileId); delete p[symbol]; await savePositions(profileId, p);
}

// ══════════════════════════════════════════════════════════
//  TRADE LOG (per profile)
// ══════════════════════════════════════════════════════════

async function appendTradeLog(profileId, entry) {
  const log = await getJson(`profile:${profileId}:tradelog`, []);
  log.unshift({ ...entry, time: new Date().toISOString() });
  await setJson(`profile:${profileId}:tradelog`, log.slice(0, 300));
}
async function getTradeLog(profileId) { return getJson(`profile:${profileId}:tradelog`, []); }

// ══════════════════════════════════════════════════════════
//  STATS (per profile)
// ══════════════════════════════════════════════════════════

async function getStats(profileId) {
  return getJson(`profile:${profileId}:stats`, {
    totalTrades: 0, wins: 0, losses: 0, lastScan: null, lastScanDurationMs: null,
  });
}
async function updateStats(profileId, patch) {
  const stats   = await getStats(profileId);
  const updated = { ...stats, ...patch };
  await setJson(`profile:${profileId}:stats`, updated);
  return updated;
}

// ══════════════════════════════════════════════════════════
//  SETTINGS (per profile)
// ══════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  activeStrategy:      "A",
  bankrollPercent:     0.5,
  maxOpenTrades:       3,
  maxSlippagePercent:  1.0,
  minLiquidityUsd:     10000,
  autoTrade:           true,
  botRunning:          false,
  scanIntervalMinutes: 30,
  minBnbReserve:       0.01,
};

async function getSettings(profileId) {
  const saved = await getJson(`profile:${profileId}:settings`, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}
async function updateSettings(profileId, patch) {
  const current = await getSettings(profileId);
  const updated = { ...current, ...patch };
  await setJson(`profile:${profileId}:settings`, updated);
  return updated;
}

// ══════════════════════════════════════════════════════════
//  TOKENS (per profile — seeded with defaults on first read)
// ══════════════════════════════════════════════════════════

async function getTokens(profileId) {
  const saved = await getJson(`profile:${profileId}:tokens`, null);
  if (saved === null) {
    await setJson(`profile:${profileId}:tokens`, DEFAULT_TOKENS);
    return DEFAULT_TOKENS;
  }
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
  const tokens   = await getTokens(profileId);
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
  getRedis,
  // profiles
  createProfile, getProfileIdByApiKey, getProfileMeta, getAllProfileIds,
  // wallet
  getWalletRecord, setWalletRecord, deleteWalletRecord, hasWallet,
  // positions
  getPositions, savePositions, getPosition, setPosition, deletePosition,
  // trade log
  appendTradeLog, getTradeLog,
  // stats
  getStats, updateStats,
  // settings
  getSettings, updateSettings,
  // tokens
  getTokens, saveTokens, addToken, removeToken, toggleToken,
};
