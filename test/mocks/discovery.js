// ============================================================
//  MOCK DISCOVERY
//  Keeps ALL the real screening logic (applyFilters, sorting,
//  pagination, validation) but swaps the live DexScreener sweep
//  for a deterministic in-memory pool — so tests exercise the
//  real filter maths with zero network calls.
// ============================================================
const real = require("../../api/lib/discovery");

const DAY = 86400000;

// A spread designed to exercise every filter:
// young/old, thin/deep liquidity, quiet/busy, stable, no-age.
let POOL = [
  mk("AGED",   "Aged Blue Chip",   900,  500000, 300000, 4000, 90000000,  12.5),
  mk("SOLID",  "Solid Mid Cap",    120,  180000, 90000,  1200, 25000000,  -8.0),
  mk("FRESH",  "Fresh Launch",     2,    250000, 400000, 3000, 5000000,   340.0),
  mk("THIN",   "Thin Liquidity",   200,  8000,   60000,  900,  1000000,   4.0),
  mk("QUIET",  "Quiet Old Coin",   400,  120000, 500,    12,   3000000,   0.5),
  mk("USDT",   "Tether USD",       1200, 9000000, 8000000, 90000, 1e11,   0.01),
  mk("MIDAGE", "Mid Age Runner",   45,   300000, 250000, 2500, 40000000,  60.0),
  mk("HUGE",   "Huge Cap",         800,  9000000, 4000000, 20000, 9e11,   1.2),
  mk("NOAGE",  "Unknown Age",      null, 300000, 200000, 1500, 10000000,  5.0),
];

// Deterministic VALID hex address per symbol (real code checksums these,
// so they must be proper 40-char hex — no letters beyond a–f).
function fakeAddress(symbol) {
  let h = 0;
  for (const ch of symbol) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return "0x" + h.toString(16).padStart(8, "0").repeat(5).slice(0, 40);
}

function mk(symbol, name, ageDays, liq, vol, txns, mcap, chg24h) {
  return {
    contract: fakeAddress(symbol),
    symbol, name,
    quoteSymbol: "WBNB",
    pairAddress: "0xpair" + symbol,
    dexId: "pancakeswap",
    priceUsd: 1.23,
    liquidityUsd: liq,
    volume24h: vol,
    txns24h: txns,
    marketCap: mcap,
    change1h: 0.4,
    change24h: chg24h,
    pairCreatedAt: ageDays === null ? null : Date.now() - ageDays * DAY,
    ageDays,
    url: null,
  };
}

async function getCandidatePool() {
  return { data: POOL, expiresAt: Date.now() + 60000, sweptAt: new Date().toISOString() };
}

// Same body as the real discoverCoins, but against the fake pool
async function discoverCoins({ filters, offset = 0, exclude = [] } = {}) {
  const pool = await getCandidatePool();
  const hidden = new Set(exclude.map(a => String(a).toLowerCase()));
  const screened = real.applyFilters(pool.data, filters);
  const visible  = screened.filter(c => !hidden.has(c.contract.toLowerCase()));
  const sorted   = real.sortCandidates(visible, (filters && filters.sortBy) || "liquidity");
  const start = Math.max(0, Math.floor(offset));
  const batch = sorted.slice(start, start + real.BATCH_SIZE);
  return {
    coins: batch, offset: start, nextOffset: start + batch.length,
    batchSize: real.BATCH_SIZE, matched: sorted.length,
    hasMore: start + batch.length < sorted.length,
    scanned: pool.data.length, sweptAt: pool.sweptAt,
  };
}

function _setPool(pool) { POOL = pool; }
function _makeCoin(...args) { return mk(...args); }

module.exports = {
  ...real,          // real constants + pure helpers (validate/applyFilters/sort)
  getCandidatePool, // network-free
  discoverCoins,    // network-free
  _setPool, _makeCoin,
};
