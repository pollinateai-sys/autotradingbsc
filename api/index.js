// ============================================================
//  HALAL BSC TRADING BOT — Express App
//  Multi-profile: each person authenticates with their own
//  personal API key (x-api-key header), which scopes every
//  route to their own wallet, settings, tokens, and positions.
// ============================================================

const express = require("express");
const path    = require("path");
const app     = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Routes ────────────────────────────────────────────────
app.use("/api/auth",      require("./routes/auth"));
app.use("/api/wallet",    require("./routes/wallet"));
app.use("/api/status",    require("./routes/status"));
app.use("/api/trade",     require("./routes/trade"));
app.use("/api/positions", require("./routes/positions"));
app.use("/api/tokens",    require("./routes/tokens"));
app.use("/api/settings",  require("./routes/settings"));
app.use("/api",           require("./routes/scan")); // /api/scan/now + /api/cron/scan

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

module.exports = app;
