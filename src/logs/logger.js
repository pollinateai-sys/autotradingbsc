// ============================================================
//  AUDIT LOGGER
//  Logs every trade decision and execution to file + console.
// ============================================================

const fs   = require("fs");
const path = require("path");

const LOG_DIR  = path.join(__dirname, "../../logs");
const LOG_FILE = path.join(LOG_DIR, "trades.log");
const ERR_FILE = path.join(LOG_DIR, "errors.log");

class Logger {
  constructor() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    this._write(LOG_FILE, `\n${"=".repeat(60)}\nBOT STARTED: ${new Date().toISOString()}\n${"=".repeat(60)}\n`);
  }

  _ts() { return new Date().toISOString(); }

  _write(file, line) {
    fs.appendFileSync(file, line + "\n");
  }

  logTrade(type, symbol, bnbAmount, price, txHash) {
    const line = `[${this._ts()}] ${type.padEnd(4)} | ${symbol.padEnd(6)} | BNB: ${bnbAmount} | Price: ${price} | TX: ${txHash}`;
    console.log(`  📝 ${line}`);
    this._write(LOG_FILE, line);
  }

  logExit(symbol, reason, changePct, txHash, sellPct = 100) {
    const icon = changePct >= 0 ? "✅" : "❌";
    const line = `[${this._ts()}] EXIT | ${symbol.padEnd(6)} | ${reason.padEnd(10)} | P&L: ${changePct.toFixed(2)}% | Sold: ${sellPct}% | TX: ${txHash}`;
    console.log(`  ${icon} ${line}`);
    this._write(LOG_FILE, line);
  }

  logSkip(symbol, reason) {
    const line = `[${this._ts()}] SKIP | ${symbol.padEnd(6)} | ${reason}`;
    console.log(`  ⏭️  ${line}`);
    this._write(LOG_FILE, line);
  }

  logInfo(message) {
    const line = `[${this._ts()}] INFO | ${message}`;
    console.log(`  ℹ️  ${line}`);
    this._write(LOG_FILE, line);
  }

  logError(message, err = null) {
    const line = `[${this._ts()}] ERR  | ${message}${err ? " | " + err.message : ""}`;
    console.error(`  ❌ ${line}`);
    this._write(ERR_FILE, line);
    this._write(LOG_FILE, line);
  }
}

module.exports = Logger;
