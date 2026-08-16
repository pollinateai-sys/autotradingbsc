// ============================================================
//  MARKET DATA
//  - DexScreener for price/liquidity/volume (free, no key)
//  - On-chain ERC20 calls for token metadata (symbol/name/decimals)
//    used when a user adds a new token by contract address only.
// ============================================================

const https = require("https");
const { ethers } = require("ethers");
const { getProvider } = require("./wallet");

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on("error", () => resolve(null));
  });
}

async function getTokenInfo(contractAddress) {
  const json = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
  if (!json) return null;
  const pairs = (json.pairs || []).filter(p => p.chainId === "bsc");
  if (!pairs.length) return null;
  pairs.sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));
  const best = pairs[0];
  return {
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
