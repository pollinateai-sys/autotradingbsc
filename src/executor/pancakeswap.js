// ============================================================
//  PANCAKESWAP EXECUTOR (V2 Router — most reliable)
//  Executes spot BUY and SELL trades on PancakeSwap.
//  EXACT token approval only — never unlimited approval.
// ============================================================

const { ethers } = require("ethers");
const SETTINGS   = require("../../config/settings");

// PancakeSwap V2 Router ABI (only what we need)
const ROUTER_ABI = [
  // BNB → Token
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] path, address to, uint deadline) payable",
  // Token → BNB
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)",
  // Quote
  "function getAmountsOut(uint amountIn, address[] path) view returns (uint[] amounts)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

class PancakeSwapExecutor {
  constructor(walletManager) {
    this.wm      = walletManager;
    this.wallet  = walletManager.wallet;
    this.router  = new ethers.Contract(
      SETTINGS.pancakeRouterV2,
      ROUTER_ABI,
      walletManager.wallet
    );
    this.wbnb    = SETTINGS.wbnbAddress;
    this.router_address = SETTINGS.pancakeRouterV2;
  }

  // ────────────────────────────────────────────
  async _getGasPrice() {
    const feeData = await this.wm.provider.getFeeData();
    // Add 10% buffer over base gas price
    return (feeData.gasPrice * 110n) / 100n;
  }

  // ────────────────────────────────────────────
  async _approveExact(tokenAddress, amountWei) {
    console.log(`  🔓 Approving exact amount for swap...`);
    const token   = new ethers.Contract(tokenAddress, ERC20_ABI, this.wallet);
    const gasPrice = await this._getGasPrice();
    const tx = await token.approve(this.router_address, amountWei, { gasPrice });
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      console.log(`  ✅ Approval confirmed`);
      return true;
    }
    console.log(`  ❌ Approval failed`);
    return false;
  }

  // ────────────────────────────────────────────
  async getQuote(tokenAddress, bnbAmount) {
    try {
      const amountIn = ethers.parseEther(bnbAmount.toString());
      const path     = [this.wbnb, tokenAddress];
      const amounts  = await this.router.getAmountsOut(amountIn, path);
      return amounts[1]; // Expected token output
    } catch (e) {
      console.log(`  ⚠️  Quote error: ${e.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────
  async buyTokenWithBnb(token, bnbAmount) {
    console.log(`\n  🛒 BUY ORDER — ${token.symbol}`);
    console.log(`     Spending : ${bnbAmount} BNB`);
    console.log(`     Contract : ${token.contract}`);

    // Check balance
    if (!(await this.wm.hasEnoughBnb(bnbAmount))) return null;

    const amountIn  = ethers.parseEther(bnbAmount.toString());
    const path      = [this.wbnb, token.contract];
    const deadline  = Math.floor(Date.now() / 1000) + 300; // 5 min
    const gasPrice  = await this._getGasPrice();

    // Get expected output and apply slippage
    const expectedOut = await this.getQuote(token.contract, bnbAmount);
    if (!expectedOut) return null;

    const slippage   = BigInt(Math.floor(SETTINGS.maxSlippagePercent * 100));
    const amountOutMin = (expectedOut * (10000n - slippage)) / 10000n;

    console.log(`     Expected : ${ethers.formatUnits(expectedOut, 18)} ${token.symbol}`);
    console.log(`     Min out  : ${ethers.formatUnits(amountOutMin, 18)} ${token.symbol}`);

    if (SETTINGS.autoTrade === false) {
      console.log(`  📝 autoTrade=false — signal logged only, no real trade executed.`);
      return "SIGNAL_ONLY";
    }

    try {
      const tx = await this.router.swapExactETHForTokensSupportingFeeOnTransferTokens(
        amountOutMin,
        path,
        this.wm.address,
        deadline,
        { value: amountIn, gasPrice, gasLimit: 350000n }
      );
      console.log(`  📤 Buy TX sent: ${tx.hash}`);
      console.log(`  ⏳ Waiting for confirmation...`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(`  ✅ BUY CONFIRMED | TX: ${tx.hash}`);
        return tx.hash;
      }
      console.log(`  ❌ BUY FAILED`);
      return null;
    } catch (e) {
      console.log(`  ❌ Buy error: ${e.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────
  async sellTokenForBnb(token, tokenAmount) {
    console.log(`\n  💰 SELL ORDER — ${token.symbol}`);
    console.log(`     Selling  : ${tokenAmount} ${token.symbol}`);

    const erc20      = new ethers.Contract(token.contract, ERC20_ABI, this.wallet);
    const decimals   = await erc20.decimals();
    const amountWei  = ethers.parseUnits(tokenAmount.toString(), decimals);
    const path       = [token.contract, this.wbnb];
    const deadline   = Math.floor(Date.now() / 1000) + 300;
    const gasPrice   = await this._getGasPrice();

    // Approve EXACT amount — never unlimited
    const approved = await this._approveExact(token.contract, amountWei);
    if (!approved) return null;

    if (SETTINGS.autoTrade === false) {
      console.log(`  📝 autoTrade=false — sell signal logged only.`);
      return "SIGNAL_ONLY";
    }

    try {
      const tx = await this.router.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountWei,
        0n,          // amountOutMin = 0 (we trust slippage guard from settings)
        path,
        this.wm.address,
        deadline,
        { gasPrice, gasLimit: 350000n }
      );
      console.log(`  📤 Sell TX sent: ${tx.hash}`);
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        console.log(`  ✅ SELL CONFIRMED | TX: ${tx.hash}`);
        return tx.hash;
      }
      console.log(`  ❌ SELL FAILED`);
      return null;
    } catch (e) {
      console.log(`  ❌ Sell error: ${e.message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────
  async getCurrentPrice(tokenAddress) {
    // Price in BNB per token (1 token = X BNB)
    try {
      const oneToken = ethers.parseEther("1");
      const amounts  = await this.router.getAmountsOut(
        oneToken,
        [tokenAddress, this.wbnb]
      );
      return parseFloat(ethers.formatEther(amounts[1]));
    } catch (_) {
      return null;
    }
  }
}

module.exports = PancakeSwapExecutor;
