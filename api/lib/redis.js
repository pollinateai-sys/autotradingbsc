// ============================================================
//  UPSTASH REDIS CLIENT
//  Every piece of trading state is scoped per-profile:
//    profile:<id>:settings   profile:<id>:tokens
//    profile:<id>:positions  profile:<id>:tradelog
//    profile:<id>:stats      profile:<id>:wallet (encrypted)
//  Plus a profile registry for username/password login:
//    profiles:byusername:<lowercased username> -> profileId
//    profiles:bytoken:<sha256(sessionToken)>    -> profileId
//      (one entry PER LOGIN — a profile can have several valid
//      tokens at once, one per device, none of them ever expire)
//    profiles:meta:<id> -> { id, username, passwordHash, createdAt }
//    profiles:all       -> [ids...]
// ============================================================

const { Redis } = require("@upstash/redis");
const { hashPassword, verifyPassword, hashToken, generateSessionToken, newProfileId } = require("./crypto");
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
  // @upstash/redis auto-serializes on set() and auto-deserializes on get()
  // (see their docs) — do NOT JSON.stringify/parse ourselves on top of that,
  // it double-encodes and corrupts anything that round-trips through a
  // primitive (booleans/numbers/plain strings), which is where this bug
  // came from originally. Just trust what the SDK gives back.
  return raw;
}
async function setJson(key, value) { await getRedis().set(key, value); }
async function delKey(key)         { await getRedis().del(key); }

// ══════════════════════════════════════════════════════════
//  PROFILE REGISTRY — username + password, permanent sessions
// ══════════════════════════════════════════════════════════

function normalizeUsername(u) { return String(u || "").trim().toLowerCase(); }

/** Create a new profile. Returns { profile, sessionToken } — the token is
 *  shown to the caller exactly once here; only its hash is ever stored. */
async function registerProfile(username, password) {
  const uname = normalizeUsername(username);
  if (uname.length < 3) throw new Error("Username must be at least 3 characters.");
  if (!/^[a-z0-9_.\-]+$/.test(uname)) {
    throw new Error("Username can only contain letters, numbers, dots, dashes and underscores.");
  }
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");

  const existing = await getJson(`profiles:byusername:${uname}`, null);
  if (existing) throw new Error("That username is already taken.");

  const id           = newProfileId();
  const passwordHash = await hashPassword(password);
  const meta = { id, username: String(username).trim(), passwordHash, createdAt: new Date().toISOString() };

  await setJson(`profiles:byusername:${uname}`, id);
  await setJson(`profiles:meta:${id}`, meta);

  const all = await getJson("profiles:all", []);
  all.push(id);
  await setJson("profiles:all", all);

  const sessionToken = await issueSessionToken(id);
  return { profile: { id, username: meta.username }, sessionToken };
}

/** Verify username/password and issue a brand new, permanent session
 *  token for this login (previous tokens on other devices stay valid too). */
async function loginProfile(username, password) {
  const uname     = normalizeUsername(username);
  const profileId = await getJson(`profiles:byusername:${uname}`, null);
  if (!profileId) throw new Error("Incorrect username or password.");

  const meta = await getJson(`profiles:meta:${profileId}`, null);
  if (!meta) throw new Error("Incorrect username or password.");

  const ok = await verifyPassword(password, meta.passwordHash);
  if (!ok) throw new Error("Incorrect username or password.");

  const sessionToken = await issueSessionToken(profileId);
  return { profile: { id: profileId, username: meta.username }, sessionToken };
}

/** Mint a new session token for a profile. Never expires — each one stays
 *  valid until the account itself is gone. */
async function issueSessionToken(profileId) {
  const token = generateSessionToken();
  await setJson(`profiles:bytoken:${hashToken(token)}`, profileId);
  return token;
}

async function getProfileIdByToken(token) {
  return getJson(`profiles:bytoken:${hashToken(token)}`, null);
}
async function getProfileMeta(profileId) {
  const meta = await getJson(`profiles:meta:${profileId}`, null);
  if (!meta) return null;
  const { passwordHash, ...safe } = meta; // never let the hash leave this module
  return safe;
}
async function getAllProfileIds()        { return getJson("profiles:all", []); }

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
  scanIntervalSeconds: 5,     // DexScreener poll cadence for new-entry scanning
  minBnbReserve:       0.002,  // BSC gas per swap is ~0.0003 BNB — 0.002 covers 6+ transactions
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
  // profiles (username/password + permanent session tokens)
  registerProfile, loginProfile, getProfileIdByToken, getProfileMeta, getAllProfileIds,
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

// ══════════════════════════════════════════════════════════
//  PROFILE DELETION
//  Removes a profile and ALL of its data from Redis.
//  Used to clean up ghost profiles (e.g. old auto-generated ones).
// ══════════════════════════════════════════════════════════
async function deleteProfile(profileId) {
  const meta = await getJson(`profiles:meta:${profileId}`, null);
  if (!meta) throw new Error(`Profile ${profileId} not found`);

  const r = getRedis();

  // Remove from the profiles:all list
  const all     = await getJson("profiles:all", []);
  const updated = all.filter(id => id !== profileId);
  await setJson("profiles:all", updated);

  // Remove username → id lookup
  if (meta.username) {
    const uname = String(meta.username).trim().toLowerCase();
    await r.del(`profiles:byusername:${uname}`);
  }

  // Remove all per-profile keys
  const keys = [
    `profiles:meta:${profileId}`,
    `profile:${profileId}:settings`,
    `profile:${profileId}:tokens`,
    `profile:${profileId}:positions`,
    `profile:${profileId}:tradelog`,
    `profile:${profileId}:stats`,
    `profile:${profileId}:wallet`,
  ];
  for (const key of keys) await r.del(key);

  return { deleted: profileId, username: meta.username };
}

module.exports.deleteProfile = deleteProfile;
