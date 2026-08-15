// ============================================================
//  TELEGRAM NOTIFIER
//  Sends trade alerts to your Telegram chat.
//  Leave TELEGRAM_BOT_TOKEN blank in .env to disable.
// ============================================================

require("dotenv").config();
const https = require("https");

class TelegramNotifier {
  constructor() {
    this.token  = process.env.TELEGRAM_BOT_TOKEN || "";
    this.chatId = process.env.TELEGRAM_CHAT_ID   || "";
    this.enabled = !!(this.token && this.chatId);
    if (this.enabled) {
      console.log("  ✅ Telegram alerts enabled");
    } else {
      console.log("  ℹ️  Telegram alerts disabled (no token/chatId in .env)");
    }
  }

  async send(message) {
    if (!this.enabled) return;
    const url  = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const body = JSON.stringify({ chat_id: this.chatId, text: message, parse_mode: "HTML" });
    return new Promise((resolve) => {
      const req = https.request(url, { method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      }, (res) => {
        res.on("data", () => {});
        res.on("end", resolve);
      });
      req.on("error", (e) => console.log(`  ⚠️  Telegram error: ${e.message}`));
      req.write(body);
      req.end();
    });
  }

  async sendBuy(symbol, bnbAmount, entryPrice, strategy) {
    const tpLines = strategy.takeProfits.map((tp, i) =>
      `  TP${i+1}: +${tp.targetPercent}% → sell ${tp.sellPercent}%`
    ).join("\n");
    await this.send(
      `🟢 <b>BUY EXECUTED</b>\n` +
      `Token: <b>${symbol}</b>\n` +
      `Spent: ${bnbAmount} BNB\n` +
      `Entry: ${entryPrice.toFixed(8)} BNB\n` +
      `Strategy: ${strategy.name}\n` +
      `Stop Loss: ${strategy.stopLoss}%\n` +
      `${tpLines}`
    );
  }

  async sendTp(symbol, tpNum, targetPct, sellPct, actualPct, txHash) {
    await this.send(
      `🎯 <b>TP${tpNum} HIT — ${symbol}</b>\n` +
      `Target  : +${targetPct}%\n` +
      `Actual  : +${actualPct.toFixed(2)}%\n` +
      `Sold    : ${sellPct}% of position\n` +
      `TX: <code>${txHash}</code>`
    );
  }

  async sendExit(symbol, reason, changePct, txHash) {
    const icon = reason === "STOP LOSS" ? "🔴" : "✅";
    await this.send(
      `${icon} <b>${reason} — ${symbol}</b>\n` +
      `P&L   : ${changePct.toFixed(2)}%\n` +
      `TX    : <code>${txHash}</code>`
    );
  }

  async sendInfo(message) {
    await this.send(`ℹ️ ${message}`);
  }

  async sendError(message) {
    await this.send(`⚠️ <b>BOT ERROR</b>\n${message}`);
  }
}

module.exports = TelegramNotifier;
