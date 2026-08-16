// ============================================================
//  TELEGRAM NOTIFIER
// ============================================================
const https = require("https");

function send(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.resolve();

  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" });
  return new Promise((resolve) => {
    const req = https.request(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
      (res) => { res.on("data", () => {}); res.on("end", resolve); }
    );
    req.on("error", () => resolve());
    req.write(body);
    req.end();
  });
}

module.exports = {
  sendBuy: (symbol, bnb, price, strategy) =>
    send(`🟢 <b>BUY</b> — ${symbol}\nSpent: ${bnb} BNB\nEntry: ${price} BNB\nStrategy: ${strategy.name}\nSL: ${strategy.stopLoss}%\nTPs: ${strategy.takeProfits.map((t,i)=>`TP${i+1}:+${t.targetPercent}%(sell ${t.sellPercent}%)`).join(", ")}`),
  sendTp: (symbol, num, target, sellPct, actual, hash) =>
    send(`🎯 <b>TP${num} HIT</b> — ${symbol}\nTarget: +${target}%\nActual: +${actual.toFixed(2)}%\nSold: ${sellPct}%\nTX: <code>${hash}</code>`),
  sendSL: (symbol, changePct, hash) =>
    send(`🔴 <b>STOP LOSS</b> — ${symbol}\nP&L: ${changePct.toFixed(2)}%\nTX: <code>${hash}</code>`),
  sendInfo: (msg) => send(`ℹ️ ${msg}`),
  sendError: (msg) => send(`⚠️ <b>ERROR</b>\n${msg}`),
};
