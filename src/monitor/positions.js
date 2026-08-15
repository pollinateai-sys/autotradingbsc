// ============================================================
//  POSITION MONITOR
//  Tracks all open positions, prices, and status.
// ============================================================

class PositionMonitor {
  constructor() {
    this.positions = new Map(); // symbol → position object
  }

  addPosition(positionData) {
    const { token } = positionData;
    this.positions.set(token.symbol, positionData);
    console.log(`\n  📌 POSITION REGISTERED: ${token.symbol}`);
    console.log(`     Entry Price : ${positionData.entryPriceBnb.toFixed(8)} BNB`);
    console.log(`     Total Tokens: ${positionData.totalTokens.toFixed(6)}`);
    console.log(`     BNB Spent   : ${positionData.bnbSpent} BNB`);
    console.log(`     Strategy    : ${positionData.strategy.name}`);
    console.log(`     Stop Loss   : ${positionData.strategy.stopLoss}%`);
    positionData.strategy.takeProfits.forEach((tp, i) => {
      console.log(`     TP${i+1}         : +${tp.targetPercent}% (sell ${tp.sellPercent}%)`);
    });
  }

  closePosition(symbol) {
    if (this.positions.has(symbol)) {
      this.positions.delete(symbol);
      console.log(`  🏁 Position removed from monitor: ${symbol}`);
    }
  }

  isOpen(symbol)     { return this.positions.has(symbol); }
  getPosition(symbol){ return this.positions.get(symbol); }
  getOpenCount()     { return this.positions.size; }
  getAllPositions()   { return Array.from(this.positions.values()); }

  displayAll() {
    if (this.positions.size === 0) {
      console.log("  📭 No open positions.");
      return;
    }
    console.log("\n  📊 OPEN POSITIONS:");
    console.log("  " + "─".repeat(65));
    for (const [sym, pos] of this.positions) {
      const changePct = pos.currentPrice
        ? ((pos.currentPrice - pos.entryPriceBnb) / pos.entryPriceBnb * 100).toFixed(2)
        : "?";
      const icon    = parseFloat(changePct) >= 0 ? "🟢" : "🔴";
      const held    = ((Date.now() - pos.openTime) / 3600000).toFixed(1);
      const tpsDone = pos.tpHit.length;
      const tpsTotal= pos.strategy.takeProfits.length;
      console.log(
        `  ${icon} ${sym.padEnd(6)} | Entry: ${pos.entryPriceBnb.toFixed(6)} BNB | ` +
        `P&L: ${changePct}% | TPs: ${tpsDone}/${tpsTotal} | Held: ${held}h`
      );
      console.log(
        `         Remaining: ${(pos.remainingTokens || 0).toFixed(6)} tokens | ` +
        `SL: ${pos.strategy.stopLoss}%`
      );
    }
    console.log("  " + "─".repeat(65));
  }
}

module.exports = PositionMonitor;
