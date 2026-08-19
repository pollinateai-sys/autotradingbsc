// ============================================================
//  MARKET DATA
//  - DexScreener for price/liquidity/volume (free, no key)
//  - On-chain ERC20 calls for token metadata (symbol/name/decimals)
//    used when a user adds a new token by contract address only.
//
//  DexScreener's token-pair endpoint (the one we call) is rate
//  limited around 300 requests/minute — generous, but with the
//  bot now polling every few seconds per profile, a short cache
//  means two profiles watching the same token (or the same
//  profile re-checking mid-cycle) share one fetch instead of
//  doubling up, and a failed/429 response degrades gracefully
//  instead of throwing mid-scan.
// ============================================================

const https = require("https");
const { ethers } = require("ethers");
const { getProvider } = require("./wallet");

const CACHE_TTL_MS = 4000; // just under the 5s default poll interval
const cache = new Map(); // contractAddress -> { data, expiresAt }

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 8000 }, (res) => {
      if (res.statusCode === 429) {
        console.warn(`  ⚠️  DexScreener rate limit hit (429) — will retry next cycle`);
        res.resume();
        return resolve(null);
      }
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        return resolve(null);
      }
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

async function getTokenInfo(contractAddress) {
  const key    = contractAddress.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
  if (!json) return cached ? cached.data : null; // serve stale-but-recent data over a hard failure if we have it

  const pairs = (json.pairs || []).filter(p => p.chainId === "bsc");
  if (!pairs.length) { cache.set(key, { data: null, expiresAt: Date.now() + CACHE_TTL_MS }); return null; }

  pairs.sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));
  const best = pairs[0];
  const result = {
    pairAddress:  best.pairAddress,
    priceUsd:     parseFloat(best.priceUsd    || 0),
    priceNative:  parseFloat(best.priceNative || 0),
    volume24h:    parseFloat(best.volume?.h24  || 0),
    liquidityUsd: parseFloat(best.liquidity?.usd || 0),
    change1h:     parseFloat(best.priceChange?.h1  || 0),
    change24h:    parseFloat(best.priceChange?.h24 || 0),
    dexId:        best.dexId,
    tokenName:    best.baseToken?.name,
    tokenSymbol:  best.baseToken?.symbol,
  };
  cache.set(key, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

// ── On-chain metadata lookup — used when adding a new token ──
const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function getTokenMetadata(contractAddress) {
  if (!ethers.isAddress(contractAddress)) {
    throw new Error("Invalid contract address format");
  }
  const provider = getProvider();
  const contract = new ethers.Contract(contractAddress, ERC20_META_ABI, provider);

  const [symbol, name, decimals] = await Promise.all([
    contract.symbol().catch(() => null),
    contract.name().catch(() => null),
    contract.decimals().catch(() => null),
  ]);

  if (!symbol || decimals === null) {
    throw new Error("Could not read token contract — is this a valid BEP20 token address?");
  }

  // Also try to get live market data for a preview
  const marketInfo = await getTokenInfo(contractAddress);

  return {
    symbol,
    name: name || symbol,
    decimals,
    contract: ethers.getAddress(contractAddress), // checksummed
    market: marketInfo, // may be null if no DEX pair found yet
  };
}

module.exports = { getTokenInfo, getTokenMetadata };
