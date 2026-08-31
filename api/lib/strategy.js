// ============================================================
//  STRATEGY ENGINE — per profile
//  Reads each profile's live settings, opens positions, and
//  evaluates exits on every BSC block via lib/livefeed.js.
//
//  Exit safety:
//   · one in-process lock per profile+symbol prevents duplicate
//     transactions when live feed, watchdog, UI and cron overlap
//   · every TP crossed by one price jump is combined into ONE
//     sell (e.g. +220% can execute TP1+TP2+TP3 immediately)
//   · exit decisions use the executable quote for the remaining
//     position, not a stale DexScreener chart value
// ============================================================

const { getStrategyByKey, resolvePositionStrategy } = require("./strategies");
const {
  buyToken, sellToken, getCurrentPriceBnb, getExecutableSellPriceBnb,
} = require("./dex");
const { getSignerWallet, getBnbBalance, getTokenBalance, getProvider } = require("./wallet");
const { getTokenInfo } = require("./market");
const {
  getPosition, setPosition, deletePosition,
  appendTradeLog, getSettings, updateStats, getStats,
} = require("./redis");
const telegram = require("./telegram");

const positionLocks = new Set();
const profileTransactionQueues = new Map();
const LIVE_PRICE_PERSIST_MS = Math.max(1000, parseInt(process.env.LIVE_PRICE_PERSIST_SECONDS || "3", 10) * 1000 || 3000);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function lockKey(profileId, symbol) { return `${profileId}:${String(symbol).toUpperCase()}`; }
function isPositionLocked(profileId, symbol) { return positionLocks.has(lockKey(profileId, symbol)); }

async function withPositionLock(profileId, symbol, fn, { busyValue, busyError } = {}) {
  const key = lockKey(profileId, symbol);
  if (positionLocks.has(key)) {
    if (busyError) throw new Error(busyError);
    return busyValue;
  }
  positionLocks.add(key);
  try { return await fn(); }
  finally { positionLocks.delete(key); }
}

// Serialize signed transactions per profile. Different token exits can be
// reached in the same block, but one wallet must not submit two independently
// resolved nonces at once. Each caller waits for the previous one to finish.
async function withProfileTransactionQueue(profileId, fn) {
  const previous = profileTransactionQueues.get(profileId) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  profileTransactionQueues.set(profileId, gate);
  await previous.catch(() => {});
  try { return await fn(); }
  finally {
    release();
    if (profileTransactionQueues.get(profileId) === gate) profileTransactionQueues.delete(profileId);
  }
}

