// ============================================================
//  MOCK PANCAKESWAP — simulated swaps with controllable price
//  Lets the test script move price up/down to trigger TP/SL.
// ============================================================
const wallet = require("./wallet");

const FAKE_PRICES = {};      // contract -> price in BNB per token
const DEFAULT_BASE_PRICE = 0.0001;
let txCounter = 0;

function _setPrice(contract, priceBnb) { FAKE_PRICES[contract] = priceBnb; }
function _movePricePercent(contract, pct) {
  const cur = FAKE_PRICES[contract] || DEFAULT_BASE_PRICE;
  FAKE_PRICES[contract] = cur * (1 + pct / 100);
}
function _getEntryBasePrice(contract) { return FAKE_PRICES[contract] || DEFAULT_BASE_PRICE; }

async function getCurrentPriceBnb(contract) {
  if (FAKE_PRICES[contract] === undefined) FAKE_PRICES[contract] = DEFAULT_BASE_PRICE;
  return FAKE_PRICES[contract];
}
async function getQuote(contract, bnbAmount) {
  const price = await getCurrentPriceBnb(contract);
  return BigInt(Math.floor((bnbAmount / price) * 1e18));
}

async function buyTokenWithBnb(contract, bnbAmount, maxSlippage = 1.0, autoTrade = true) {
  const price = await getCurrentPriceBnb(contract);
  const tokenAmount = bnbAmount / price;

  wallet._adjustBnbBalance(-bnbAmount);
  const current = await wallet.getTokenBalance(contract);
  wallet._setTokenBalance(contract, current + tokenAmount);

  txCounter++;
  if (!autoTrade) return { hash: "SIMULATED_" + txCounter, simulated: true };
  return { hash: "0x" + "b".repeat(10) + txCounter.toString().padStart(54, "0"), simulated: false };
}

async function sellTokenForBnb(contract, tokenAmount, autoTrade = true) {
  const price = await getCurrentPriceBnb(contract);
  const bnbOut = tokenAmount * price;

  const current = await wallet.getTokenBalance(contract);
  wallet._setTokenBalance(contract, Math.max(0, current - tokenAmount));
  wallet._adjustBnbBalance(bnbOut);

  txCounter++;
  if (!autoTrade) return { hash: "SIMULATED_" + txCounter, simulated: true };
  return { hash: "0x" + "s".repeat(10) + txCounter.toString().padStart(54, "0"), simulated: false };
}

module.exports = {
  buyTokenWithBnb, sellTokenForBnb, getCurrentPriceBnb, getQuote,
  _setPrice, _movePricePercent, _getEntryBasePrice, _FAKE_PRICES: FAKE_PRICES,
};
