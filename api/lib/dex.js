// ============================================================
//  MULTI-DEX ROUTER — BSC
//  Supports every major AMM on Binance Smart Chain.
//  V2-compatible routers all share one ABI.
//  PancakeSwap V3 uses its own interface.
//
//  TRADE STRATEGY: for each token we try to find the best
//  quote across all routers. Whichever gives the most tokens
//  out wins — that's both the safest and most profitable path.
// ============================================================

const { ethers } = require("ethers");

const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

// ── V2-compatible routers (identical ABI) ─────────────────────
const V2_ROUTERS = [
  {
    id:      "pancakeswap_v2",
    name:    "PancakeSwap V2",
    address: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  },
  {
    id:      "biswap",
    name:    "BiSwap",
    address: "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",
  },
  {
    id:      "apeswap",
    name:    "ApeSwap",
    address: "0xcF0feBd3f17CEf5b47b0cD257aCf6025c5BFf3b",
  },
  {
    id:      "babyswap",
    name:    "BabySwap",
    address: "0x325E343f1dE602396E256B67eFd1F61C3A6B38Bd",
  },
  {
    id:      "mdex",
    name:    "MDEX",
    address: "0x62c17f7c3d8028a65428df6f66c34c8b17ed50ec",
  },
  {
    id:      "nomiswap",
    name:    "Nomiswap",
    address: "0xd654953D746f0b114d1F85332Dc43446ac79413d",
  },
  {
    id:      "knightswap",
    name:    "KnightSwap",
    address: "0x05E61E0cDcD2170a76F9568a110CEe3AFdD6c46f",
  },
];

// ── V3 (PancakeSwap V3) ───────────────────────────────────────
const V3_ROUTER = {
  id:       "pancakeswap_v3",
  name:     "PancakeSwap V3",
  address:  "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4",
  feeTiers: [2500, 500, 100, 10000], // try cheapest first
};

// ── ABIs ──────────────────────────────────────────────────────
const V2_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
];

const V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)",
];
const V3_QUOTER_ADDRESS = "0xbC203d7f83677c7ed3F7acEc959963E5Ce6cd55B";

const V3_ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
];

// ── Error cleanup ─────────────────────────────────────────────
function cleanError(e) {
  if (e.code === "CALL_EXCEPTION")   return e.reason || "Swap reverted on-chain — no pool, honeypot, or transfer fee issue";
  if (e.code === "INSUFFICIENT_FUNDS") return "Insufficient BNB for gas";
  if (e.code === "NETWORK_ERROR")    return "BSC RPC network error";
  return String(e.message || e).split("\n")[0].substring(0, 200);
}

async function getGasPrice(provider) {
  const fee = await provider.getFeeData();
  return (fee.gasPrice * 110n) / 100n;
}

// ── V2 quote (returns { amountOut, router } or null) ──────────
async function getV2Quote(provider, tokenAddress, bnbAmount, router) {
  try {
    const contract = new ethers.Contract(router.address, V2_ABI, provider);
    const amountIn = ethers.parseEther(bnbAmount.toString());
    const amounts  = await contract.getAmountsOut(amountIn, [WBNB, tokenAddress]);
    if (!amounts || amounts[1] === 0n) return null;
    return { amountOut: amounts[1], router, version: 2 };
  } catch { return null; }
}

// ── V3 quote (tries all fee tiers, returns best or null) ──────
async function getV3Quote(provider, tokenAddress, bnbAmount) {
  try {
    const quoter  = new ethers.Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
    const amountIn = ethers.parseEther(bnbAmount.toString());
    let best = null;
    for (const fee of V3_ROUTER.feeTiers) {
      try {
        const out = await quoter.quoteExactInputSingle(WBNB, tokenAddress, fee, amountIn, 0n);
        if (out > 0n && (!best || out > best.amountOut)) {
          best = { amountOut: out, router: { ...V3_ROUTER, fee }, version: 3 };
        }
      } catch { /* fee tier not available */ }
    }
    return best;
  } catch { return null; }
}

// ── Find best quote across ALL DEXes ─────────────────────────
// Returns { amountOut, router, version } or null if no pool found anywhere
async function findBestQuote(provider, tokenAddress, bnbAmount) {
  // Run all V2 quotes in parallel
  const v2Quotes = await Promise.all(
    V2_ROUTERS.map(r => getV2Quote(provider, tokenAddress, bnbAmount, r))
  );

  // V3 in parallel too
  const v3Quote = await getV3Quote(provider, tokenAddress, bnbAmount);

  const all = [...v2Quotes, v3Quote].filter(Boolean);
  if (all.length === 0) return null;

  // Pick the one giving the most tokens out
  return all.reduce((best, q) => (q.amountOut > best.amountOut ? q : best));
}

// ── Check if ANY DEX has liquidity (for token add validation) ─
async function hasLiquidityAnywhere(provider, tokenAddress, minBnbEquiv = 0.001) {
  const result = await findBestQuote(provider, tokenAddress, minBnbEquiv);
  return result !== null;
}

