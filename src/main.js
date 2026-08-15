// ============================================================
//  HALAL BSC TRADING BOT — MAIN ENTRY POINT
//  No AI. Pure strategy: bankroll %, SL, multi-TP levels.
//  You control the token list in config/tokens.js
//  You pick the strategy in config/settings.js
// ============================================================

require("dotenv").config();

const WalletManager     = require("./wallet/manager");
const PancakeSwapExecutor = require("./executor/pancakeswap");
const StrategyEngine    = require("./strategy/engine");
const PositionMonitor   = require("./monitor/positions");
const TelegramNotifier  = require("./notifications/telegram");
const Logger            = require("./logs/logger");
const MarketData        = require("./market/price");
const HALAL_TOKENS      = require("../config/tokens");
const SETTINGS          = require("../config/settings");
const { validateStrategy } = require("../config/strategies");

// ────────────────────────────────────────────────────────────
const BANNER = `
╔══════════════════════════════════════════════════════════╗
║          HALAL BSC TRADING BOT — v1.0                   ║
║          Spot Only | BEP20 | PancakeSwap V2             ║
║          No AI | No Leverage | No Interest              ║
╚══════════════════════════════════════════════════════════╝`;

// ────────────────────────────────────────────────────────────
async function main() {
  console.log(BANNER);

  // Validate strategy before anything
  try {
    validateStrategy(SETTINGS.activeStrategy);
  } catch (e) {
    console.error(`❌ Strategy config error: ${e.message}`);
    process.exit(1);
  }

  // ── Init all modules ─────────────────────────────────────
  const logger    = new Logger();
  const notifier  = new TelegramNotifier();
  const wallet    = new WalletManager();
  const market    = new MarketData();
  const monitor   = new PositionMonitor();

  await wallet.connect();
  await wallet.loadWallet();

  const executor  = new PancakeSwapExecutor(wallet);
  // Give strategy engine access to wallet for balance checks
  executor.wm     = wallet;

  const strategy  = new StrategyEngine(executor, monitor, notifier, logger);

  // Show starting portfolio
  const enabledTokens = HALAL_TOKENS.filter(t => t.enabled);
  await wallet.displayPortfolio(enabledTokens);
  logger.logInfo(`Bot started | Strategy: ${SETTINGS.activeStrategy} | Tokens: ${enabledTokens.map(t=>t.symbol).join(", ")}`);
  await notifier.sendInfo(
    `🤖 Bot started\nStrategy: ${SETTINGS.activeStrategy}\nTokens: ${enabledTokens.map(t=>t.symbol).join(", ")}`
  );

  console.log(`\n  ✅ Bot running. Scanning ${enabledTokens.length} tokens every ${SETTINGS.scanIntervalMs/60000} minutes.`);
  console.log(`  ✅ Price check every ${SETTINGS.priceCheckMs/1000}s for open positions.\n`);

  // ── Main loop ────────────────────────────────────────────
  let scanCount = 0;

  // Price monitor — runs every N seconds for open positions
  const priceLoop = setInterval(async () => {
    const openPositions = monitor.getAllPositions();
    if (openPositions.length === 0) return;

    for (const pos of openPositions) {
      try {
        await strategy.checkAndExecuteExits(pos);
      } catch (e) {
        logger.logError(`Price check error for ${pos.token.symbol}`, e);
      }
    }
  }, SETTINGS.priceCheckMs);

  // Scanner loop — runs every scanIntervalMs
  const runScan = async () => {
    scanCount++;
    const bnb = await wallet.getBnbBalance();
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  🔍 SCAN #${scanCount} | ${new Date().toLocaleString()} | BNB: ${bnb.toFixed(4)}`);
    console.log(`  📊 Open positions: ${monitor.getOpenCount()}/${SETTINGS.maxOpenTrades}`);
    monitor.displayAll();

    for (const token of enabledTokens) {
      try {
        // Skip if already holding this token
        if (SETTINGS.skipIfPositionOpen && monitor.isOpen(token.symbol)) {
          logger.logSkip(token.symbol, "Position already open");
          continue;
        }

        // Skip if max trades reached
        if (monitor.getOpenCount() >= SETTINGS.maxOpenTrades) {
          logger.logSkip(token.symbol, `Max trades reached (${SETTINGS.maxOpenTrades})`);
          continue;
        }

        // Get market data
        console.log(`\n  📡 Checking ${token.symbol}...`);
        const info = await market.getTokenInfo(token.contract);
        if (!info) {
          logger.logSkip(token.symbol, "No market data");
          continue;
        }

        console.log(
          `     Price: $${info.priceUsd.toFixed(6)} | ` +
          `Vol 24h: $${info.volume24h.toLocaleString()} | ` +
          `Liq: $${info.liquidityUsd.toLocaleString()}`
        );

        // Skip low liquidity
        if (info.liquidityUsd < SETTINGS.minLiquidityUsd) {
          logger.logSkip(token.symbol, `Low liquidity ($${info.liquidityUsd.toFixed(0)})`);
          continue;
        }

        // Calculate trade size
        const tradeAmountBnb = await wallet.getTradeAmountBnb();
        if (tradeAmountBnb < 0.001) {
          logger.logSkip(token.symbol, "Trade size too small (<0.001 BNB)");
          continue;
        }

        console.log(
          `     ✅ Token passes checks | ` +
          `Trade size: ${tradeAmountBnb} BNB (${SETTINGS.bankrollPercent}% of balance)`
        );

        // Open position
        await strategy.openPosition(token, tradeAmountBnb);

        // Small delay between tokens
        await new Promise(r => setTimeout(r, 2000));

      } catch (e) {
        logger.logError(`Scan error for ${token.symbol}`, e);
        await notifier.sendError(`Scan error: ${token.symbol} — ${e.message}`);
      }
    }

    console.log(`\n  ✅ Scan #${scanCount} complete. Next scan in ${SETTINGS.scanIntervalMs/60000} minutes.`);
  };

  // Run first scan immediately, then on interval
  await runScan();
  const scanLoop = setInterval(runScan, SETTINGS.scanIntervalMs);

  // ── Graceful shutdown ────────────────────────────────────
  process.on("SIGINT", async () => {
    console.log("\n\n  ⛔ SIGINT received — shutting down...");
    clearInterval(priceLoop);
    clearInterval(scanLoop);
    logger.logInfo("Bot stopped by user (SIGINT)");
    await notifier.sendInfo("🛑 Bot stopped by user.");
    const bnb = await wallet.getBnbBalance();
    console.log(`  Final BNB balance: ${bnb.toFixed(6)} BNB`);
    console.log(`  Open positions   : ${monitor.getOpenCount()}`);
    if (monitor.getOpenCount() > 0) {
      console.log("  ⚠️  You have open positions! Check them manually.");
      monitor.displayAll();
    }
    process.exit(0);
  });
}

main().catch(async (e) => {
  console.error("❌ Fatal error:", e.message);
  process.exit(1);
});
