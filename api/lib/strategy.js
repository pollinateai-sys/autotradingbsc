// ============================================================
//  STRATEGY ENGINE — per profile
//  Reads that profile's live settings from Redis. Opens/closes
//  positions using that profile's own decrypted wallet.
// ============================================================

const { getStrategy }     = require("../config/strategies");
const { buyTokenWithBnb, sellTokenForBnb, getCurrentPriceBnb } = require("./pancakeswap");
const { getSignerWallet, getBnbBalance, getTokenBalance, getProvider } = require("./wallet");
const { getTokenInfo }    = require("./market");
const {
  getPosition, setPosition, deletePosition,
  appendTradeLog, getSettings, updateStats, getStats,
} = require("./redis");
const telegram = require("./telegram");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ────────────────────────────────────────────────────────────
async function openPosition(profileId, token) {
  const settings  = await getSettings(profileId);
  const strategy  = getStrategy(settings.activeStrategy);

  // In simulation mode we never touch the chain — no RPC calls, no signing.
  // We still need a signer wallet to confirm one is connected (so the person
  // knows what they're simulating for), but we don't actually use it.
  const signer = await getSignerWallet(profileId); // throws if no wallet connected

  let bnbBalance, tradeAmount, result, entryPriceBnb, tokenBalance;

  if (!settings.autoTrade) {
    // ── SIMULATION — no chain calls ───────────────────────────
    bnbBalance  = 10; // placeholder — we can't read it without RPC
    tradeAmount = parseFloat(((bnbBalance * settings.bankrollPercent) / 100).toFixed(6));

    // Get entry price from DexScreener (HTTP only, no chain needed)
    const info = await getTokenInfo(token.contract);
    entryPriceBnb = info?.priceNative || 0.0001;
    tokenBalance  = tradeAmount / entryPriceBnb;
    result        = { hash: "SIMULATED_" + Date.now(), simulated: true };
  } else {
    // ── LIVE — real chain calls ────────────────────────────────
    bnbBalance  = await getBnbBalance(profileId);
    tradeAmount = parseFloat(((bnbBalance * settings.bankrollPercent) / 100).toFixed(6));

    if (tradeAmount < 0.001) throw new Error("Trade size too small (<0.001 BNB) — increase bankroll% or add funds");
    if (bnbBalance - tradeAmount < settings.minBnbReserve) {
      throw new Error("Insufficient BNB (would breach gas reserve)");
    }

    result = await buyTokenWithBnb(signer, token.contract, tradeAmount, settings.maxSlippagePercent, true);
    await sleep(3000);

    entryPriceBnb = await getCurrentPriceBnb(getProvider(), token.contract);
    if (!entryPriceBnb) throw new Error("Could not read entry price after buy");
    tokenBalance = await getTokenBalance(profileId, token.contract);
  }

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

  await setPosition(profileId, token.symbol, position);
  await appendTradeLog(profileId, {
    type: "BUY", symbol: token.symbol, bnb: tradeAmount,
    price: entryPriceBnb, tx: result.hash, strategy: settings.activeStrategy,
    simulated: result.simulated || false,
  });

  const stats = await getStats(profileId);
  await updateStats(profileId, { totalTrades: (stats.totalTrades || 0) + 1 });

  await telegram.sendBuy(token.symbol, tradeAmount, entryPriceBnb, strategy);
  return position;
}

// ────────────────────────────────────────────────────────────
async function checkAndExecuteExits(profileId, symbol) {
  const position = await getPosition(profileId, symbol);
  if (!position || position.remainingTokens <= 0) return null;

  const settings     = await getSettings(profileId);
  const strategy     = getStrategy(position.strategyKey || settings.activeStrategy);
  const currentPrice = await getCurrentPriceBnb(getProvider(), position.contract);
  if (!currentPrice) return null;

  const changePct = ((currentPrice - position.entryPriceBnb) / position.entryPriceBnb) * 100;

  // ── STOP LOSS ──────────────────────────────────────────
  if (changePct <= strategy.stopLoss && !position.slHit) {
    const signer = await getSignerWallet(profileId);
    const result = await sellTokenForBnb(signer, position.contract, position.remainingTokens, settings.autoTrade);
    await deletePosition(profileId, symbol);
    await appendTradeLog(profileId, { type: "STOP_LOSS", symbol, changePct, tx: result.hash, simulated: result.simulated || false });

    const stats = await getStats(profileId);
    await updateStats(profileId, { losses: (stats.losses || 0) + 1 });
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

      const signer = await getSignerWallet(profileId);
      const result = await sellTokenForBnb(signer, position.contract, sellAmount, settings.autoTrade);
      position.tpHit.push(i);
      position.remainingTokens = parseFloat((position.remainingTokens - sellAmount).toFixed(8));
      position.currentPrice    = currentPrice;

      const allDone = position.tpHit.length === strategy.takeProfits.length
        || position.remainingTokens < 0.000001;

      if (allDone) {
        await deletePosition(profileId, symbol);
        const stats = await getStats(profileId);
        await updateStats(profileId, { wins: (stats.wins || 0) + 1 });
      } else {
        await setPosition(profileId, symbol, position);
      }

      await appendTradeLog(profileId, {
        type: `TP${i+1}`, symbol, changePct, sellPct: tp.sellPercent,
        tx: result.hash, simulated: result.simulated || false,
      });
      await telegram.sendTp(symbol, i+1, tp.targetPercent, tp.sellPercent, changePct, result.hash);
      return { action: `TP${i+1}`, symbol, changePct, sellPct: tp.sellPercent, tx: result.hash };
    }
  }

  // No action — just update live price snapshot
  position.currentPrice = currentPrice;
  await setPosition(profileId, symbol, position);
  return { action: "HOLD", symbol, changePct, currentPrice };
}

// ────────────────────────────────────────────────────────────
// Manual full close — used by the "Close Position" button in UI
async function closePositionManual(profileId, symbol) {
  const position = await getPosition(profileId, symbol);
  if (!position) throw new Error(`No open position for ${symbol}`);

  const settings      = await getSettings(profileId);
  const currentPrice  = await getCurrentPriceBnb(getProvider(), position.contract);
  const changePct     = currentPrice
    ? ((currentPrice - position.entryPriceBnb) / position.entryPriceBnb) * 100
    : 0;

  const signer = await getSignerWallet(profileId);
  const result = await sellTokenForBnb(signer, position.contract, position.remainingTokens, settings.autoTrade);
  await deletePosition(profileId, symbol);
  await appendTradeLog(profileId, {
    type: "MANUAL_CLOSE", symbol, changePct, tx: result.hash, simulated: result.simulated || false,
  });

  const stats = await getStats(profileId);
  await updateStats(profileId, changePct >= 0 ? { wins: (stats.wins || 0) + 1 } : { losses: (stats.losses || 0) + 1 });
  await telegram.sendInfo(`🖐️ Manual close — ${symbol} | P&L: ${changePct.toFixed(2)}%`);

  return { symbol, changePct, tx: result.hash };
}

module.exports = { openPosition, checkAndExecuteExits, closePositionManual };
