// ============================================================
//  PANCAKESWAP V2 EXECUTOR
//  Spot-only swaps. Exact-amount approvals only — never unlimited.
// ============================================================

const { ethers } = require("ethers");
const { getWallet, getProvider } = require("./wallet");

const ROUTER_ADDRESS = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const WBNB           = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const ROUTER_ABI = [
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

function getRouter() {
  return new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, getWallet());
}

async function getGasPrice() {
  const fee = await getProvider().getFeeData();
  return (fee.gasPrice * 110n) / 100n;
}

async function getQuote(tokenAddress, bnbAmount) {
  try {
    const router   = getRouter();
    const amountIn = ethers.parseEther(bnbAmount.toString());
    const amounts  = await router.getAmountsOut(amountIn, [WBNB, tokenAddress]);
    return amounts[1];
  } catch { return null; }
}

async function getCurrentPriceBnb(tokenAddress) {
  try {
    const router  = getRouter();
    const amounts = await router.getAmountsOut(ethers.parseEther("1"), [tokenAddress, WBNB]);
    return parseFloat(ethers.formatEther(amounts[1]));
  } catch { return null; }
}

/**
 * Buy token with BNB.
 * @param {boolean} autoTrade - if false, simulates only (no real tx)
 */
async function buyTokenWithBnb(tokenAddress, bnbAmount, maxSlippage = 1.0, autoTrade = true) {
  const wallet   = getWallet();
  const router   = getRouter();
  const amountIn = ethers.parseEther(bnbAmount.toString());
  const deadline = Math.floor(Date.now() / 1000) + 300;

  const expectedOut = await getQuote(tokenAddress, bnbAmount);
  if (!expectedOut) throw new Error("Could not get price quote — no liquidity pool found");

  const slipBps      = BigInt(Math.floor(maxSlippage * 100));
  const amountOutMin = (expectedOut * (10000n - slipBps)) / 10000n;

  if (!autoTrade) {
    return { hash: "SIMULATED_" + Date.now(), simulated: true };
  }

  const gasPrice = await getGasPrice();
  const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
    amountOutMin, [WBNB, tokenAddress], wallet.address, deadline,
    { value: amountIn, gasPrice, gasLimit: 350000n }
  );
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Transaction reverted");
  return { hash: tx.hash, simulated: false };
}

/**
 * Sell token for BNB.
 * @param {boolean} autoTrade - if false, simulates only (no real tx)
 */
async function sellTokenForBnb(tokenAddress, tokenAmount, autoTrade = true) {
  const wallet   = getWallet();
  const router   = getRouter();
  const erc20    = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const decimals = await erc20.decimals();
  const amountWei = ethers.parseUnits(tokenAmount.toFixed(Math.min(18, decimals)).toString(), decimals);
  const deadline  = Math.floor(Date.now() / 1000) + 300;

  if (!autoTrade) {
    return { hash: "SIMULATED_" + Date.now(), simulated: true };
  }

  const gasPrice   = await getGasPrice();
  const approveTx  = await erc20.approve(ROUTER_ADDRESS, amountWei, { gasPrice });
  await approveTx.wait();

  const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
    amountWei, 0n, [tokenAddress, WBNB], wallet.address, deadline,
    { gasPrice, gasLimit: 350000n }
  );
  const receipt = await tx.wait();
  if (receipt.status !== 1) throw new Error("Transaction reverted");
  return { hash: tx.hash, simulated: false };
}

module.exports = { buyTokenWithBnb, sellTokenForBnb, getCurrentPriceBnb, getQuote };
