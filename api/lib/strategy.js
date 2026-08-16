// ============================================================
//  STRATEGY ENGINE
//  Reads live settings from Redis (dashboard-editable).
//  Opens/closes positions, tracks multi-TP progress.
// ============================================================

const { getStrategy }     = require("../config/strategies");
const { buyTokenWithBnb, sellTokenForBnb, getCurrentPriceBnb } = require("./pancakeswap");
const { getBnbBalance, getTokenBalance } = require("./wallet");
const {
  getPosition, setPosition, deletePosition,
  appendTradeLog, getSettings, updateStats, getStats,
} = require("./redis");
const telegram = require("./telegram");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────────────────────────────────────────
async function openPosition(token) {
  const settings  = await getSettings();
  const strategy  = getStrategy(settings.activeStrategy);

  const bnbBalance  = await getBnbBalance();
  const tradeAmount = parseFloat(((bnbBalance * settings.bankrollPercent) / 100).toFixed(6));

  if (tradeAmount < 0.001) throw new Error("Trade size too small (<0.001 BNB) — increase bankroll% or add funds");
  if (bnbBalance - tradeAmount < settings.minBnbReserve) {
    throw new Error("Insufficient BNB (would breach gas reserve)");
  }

  const result = await buyTokenWithBnb(token.contract, tradeAmount, settings.maxSlippagePercent, settings.autoTrade);
  await sleep(3000);

  const entryPriceBnb = await getCurrentPriceBnb(token.contract);
  const tokenBalance  = settings.autoTrade ? await getTokenBalance(token.contract) : tradeAmount / (entryPriceBnb || 1);

  if (!entryPriceBnb) throw new Error("Could not read entry price after buy");

  const position = {
    symbol:          token.symbol,
    contract:        token.contract,
    entryPriceBnb,
    totalTokens:     tokenBalance,
    remainingTokens: tokenBalance,
    bnbSpent:        tradeAmount,
    buyTxHash:       result.hash,
    strategyKey:     settings.activeStrategy,
    tpHit:           [],
    slHit:           false,
    openTime:        Date.now(),
    simulated:       result.simulated || false,
  };

  await setPosition(token.symbol, position);
  await appendTradeLog({
    type: "BUY", symbol: token.symbol, bnb: tradeAmount,
    price: entryPriceBnb, tx: result.hash, strategy: settings.activeStrategy,
    simulated: result.simulated || false,
  });

  const stats = await getStats();
  await updateStats({ totalTrades: (stats.totalTrades || 0) + 1 });

  await telegram.sendBuy(token.symbol, tradeAmount, entryPriceBnb, strategy);
  return position;
}

// ────────────────────────────────────────────────────────────
async function checkAndExecuteExits(symbol) {
  const position = await getPosition(symbol);
  if (!position || position.remainingTokens <= 0) return null;

  const settings      = await getSettings();
  const strategy      = getStrategy(position.strategyKey || settings.activeStrategy);
  const currentPrice  = await getCurrentPriceBnb(position.contract);
  if (!currentPrice) return null;

  const changePct = ((currentPrice - position.entryPriceBnb) / position.entryPriceBnb) * 100;

  // ── STOP LOSS ──────────────────────────────────────────
  if (changePct <= strategy.stopLoss && !position.slHit) {
    const result = await sellTokenForBnb(position.contract, position.remainingTokens, settings.autoTrade);
    await deletePosition(symbol);
    await appendTradeLog({ type: "STOP_LOSS", symbol, changePct, tx: result.hash, simulated: result.simulated || false });

    const stats = await getStats();
    await updateStats({ losses: (stats.losses || 0) + 1 });
    await telegram.sendSL(symbol, changePct, result.hash);
    return { action: "STOP_LOSS", symbol, changePct, tx: result.hash };
  }

  // ── TAKE PROFITS ───────────────────────────────────────
  for (let i = 0; i < strategy.takeProfits.length; i++) {
    const tp = strategy.takeProfits[i];
    if (position.tpHit.includes(i)) continue;
    if (changePct >= tp.targetPercent) {
      const sellAmount = parseFloat((position.totalTokens * tp.sellPercent / 100).toFixed(8));
      if (sellAmount <= 0 || sellAmount > position.remainingTokens) continue;

      const result = await sellTokenForBnb(position.contract, sellAmount, settings.autoTrade);
      position.tpHit.push(i);
      position.remainingTokens = parseFloat((position.remainingTokens - sellAmount).toFixed(8));
      position.currentPrice    = currentPrice;

      const allDone = position.tpHit.length === strategy.takeProfits.length
        || position.remainingTokens < 0.000001;

      if (allDone) {
        await deletePosition(symbol);
        const stats = await getStats();
        await updateStats({ wins: (stats.wins || 0) + 1 });
      } else {
        await setPosition(symbol, position);
      }

      await appendTradeLog({
        type: `TP${i+1}`, symbol, changePct, sellPct: tp.sellPercent,
        tx: result.hash, simulated: result.simulated || false,
      });
      await telegram.sendTp(symbol, i+1, tp.targetPercent, tp.sellPercent, changePct, result.hash);
      return { action: `TP${i+1}`, symbol, changePct, sellPct: tp.sellPercent, tx: result.hash };
    }
  }

  // No action — just update live price snapshot
  position.currentPrice = currentPrice;
  await setPosition(symbol, position);
  return { action: "HOLD", symbol, changePct, currentPrice };
}

// ────────────────────────────────────────────────────────────
// Manual full close — used by the "Close Position" button in UI
async function closePositionManual(symbol) {
  const position = await getPosition(symbol);
  if (!position) throw new Error(`No open position for ${symbol}`);

  const settings     = await getSettings();
  const currentPrice = await getCurrentPriceBnb(position.contract);
  const changePct     = currentPrice
    ? ((currentPrice - position.entryPriceBnb) / position.entryPriceBnb) * 100
    : 0;

  const result = await sellTokenForBnb(position.contract, position.remainingTokens, settings.autoTrade);
  await deletePosition(symbol);
  await appendTradeLog({
    type: "MANUAL_CLOSE", symbol, changePct, tx: result.hash, simulated: result.simulated || false,
  });

  const stats = await getStats();
  await updateStats(changePct >= 0 ? { wins: (stats.wins || 0) + 1 } : { losses: (stats.losses || 0) + 1 });
  await telegram.sendInfo(`🖐️ Manual close — ${symbol} | P&L: ${changePct.toFixed(2)}%`);

  return { symbol, changePct, tx: result.hash };
}

module.exports = { openPosition, checkAndExecuteExits, closePositionManual };
