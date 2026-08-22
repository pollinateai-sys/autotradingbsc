// ============================================================
//  MOCK DEX — mirrors api/lib/dex.js export surface exactly.
//  Injected via setup-mocks.js into both the old pancakeswap.js
//  path AND the new dex.js path so any require() of either works.
// ============================================================
const wallet = require("./wallet");

const FAKE_PRICES = {};
const DEFAULT_BASE_PRICE = 0.0001;
let txCounter = 0;

function _setPrice(contract, priceBnb) { FAKE_PRICES[contract] = priceBnb; }
function _movePricePercent(contract, pct) {
  const cur = FAKE_PRICES[contract] || DEFAULT_BASE_PRICE;
  FAKE_PRICES[contract] = cur * (1 + pct / 100);
}

async function getCurrentPriceBnb(provider, contract) {
  return FAKE_PRICES[contract] ?? DEFAULT_BASE_PRICE;
}

async function findBestQuote(provider, tokenAddress, bnbAmount) {
  const price = FAKE_PRICES[tokenAddress] ?? DEFAULT_BASE_PRICE;
  const amountOut = BigInt(Math.floor((bnbAmount / price) * 1e18));
  return {
    amountOut,
    router: { id: "pancakeswap_v2", name: "PancakeSwap V2", address: "0x10ED43C718714eb63d5aA57B78B54704E256024E" },
    version: 2,
  };
}

async function hasLiquidityAnywhere(provider, tokenAddress) { return true; }

async function buyToken(signerWallet, tokenAddress, bnbAmount, maxSlippage = 1.0) {
  const profileId   = signerWallet._profileId;
  const price       = FAKE_PRICES[tokenAddress] ?? DEFAULT_BASE_PRICE;
  const tokenAmount = bnbAmount / price;
  wallet._adjustBnbBalance(profileId, -bnbAmount);
  const current = await wallet.getTokenBalance(profileId, tokenAddress);
  wallet._setTokenBalance(profileId, tokenAddress, current + tokenAmount);
  txCounter++;
  return { hash: "0x" + "b".repeat(10) + String(txCounter).padStart(54,"0"), dex: "PancakeSwap V2", simulated: false };
}

async function sellToken(signerWallet, tokenAddress, tokenAmount) {
  const profileId = signerWallet._profileId;
  const price     = FAKE_PRICES[tokenAddress] ?? DEFAULT_BASE_PRICE;
  const bnbOut    = tokenAmount * price;
  const current   = await wallet.getTokenBalance(profileId, tokenAddress);
  wallet._setTokenBalance(profileId, tokenAddress, Math.max(0, current - tokenAmount));
  wallet._adjustBnbBalance(profileId, bnbOut);
  txCounter++;
  return { hash: "0x" + "s".repeat(10) + String(txCounter).padStart(54,"0"), dex: "PancakeSwap V2", simulated: false };
}

// Legacy aliases kept so any old test code still works
const buyTokenWithBnb = (signer, addr, amt, slip, auto) => buyToken(signer, addr, amt, slip);
const sellTokenForBnb = (signer, addr, amt, auto) => sellToken(signer, addr, amt);
const getQuote = findBestQuote;

module.exports = {
  buyToken, sellToken, getCurrentPriceBnb, findBestQuote, hasLiquidityAnywhere,
  buyTokenWithBnb, sellTokenForBnb, getQuote,
  _setPrice, _movePricePercent, _FAKE_PRICES: FAKE_PRICES,
};
