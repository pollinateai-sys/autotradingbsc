// ============================================================
//  MOCK MARKET DATA
// ============================================================
const { ethers } = require("ethers");

const FAKE_LIQUIDITY = {}; // contract -> liquidityUsd override
let FAKE_CHANGES = null;   // { change1h, change24h } override for entry-rule tests

async function getTokenInfo(contract) {
  const liq = FAKE_LIQUIDITY[contract] !== undefined ? FAKE_LIQUIDITY[contract] : 50000;
  if (liq === null) return null; // simulate "no market data"
  const ch = FAKE_CHANGES || { change1h: 1.2, change24h: 4.5 };
  return {
    pairAddress: "0xFakePair" + contract.slice(-6),
    priceUsd: 100, priceNative: 0.0001,
    volume24h: 250000, liquidityUsd: liq,
    change5m: 0, change6h: 0,
    change1h: ch.change1h, change24h: ch.change24h,
    dexId: "pancakeswap", tokenName: "Fake Token", tokenSymbol: "FAKE",
  };
}

async function getTokenMetadata(contractAddress) {
  if (!ethers.isAddress(contractAddress)) throw new Error("Invalid contract address format");
  const market = await getTokenInfo(contractAddress);
  return {
    symbol:         "NEWTKN",
    name:           "New Test Token",
    decimals:       18,
    contract:       ethers.getAddress(contractAddress),
    market,
    hasOnChainPool: true,          // always true in tests — mock DEX always returns a quote
    bestDex:        "PancakeSwap V2",
  };
}

function _setLiquidity(contract, usdOrNull) { FAKE_LIQUIDITY[contract] = usdOrNull; }
function _setChanges(change1h, change24h) {
  FAKE_CHANGES = (change1h === null) ? null : { change1h, change24h };
}

module.exports = { getTokenInfo, getTokenMetadata, _setLiquidity, _setChanges };
