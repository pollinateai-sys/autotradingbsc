// ============================================================
//  STRATEGY ENGINE
//  Implements Strategy A and B (and C).
//  Tracks which TP levels have been hit and executes sells.
// ============================================================

const { validateStrategy } = require("../../config/strategies");
const SETTINGS             = require("../../config/settings");

class StrategyEngine {
  constructor(executor, monitor, notifier, logger) {
    this.executor  = executor;
    this.monitor   = monitor;
    this.notifier  = notifier;
    this.logger    = logger;
    this.strategy  = validateStrategy(SETTINGS.activeStrategy);
    console.log(`\n  📐 Active Strategy: ${this.strategy.name}`);
    console.log(`     Stop Loss : ${this.strategy.stopLoss}%`);
    this.strategy.takeProfits.forEach((tp, i) => {
      console.log(`     TP${i+1}       : +${tp.targetPercent}% → sell ${tp.sellPercent}%`);
    });
  }

  // ────────────────────────────────────────────
  async openPosition(token, bnbAmount) {
    console.log(`\n  🚀 Opening position: ${token.symbol}`);

    const txHash = await this.executor.buyTokenWithBnb(token, bnbAmount);
    if (!txHash) {
      console.log(`  ❌ Failed to buy ${token.symbol}`);
      return false;
    }

    // Get entry price and actual token balance received
    await this._sleep(3000); // Wait for BSC state to update
    const entryPriceBnb  = await this.executor.getCurrentPrice(token.contract);
    const tokenBalance   = await this.wm_getBalance(token);

    if (!entryPriceBnb || !tokenBalance) {
      console.log(`  ⚠️  Could not confirm position details for ${token.symbol}`);
      return false;
    }

    // Register position in monitor
    this.monitor.addPosition({
      token,
      entryPriceBnb,
      totalTokens:  tokenBalance,
      remainingTokens: tokenBalance,
      bnbSpent:     bnbAmount,
      buyTxHash:    txHash,
      tpHit:        [],            // Track which TPs have been hit
      slHit:        false,
      openTime:     Date.now(),
      strategy:     this.strategy,
    });

    if (this.notifier) {
      await this.notifier.sendBuy(token.symbol, bnbAmount, entryPriceBnb, this.strategy);
    }
    if (this.logger) {
      this.logger.logTrade("BUY", token.symbol, bnbAmount, entryPriceBnb, txHash);
    }

    return true;
  }

  // ────────────────────────────────────────────
  async checkAndExecuteExits(position) {
    const { token, entryPriceBnb, remainingTokens, tpHit } = position;
    if (remainingTokens <= 0) return;

    const currentPrice = await this.executor.getCurrentPrice(token.contract);
    if (!currentPrice) return;

    position.currentPrice = currentPrice;
    const changePct = ((currentPrice - entryPriceBnb) / entryPriceBnb) * 100;

    // ── STOP LOSS CHECK ───────────────────────
    if (changePct <= this.strategy.stopLoss && !position.slHit) {
      console.log(`\n  🔴 STOP LOSS HIT: ${token.symbol} | Change: ${changePct.toFixed(2)}%`);
      position.slHit = true;
      const txHash = await this.executor.sellTokenForBnb(token, remainingTokens);
      if (txHash) {
        position.remainingTokens = 0;
        if (this.notifier) await this.notifier.sendExit(token.symbol, "STOP LOSS", changePct, txHash);
        if (this.logger) this.logger.logExit(token.symbol, "STOP_LOSS", changePct, txHash);
        this.monitor.closePosition(token.symbol);
      }
      return;
    }

    // ── TAKE PROFIT CHECKS ───────────────────
    for (let i = 0; i < this.strategy.takeProfits.length; i++) {
      const tp = this.strategy.takeProfits[i];

      // Skip already hit TPs
      if (tpHit.includes(i)) continue;

      if (changePct >= tp.targetPercent) {
        console.log(
          `\n  🟢 TP${i+1} HIT: ${token.symbol} | ` +
          `+${changePct.toFixed(2)}% | Selling ${tp.sellPercent}% of position`
        );

        // Calculate how many tokens to sell
        const totalOriginal = position.totalTokens;
        const sellAmount    = parseFloat(
          (totalOriginal * tp.sellPercent / 100).toFixed(8)
        );

        if (sellAmount <= 0 || sellAmount > position.remainingTokens) {
          console.log(`  ⚠️  Sell amount invalid: ${sellAmount}`);
          continue;
        }

        const txHash = await this.executor.sellTokenForBnb(token, sellAmount);
        if (txHash) {
          tpHit.push(i);
          position.remainingTokens = parseFloat(
            (position.remainingTokens - sellAmount).toFixed(8)
          );

          console.log(
            `  ✅ TP${i+1} executed | Sold: ${sellAmount} ${token.symbol} | ` +
            `Remaining: ${position.remainingTokens}`
          );

          if (this.notifier) {
            await this.notifier.sendTp(
              token.symbol, i + 1, tp.targetPercent,
              tp.sellPercent, changePct, txHash
            );
          }
          if (this.logger) {
            this.logger.logExit(
              token.symbol, `TP${i+1}`, changePct, txHash, tp.sellPercent
            );
          }

          // If all TPs hit (remaining ≈ 0), close position
          if (position.remainingTokens < 0.000001 || tpHit.length === this.strategy.takeProfits.length) {
            console.log(`  🏁 Position fully closed: ${token.symbol}`);
            this.monitor.closePosition(token.symbol);
          }
        }
        // Only execute one TP per cycle to avoid race conditions
        break;
      }
    }
  }

  // ────────────────────────────────────────────
  async wm_getBalance(token) {
    try {
      return await this.executor.wm.getTokenBalance(token.contract);
    } catch (_) {
      return null;
    }
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = StrategyEngine;
