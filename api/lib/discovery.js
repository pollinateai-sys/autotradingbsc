// ============================================================
//  COIN DISCOVERY — "Coins Found"
//
//  Instead of hunting for contract addresses by hand, the bot
//  sweeps DexScreener for live BSC pairs, applies YOUR editable
//  screening filters (min liquidity, min 24h volume, minimum
//  coin AGE, market cap, transaction count…) and shows only the
//  coins that pass. You enable the ones you like; the rest can
//  be dismissed so the next batch of 20 is all fresh.
//
//  Every threshold here is editable per profile from the
//  dashboard — nothing is hardcoded policy.
//
//  Rate-limit friendly: the candidate pool is fetched once and
//  cached process-wide for POOL_TTL_MS, so paging through
//  batches (or several profiles screening at once) costs no
//  extra API calls.
// ============================================================

const https = require("https");

const POOL_TTL_MS = 90 * 1000;   // re-sweep at most every 90s
const BATCH_SIZE  = 20;          // "show me another 20"

// Broad sweep terms — quote assets, majors, and common BSC
// pair names. Each returns up to 30 pairs; deduped by base
// token this yields a few hundred distinct BSC coins.
const SWEEP_QUERIES = [
  "WBNB", "USDT", "BUSD", "USDC", "CAKE", "BNB",
  "ETH", "BTCB", "DOGE", "SHIB", "PEPE", "FLOKI",
  "bsc", "pancakeswap", "binance", "meme",
  "AI", "GAME", "DAO", "SAFE", "MOON", "BABY",
  "INU", "TOKEN",
];

// Stablecoins / wrapped majors — pointless to "discover" as trades
const STABLE_SYMBOLS = new Set([
  "USDT", "BUSD", "USDC", "DAI", "TUSD", "FDUSD", "USDD", "USD1",
  "FRAX", "USDP", "LUSD", "PYUSD", "EURS", "WBNB",
]);

// ── Editable screening filters ───────────────────────────────
const DEFAULT_DISCOVERY_FILTERS = {
  minLiquidityUsd:  50000,   // pool depth floor
  minVolume24hUsd:  25000,   // real trading activity
  minAgeDays:       30,      // coin must be at least this old
  maxAgeDays:       0,       // 0 = no upper limit
  minTxns24h:       100,     // number of trades in 24h
  minMarketCapUsd:  0,       // 0 = no floor
  maxMarketCapUsd:  0,       // 0 = no cap
  excludeStables:   true,    // hide stablecoins / WBNB
  sortBy:           "liquidity", // liquidity | volume | age | change24h | marketCap
};

const SORT_KEYS = ["liquidity", "volume", "age", "change24h", "marketCap"];

function validateDiscoveryFilters(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("discoveryFilters must be an object");
  }
  const num = (v, name, min, max) => {
    const n = Number(v);
    if (!isFinite(n) || n < min || n > max) {
      throw new Error(`${name} must be a number between ${min} and ${max}`);
    }
    return n;
  };
  const out = {
    minLiquidityUsd: num(input.minLiquidityUsd ?? DEFAULT_DISCOVERY_FILTERS.minLiquidityUsd, "Min liquidity", 0, 1e12),
    minVolume24hUsd: num(input.minVolume24hUsd ?? DEFAULT_DISCOVERY_FILTERS.minVolume24hUsd, "Min 24h volume", 0, 1e12),
    minAgeDays:      num(input.minAgeDays      ?? DEFAULT_DISCOVERY_FILTERS.minAgeDays,      "Min age (days)", 0, 5000),
    maxAgeDays:      num(input.maxAgeDays      ?? DEFAULT_DISCOVERY_FILTERS.maxAgeDays,      "Max age (days)", 0, 5000),
    minTxns24h:      num(input.minTxns24h      ?? DEFAULT_DISCOVERY_FILTERS.minTxns24h,      "Min 24h transactions", 0, 1e7),
    minMarketCapUsd: num(input.minMarketCapUsd ?? DEFAULT_DISCOVERY_FILTERS.minMarketCapUsd, "Min market cap", 0, 1e13),
    maxMarketCapUsd: num(input.maxMarketCapUsd ?? DEFAULT_DISCOVERY_FILTERS.maxMarketCapUsd, "Max market cap", 0, 1e13),
    excludeStables:  input.excludeStables !== undefined ? !!input.excludeStables : true,
    sortBy:          String(input.sortBy || DEFAULT_DISCOVERY_FILTERS.sortBy),
  };
  if (!SORT_KEYS.includes(out.sortBy)) {
    throw new Error(`Sort must be one of: ${SORT_KEYS.join(", ")}`);
  }
  if (out.maxAgeDays > 0 && out.maxAgeDays < out.minAgeDays) {
    throw new Error("Max age must be greater than min age (or 0 for no limit)");
  }
  if (out.maxMarketCapUsd > 0 && out.maxMarketCapUsd < out.minMarketCapUsd) {
    throw new Error("Max market cap must be greater than min market cap (or 0 for no limit)");
  }
  return out;
}

