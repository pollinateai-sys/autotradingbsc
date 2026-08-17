// ============================================================
//  MOCK PANCAKESWAP — simulated swaps with controllable price.
//  Signatures mirror the real api/lib/pancakeswap.js exactly:
//  read functions take a provider (ignored here), write functions
//  take a signerWallet whose _profileId tells us whose in-memory
//  balance to adjust.
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

async function getCurrentPriceBnb(provider, contract) {
  if (FAKE_PRICES[contract] === undefined) FAKE_PRICES[contract] = DEFAULT_BASE_PRICE;
  return FAKE_PRICES[contract];
}
async function getQuote(provider, contract, bnbAmount) {
  const price = await getCurrentPriceBnb(provider, contract);
  return BigInt(Math.floor((bnbAmount / price) * 1e18));
}

async function buyTokenWithBnb(signerWallet, contract, bnbAmount, maxSlippage = 1.0, autoTrade = true) {
  const profileId = signerWallet._profileId;
  const price = await getCurrentPriceBnb(null, contract);
  const tokenAmount = bnbAmount / price;

  wallet._adjustBnbBalance(profileId, -bnbAmount);
  const current = await wallet.getTokenBalance(profileId, contract);
  wallet._setTokenBalance(profileId, contract, current + tokenAmount);

  txCounter++;
  if (!autoTrade) return { hash: "SIMULATED_" + txCounter, simulated: true };
  return { hash: "0x" + "b".repeat(10) + txCounter.toString().padStart(54, "0"), simulated: false };
}

async function sellTokenForBnb(signerWallet, contract, tokenAmount, autoTrade = true) {
  const profileId = signerWallet._profileId;
  const price = await getCurrentPriceBnb(null, contract);
  const bnbOut = tokenAmount * price;

  const current = await wallet.getTokenBalance(profileId, contract);
  wallet._setTokenBalance(profileId, contract, Math.max(0, current - tokenAmount));
  wallet._adjustBnbBalance(profileId, bnbOut);

  txCounter++;
  if (!autoTrade) return { hash: "SIMULATED_" + txCounter, simulated: true };
  return { hash: "0x" + "s".repeat(10) + txCounter.toString().padStart(54, "0"), simulated: false };
}

module.exports = {
  buyTokenWithBnb, sellTokenForBnb, getCurrentPriceBnb, getQuote,
  _setPrice, _movePricePercent, _getEntryBasePrice, _FAKE_PRICES: FAKE_PRICES,
};