// ── Execute buy using whichever DEX gives best quote ──────────
async function buyToken(signerWallet, tokenAddress, bnbAmount, maxSlippage = 1.0) {
  const provider = signerWallet.provider;
  const best     = await findBestQuote(provider, tokenAddress, bnbAmount);

  if (!best) throw new Error("No liquidity found on any supported DEX (V2 or V3)");

  const slipBps      = BigInt(Math.floor(maxSlippage * 100));
  const amountOutMin = (best.amountOut * (10000n - slipBps)) / 10000n;
  const amountIn     = ethers.parseEther(bnbAmount.toString());
  const deadline     = Math.floor(Date.now() / 1000) + 300;
  const gasPrice     = await getGasPrice(provider);

  console.log(`  🔀 Using ${best.router.name} (best quote: ${ethers.formatUnits(best.amountOut, 18).substring(0,12)} tokens)`);

  try {
    let tx;
    if (best.version === 2) {
      const router = new ethers.Contract(best.router.address, V2_ABI, signerWallet);
      tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
        amountOutMin, [WBNB, tokenAddress], signerWallet.address, deadline,
        { value: amountIn, gasPrice, gasLimit: 400000n }
      );
    } else {
      const router = new ethers.Contract(V3_ROUTER.address, V3_ROUTER_ABI, signerWallet);
      tx = await router.exactInputSingle(
        [WBNB, tokenAddress, best.router.fee, signerWallet.address, amountIn, amountOutMin, 0n],
        { value: amountIn, gasPrice, gasLimit: 400000n }
      );
    }
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`Swap reverted on ${best.router.name}`);
    return { hash: tx.hash, dex: best.router.name, simulated: false };
  } catch (e) {
    throw new Error(`${best.router.name}: ${cleanError(e)}`);
  }
}

// ── Execute sell using best DEX ───────────────────────────────
async function sellToken(signerWallet, tokenAddress, tokenAmount) {
  const provider = signerWallet.provider;
  const erc20    = new ethers.Contract(tokenAddress, ERC20_ABI, signerWallet);
  const decimals = Number(await erc20.decimals());
  const amountWei = ethers.parseUnits(
    tokenAmount.toFixed(Math.min(18, decimals)), decimals
  );
  const gasPrice = await getGasPrice(provider);
  const deadline = Math.floor(Date.now() / 1000) + 300;

  // Find best sell route (swap token→WBNB direction)
  // Use a small probe amount to find which DEX has a pool
  const best = await findBestQuote(provider, tokenAddress, 0.001).catch(() => null);
  const routerAddress = best ? best.router.address : V2_ROUTERS[0].address;
  const routerAbi     = (best?.version === 3) ? V3_ROUTER_ABI : V2_ABI;
  const routerName    = best?.router.name || "PancakeSwap V2";

  // Approve exact amount
  try {
    const approveTx = await erc20.approve(routerAddress, amountWei, { gasPrice });
    await approveTx.wait();
  } catch (e) { throw new Error(`Approval failed: ${cleanError(e)}`); }

  try {
    let tx;
    if (best?.version === 3) {
      const router = new ethers.Contract(V3_ROUTER.address, V3_ROUTER_ABI, signerWallet);
      tx = await router.exactInputSingle(
        [tokenAddress, WBNB, best.router.fee, signerWallet.address, amountWei, 0n, 0n],
        { gasPrice, gasLimit: 400000n }
      );
    } else {
      const router = new ethers.Contract(routerAddress, V2_ABI, signerWallet);
      tx = await router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountWei, 0n, [tokenAddress, WBNB], signerWallet.address, deadline,
        { gasPrice, gasLimit: 400000n }
      );
    }
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`Sell reverted on ${routerName}`);
    return { hash: tx.hash, dex: routerName, simulated: false };
  } catch (e) {
    throw new Error(`${routerName}: ${cleanError(e)}`);
  }
}

// ── Price in BNB (read-only, best available DEX) ─────────────
async function getCurrentPriceBnb(provider, tokenAddress) {
  for (const router of V2_ROUTERS) {
    try {
      const contract = new ethers.Contract(router.address, V2_ABI, provider);
      const amounts  = await contract.getAmountsOut(ethers.parseEther("1"), [tokenAddress, WBNB]);
      if (amounts[1] > 0n) return parseFloat(ethers.formatEther(amounts[1]));
    } catch { /* try next */ }
  }
  // Try V3
  try {
    const quoter  = new ethers.Contract(V3_QUOTER_ADDRESS, V3_QUOTER_ABI, provider);
    for (const fee of V3_ROUTER.feeTiers) {
      try {
        const out = await quoter.quoteExactInputSingle(tokenAddress, WBNB, fee, ethers.parseEther("1"), 0n);
        if (out > 0n) return parseFloat(ethers.formatEther(out));
      } catch { /* try next fee */ }
    }
  } catch { /* V3 unavailable */ }
  return null;
}

module.exports = {
  buyToken, sellToken, getCurrentPriceBnb,
  findBestQuote, hasLiquidityAnywhere,
  V2_ROUTERS, V3_ROUTER,
};
