// ============================================================
//  PANCAKESWAP V2 EXECUTOR
//  Spot-only swaps. Exact-amount approvals only — never unlimited.
//  Every function that signs a transaction takes an explicit
//  signerWallet (that profile's decrypted ethers.Wallet).
// ============================================================

const { ethers } = require("ethers");

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

async function getGasPrice(providerLike) {
  const fee = await providerLike.getFeeData();
  return (fee.gasPrice * 110n) / 100n;
}

async function getQuote(provider, tokenAddress, bnbAmount) {
  try {
    const router   = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
    const amountIn = ethers.parseEther(bnbAmount.toString());
    const amounts  = await router.getAmountsOut(amountIn, [WBNB, tokenAddress]);
    return amounts[1];
  } catch { return null; }
}

async function getCurrentPriceBnb(provider, tokenAddress) {
  try {
    const router  = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, provider);
    const amounts = await router.getAmountsOut(ethers.parseEther("1"), [tokenAddress, WBNB]);
    return parseFloat(ethers.formatEther(amounts[1]));
  } catch { return null; }
}

// ── Clean error extraction — never dump the full tx receipt ──
function cleanSwapError(e) {
  // CALL_EXCEPTION: the contract reverted on-chain
  if (e.code === "CALL_EXCEPTION") {
    const reason = e.reason || e.revert?.name || null;
    if (reason) return `Swap reverted: ${reason}`;
    // No decoded reason — likely no liquidity pool, honeypot, or
    // the token can't be swapped on PancakeSwap V2
    return "Swap reverted on-chain — token may have no V2 pool, be a honeypot, or charge a high transfer fee";
  }
  if (e.code === "INSUFFICIENT_FUNDS") return "Insufficient BNB for gas";
  if (e.code === "NETWORK_ERROR")      return "BSC RPC network error — check your connection";
  if (e.code === "TIMEOUT")            return "Transaction timed out — BSC may be congested";
  // Fallback: first sentence of the message only, no JSON dumps
  const msg = String(e.message || e).split("\n")[0].substring(0, 200);
  return msg;
}

/**
 * Buy token with BNB, signed by the given profile's wallet.
 * @param {ethers.Wallet} signerWallet
 * @param {boolean} autoTrade - if false, simulates only (no real tx)
 */
async function buyTokenWithBnb(signerWallet, tokenAddress, bnbAmount, maxSlippage = 1.0, autoTrade = true) {
  const provider = signerWallet.provider;
  const router   = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signerWallet);
  const amountIn = ethers.parseEther(bnbAmount.toString());
  const deadline = Math.floor(Date.now() / 1000) + 300;

  const expectedOut = await getQuote(provider, tokenAddress, bnbAmount);
  if (!expectedOut) {
    throw new Error("No liquidity pool found on PancakeSwap V2 — token may only exist on V3 or another DEX");
  }

  const slipBps      = BigInt(Math.floor(maxSlippage * 100));
  const amountOutMin = (expectedOut * (10000n - slipBps)) / 10000n;

  if (!autoTrade) {
    return { hash: "SIMULATED_" + Date.now(), simulated: true };
  }

  const gasPrice = await getGasPrice(provider);
  try {
    const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
      amountOutMin, [WBNB, tokenAddress], signerWallet.address, deadline,
      { value: amountIn, gasPrice, gasLimit: 350000n }
    );
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      throw new Error(`Transaction reverted on-chain (tx: ${tx.hash.slice(0,12)}…)`);
    }
    return { hash: tx.hash, simulated: false };
  } catch (e) {
    throw new Error(cleanSwapError(e));
  }
}

/**
 * Sell token for BNB, signed by the given profile's wallet.
 * @param {ethers.Wallet} signerWallet
 * @param {boolean} autoTrade - if false, simulates only (no real tx)
 */
async function sellTokenForBnb(signerWallet, tokenAddress, tokenAmount, autoTrade = true) {
  const provider  = signerWallet.provider;
  const router    = new ethers.Contract(ROUTER_ADDRESS, ROUTER_ABI, signerWallet);
  const erc20     = new ethers.Contract(tokenAddress, ERC20_ABI, signerWallet);
  const decimals  = await erc20.decimals();
  const amountWei = ethers.parseUnits(tokenAmount.toFixed(Math.min(18, Number(decimals))).toString(), decimals);
  const deadline  = Math.floor(Date.now() / 1000) + 300;

  if (!autoTrade) {
    return { hash: "SIMULATED_" + Date.now(), simulated: true };
  }

  const gasPrice  = await getGasPrice(provider);
  try {
    const approveTx = await erc20.approve(ROUTER_ADDRESS, amountWei, { gasPrice });
    await approveTx.wait();

    const tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      amountWei, 0n, [tokenAddress, WBNB], signerWallet.address, deadline,
      { gasPrice, gasLimit: 350000n }
    );
    const receipt = await tx.wait();
    if (receipt.status !== 1) {
      throw new Error(`Sell reverted on-chain (tx: ${tx.hash.slice(0,12)}…)`);
    }
    return { hash: tx.hash, simulated: false };
  } catch (e) {
    throw new Error(cleanSwapError(e));
  }
}

module.exports = { buyTokenWithBnb, sellTokenForBnb, getCurrentPriceBnb, getQuote };
