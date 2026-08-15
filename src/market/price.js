// ============================================================
//  MARKET DATA — Price & Liquidity via DexScreener (free, no key)
// ============================================================

const https = require("https");

class MarketData {
  async getTokenInfo(contractAddress) {
    return new Promise((resolve) => {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`;
      https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        let data = "";
        res.on("data", d => data += d);
        res.on("end", () => {
          try {
            const json  = JSON.parse(data);
            const pairs = (json.pairs || []).filter(p => p.chainId === "bsc");
            if (!pairs.length) return resolve(null);
            pairs.sort((a, b) =>
              parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0)
            );
            const best = pairs[0];
            resolve({
              pairAddress:  best.pairAddress,
              priceUsd:     parseFloat(best.priceUsd    || 0),
              priceNative:  parseFloat(best.priceNative || 0),
              volume24h:    parseFloat(best.volume?.h24  || 0),
              liquidityUsd: parseFloat(best.liquidity?.usd || 0),
              change1h:     parseFloat(best.priceChange?.h1  || 0),
              change24h:    parseFloat(best.priceChange?.h24 || 0),
              dexId:        best.dexId,
            });
          } catch (_) { resolve(null); }
        });
      }).on("error", () => resolve(null));
    });
  }
}

module.exports = MarketData;