// ── HTTP helper (never throws — a dead query just contributes nothing) ──
function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 9000 }, (res) => {
      if (res.statusCode && res.statusCode >= 400) { res.resume(); return resolve(null); }
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

// ── Candidate pool (cached process-wide) ─────────────────────
let poolCache = { data: [], expiresAt: 0, sweptAt: null };

function normalizePair(p) {
  const base = p.baseToken || {};
  if (!base.address) return null;
  const createdAt = p.pairCreatedAt || null;
  return {
    contract:     base.address,
    symbol:       base.symbol || "?",
    name:         base.name || base.symbol || "Unknown",
    quoteSymbol:  p.quoteToken?.symbol || "",
    pairAddress:  p.pairAddress,
    dexId:        p.dexId,
    priceUsd:     parseFloat(p.priceUsd || 0),
    liquidityUsd: parseFloat(p.liquidity?.usd || 0),
    volume24h:    parseFloat(p.volume?.h24 || 0),
    txns24h:      (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
    marketCap:    parseFloat(p.marketCap || p.fdv || 0),
    change1h:     parseFloat(p.priceChange?.h1 || 0),
    change24h:    parseFloat(p.priceChange?.h24 || 0),
    pairCreatedAt: createdAt,
    ageDays:      createdAt ? (Date.now() - createdAt) / 86400000 : null,
    url:          p.url || null,
  };
}

/** Sweep DexScreener for BSC pairs, dedupe by base token (deepest pool wins). */
async function getCandidatePool({ force = false } = {}) {
  if (!force && poolCache.expiresAt > Date.now() && poolCache.data.length) {
    return poolCache;
  }
  const results = await Promise.all(
    SWEEP_QUERIES.map(q => fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`))
  );

  const byToken = new Map();
  for (const res of results) {
    for (const p of (res?.pairs || [])) {
      if (p.chainId !== "bsc") continue;
      const norm = normalizePair(p);
      if (!norm) continue;
      const key  = norm.contract.toLowerCase();
      const prev = byToken.get(key);
      // Keep the deepest pool for a given token
      if (!prev || norm.liquidityUsd > prev.liquidityUsd) byToken.set(key, norm);
    }
  }

  const data = [...byToken.values()];
  // Keep the previous pool if a sweep totally failed (network blip)
  if (!data.length && poolCache.data.length) return poolCache;

  poolCache = { data, expiresAt: Date.now() + POOL_TTL_MS, sweptAt: new Date().toISOString() };
  return poolCache;
}

// ── Filtering (pure — unit testable) ─────────────────────────
function applyFilters(pool, filters) {
  const f = { ...DEFAULT_DISCOVERY_FILTERS, ...(filters || {}) };
  return pool.filter(c => {
    if (f.excludeStables && STABLE_SYMBOLS.has(String(c.symbol).toUpperCase())) return false;
    if (c.liquidityUsd < f.minLiquidityUsd) return false;
    if (c.volume24h    < f.minVolume24hUsd) return false;
    if (c.txns24h      < f.minTxns24h) return false;
    // Age: unknown creation date fails any minimum age requirement,
    // because "at least N days old" can't be proven for it.
    if (f.minAgeDays > 0) {
      if (c.ageDays === null || c.ageDays < f.minAgeDays) return false;
    }
    if (f.maxAgeDays > 0 && c.ageDays !== null && c.ageDays > f.maxAgeDays) return false;
    if (f.minMarketCapUsd > 0 && c.marketCap < f.minMarketCapUsd) return false;
    if (f.maxMarketCapUsd > 0 && c.marketCap > f.maxMarketCapUsd) return false;
    return true;
  });
}

function sortCandidates(list, sortBy) {
  const arr = [...list];
  switch (sortBy) {
    case "volume":    arr.sort((a, b) => b.volume24h - a.volume24h); break;
    case "age":       arr.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)); break;
    case "change24h": arr.sort((a, b) => b.change24h - a.change24h); break;
    case "marketCap": arr.sort((a, b) => b.marketCap - a.marketCap); break;
    case "liquidity":
    default:          arr.sort((a, b) => b.liquidityUsd - a.liquidityUsd); break;
  }
  return arr;
}

/**
 * One page of discovered coins.
 * @param {object} opts.filters   editable screening thresholds
 * @param {number} opts.offset    how many already shown ("another 20")
 * @param {string[]} opts.exclude contracts to hide (already added + dismissed)
 */
async function discoverCoins({ filters, offset = 0, exclude = [], force = false } = {}) {
  const pool = await getCandidatePool({ force });
  const hidden = new Set(exclude.map(a => String(a).toLowerCase()));

  const screened = applyFilters(pool.data, filters);
  const visible  = screened.filter(c => !hidden.has(c.contract.toLowerCase()));
  const sorted   = sortCandidates(visible, (filters && filters.sortBy) || DEFAULT_DISCOVERY_FILTERS.sortBy);

  const start = Math.max(0, Math.floor(offset));
  const batch = sorted.slice(start, start + BATCH_SIZE);

  return {
    coins: batch,
    offset: start,
    nextOffset: start + batch.length,
    batchSize: BATCH_SIZE,
    matched: sorted.length,               // total passing your filters right now
    hasMore: start + batch.length < sorted.length,
    scanned: pool.data.length,            // size of the raw sweep
    sweptAt: pool.sweptAt,
  };
}

module.exports = {
  BATCH_SIZE, DEFAULT_DISCOVERY_FILTERS, SORT_KEYS, STABLE_SYMBOLS,
  validateDiscoveryFilters, discoverCoins, getCandidatePool,
  applyFilters, sortCandidates, normalizePair,
};