// ── Open position ────────────────────────────────────────────
async function openPosition(profileId, token) {
  const settings = await getSettings(profileId);
  const strategy = await getStrategyByKey(profileId, settings.activeStrategy);

  // A wallet must be connected even in simulation, so the profile knows
  // which account it is preparing to trade from.
  const signer = await getSignerWallet(profileId);

  let bnbBalance, tradeAmount, result, entryPriceBnb, tokenBalance;

  if (!settings.autoTrade) {
    // ── SIMULATION — no chain calls ───────────────────────────
    bnbBalance  = 10;
    tradeAmount = parseFloat(((bnbBalance * settings.bankrollPercent) / 100).toFixed(6));
    const info  = await getTokenInfo(token.contract);
    entryPriceBnb = info?.priceNative || 0.0001;
    tokenBalance  = tradeAmount / entryPriceBnb;
    result = { hash: "SIMULATED_" + Date.now(), simulated: true };
  } else {
    // ── LIVE — real chain calls ───────────────────────────────
    bnbBalance  = await getBnbBalance(profileId);
    tradeAmount = parseFloat(((bnbBalance * settings.bankrollPercent) / 100).toFixed(6));

    if (tradeAmount < 0.0001) throw new Error("Trade size too small (<0.0001 BNB) — increase bankroll% or add funds");
    if (bnbBalance - tradeAmount < settings.minBnbReserve) {
      throw new Error("Insufficient BNB (would breach gas reserve)");
    }

    // Measure only the tokens received by THIS buy. Using the wallet's whole
    // token balance would accidentally include coins held before the bot trade.
    const balanceBefore = await getTokenBalance(profileId, token.contract).catch(() => 0);
    result = await withProfileTransactionQueue(profileId, () =>
      buyToken(signer, token.contract, tradeAmount, settings.maxSlippagePercent)
    );
    await sleep(3000);
    const balanceAfter = await getTokenBalance(profileId, token.contract);
    tokenBalance = balanceAfter - balanceBefore;
    if (!isFinite(tokenBalance) || tokenBalance <= 0) {
      throw new Error("Buy confirmed but no newly received token balance could be measured");
    }
    // True cost basis: BNB spent ÷ actual tokens received (includes transfer tax
    // and price impact), which is safer than a one-token spot quote after buying.
    entryPriceBnb = tradeAmount / tokenBalance;
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
    buySlippageUsed: result.slippageUsed || settings.maxSlippagePercent,
    buyDex:          result.dex || null,
    currentPrice:    entryPriceBnb,
    lastPriceAt:     new Date().toISOString(),
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

// ── Check and execute SL / all crossed TPs ───────────────────
async function checkAndExecuteExits(profileId, symbol, options = {}) {
  return withPositionLock(profileId, symbol, async () => {
    const position = options.position || await getPosition(profileId, symbol);
    if (!position || position.remainingTokens <= 0) return null;

    const settings = options.settings || await getSettings(profileId);
    const strategy = await resolvePositionStrategy(profileId, position, settings);
    const provider = options.provider || getProvider();

    // Quote the exact remaining amount across supported DEXes. This is the
    // executable average price after pool price impact, which is what matters
    // to an actual TP/SL sale. Fall back to spot price for legacy test mocks.
    let currentPrice = null;
    if (typeof getExecutableSellPriceBnb === "function") {
      currentPrice = await getExecutableSellPriceBnb(provider, position.contract, position.remainingTokens).catch(() => null);
    }
    if (!currentPrice) currentPrice = await getCurrentPriceBnb(provider, position.contract);
    if (!currentPrice) return null;

    const changePct = ((currentPrice - position.entryPriceBnb) / position.entryPriceBnb) * 100;
    // If the buy required extra slippage for a transfer-tax token, start exits
    // at least that high so a normal TP is not guaranteed to revert.
    const exitSlippage = Math.max(
      Number(settings.maxSlippagePercent) || 1,
      Number(position.buySlippageUsed) || 0
    );

    // ── STOP LOSS — remaining position exits at once ─────────
    if (changePct <= strategy.stopLoss && !position.slHit) {
      const signer = await getSignerWallet(profileId);
      const result = settings.autoTrade
        ? await withProfileTransactionQueue(profileId, () =>
            sellToken(signer, position.contract, position.remainingTokens, exitSlippage, { emergency: true })
          )
        : { hash: "SIMULATED_" + Date.now(), simulated: true };

      await deletePosition(profileId, symbol);
      await appendTradeLog(profileId, {
        type: "STOP_LOSS", symbol, changePct, tx: result.hash,
        dex: result.dex, source: options.source || "manual-check",
        simulated: result.simulated || false,
      });

      const stats = await getStats(profileId);
      await updateStats(profileId, { losses: (stats.losses || 0) + 1 });
      await telegram.sendSL(symbol, changePct, result.hash);
      return { action: "STOP_LOSS", symbol, changePct, tx: result.hash, source: options.source };
    }

    // ── TAKE PROFITS — catch EVERY level crossed by this jump ─
    const crossed = [];
    for (let i = 0; i < strategy.takeProfits.length; i++) {
      if (position.tpHit.includes(i)) continue;
      if (changePct >= strategy.takeProfits[i].targetPercent) {
        crossed.push({ index: i, ...strategy.takeProfits[i] });
      }
    }

    if (crossed.length > 0) {
      const totalSellPct = crossed.reduce((sum, tp) => sum + tp.sellPercent, 0);
      const calculated   = position.totalTokens * totalSellPct / 100;
      const sellAmount   = parseFloat(Math.min(position.remainingTokens, calculated).toFixed(8));

      if (sellAmount > 0) {
        const signer = await getSignerWallet(profileId);
        const result = settings.autoTrade
          ? await withProfileTransactionQueue(profileId, () =>
              sellToken(signer, position.contract, sellAmount, exitSlippage)
            )
          : { hash: "SIMULATED_" + Date.now(), simulated: true };

        for (const tp of crossed) position.tpHit.push(tp.index);
        position.tpHit.sort((a, b) => a - b);
        position.remainingTokens = parseFloat(Math.max(0, position.remainingTokens - sellAmount).toFixed(8));
        position.currentPrice = currentPrice;
        position.lastPriceAt  = new Date().toISOString();

        const allDone = position.tpHit.length >= strategy.takeProfits.length
          || position.remainingTokens < 0.000001;
        if (allDone) {
          await deletePosition(profileId, symbol);
          const stats = await getStats(profileId);
          await updateStats(profileId, { wins: (stats.wins || 0) + 1 });
        } else {
          await setPosition(profileId, symbol, position);
        }

        const labels = crossed.map(tp => `TP${tp.index + 1}`);
        const action = labels.length === 1 ? labels[0] : labels.join("+");
        await appendTradeLog(profileId, {
          type: action, symbol, changePct, sellPct: totalSellPct,
          tpLevels: crossed.map(tp => tp.index + 1), tx: result.hash,
          dex: result.dex, source: options.source || "manual-check",
          simulated: result.simulated || false,
        });
        await telegram.sendTpBundle(symbol, crossed, totalSellPct, changePct, result.hash);
        return {
          action, symbol, changePct, sellPct: totalSellPct,
          tpLevels: crossed.map(tp => tp.index + 1), tx: result.hash,
          source: options.source,
        };
      }
    }

    // No exit. Live checks can happen on every fast BSC block, so persist the
    // dashboard snapshot at most once every few seconds to protect Redis quotas.
    const previousPersist = position.lastPriceAt ? new Date(position.lastPriceAt).getTime() : 0;
    const shouldPersist = options.source !== "live" || Date.now() - previousPersist >= LIVE_PRICE_PERSIST_MS;
    if (shouldPersist) {
      position.currentPrice = currentPrice;
      position.lastPriceAt  = new Date().toISOString();
      if (options.blockNumber != null) position.lastPriceBlock = options.blockNumber;
      await setPosition(profileId, symbol, position);
    }
    return { action: "HOLD", symbol, changePct, currentPrice, source: options.source };
  }, {
    busyValue: { action: "BUSY", symbol, changePct: null, source: options.source },
  });
}

// ── Manual full close ────────────────────────────────────────
async function closePositionManual(profileId, symbol) {
  return withPositionLock(profileId, symbol, async () => {
    const position = await getPosition(profileId, symbol);
    if (!position) throw new Error(`No open position for ${symbol}`);

    const settings = await getSettings(profileId);
    let currentPrice = null;
    if (typeof getExecutableSellPriceBnb === "function") {
      currentPrice = await getExecutableSellPriceBnb(getProvider(), position.contract, position.remainingTokens).catch(() => null);
    }
    if (!currentPrice) currentPrice = await getCurrentPriceBnb(getProvider(), position.contract);
    const changePct = currentPrice
      ? ((currentPrice - position.entryPriceBnb) / position.entryPriceBnb) * 100
      : 0;

    const signer = await getSignerWallet(profileId);
    const result = settings.autoTrade
      ? await withProfileTransactionQueue(profileId, () =>
          sellToken(signer, position.contract, position.remainingTokens, settings.maxSlippagePercent)
        )
      : { hash: "SIMULATED_" + Date.now(), simulated: true };
    await deletePosition(profileId, symbol);
    await appendTradeLog(profileId, {
      type: "MANUAL_CLOSE", symbol, changePct, tx: result.hash,
      dex: result.dex, simulated: result.simulated || false,
    });

    const stats = await getStats(profileId);
    await updateStats(profileId, changePct >= 0
      ? { wins: (stats.wins || 0) + 1 }
      : { losses: (stats.losses || 0) + 1 });
    await telegram.sendInfo(`🖐️ Manual close — ${symbol} | P&L: ${changePct.toFixed(2)}%`);
    return { symbol, changePct, tx: result.hash };
  }, {
    busyError: `${symbol} already has an exit transaction in progress — wait for confirmation`,
  });
}

module.exports = {
  openPosition,
  checkAndExecuteExits,
  closePositionManual,
  isPositionLocked,
};
