// ============================================================
//  LIVE POSITION MONITOR — WebSocket new-block subscriptions
//
//  Entries stay on the normal scanner timer (their 1h/24h rules
//  do not need sub-second polling). Once a position is open,
//  however, this monitor reacts to every new BSC block and runs
//  its SL/TP checks immediately.
//
//  Safety design:
//   · verifies chain ID 56 before accepting a feed
//   · stale-feed detector (a silent socket is treated as dead)
//   · exponential reconnect with a fresh ethers provider
//   · coalesces blocks if a previous sweep is still running
//   · HTTP watchdog in server.js remains active as a backstop
//   · per-position transaction locks live in strategy.js, so a
//     block sweep and watchdog can never double-submit an exit
//
//  BSC_WSS_URL is strongly recommended in production. A public
//  WSS endpoint is the local-testing default; public services can
//  rate-limit or disconnect, so the watchdog is non-negotiable.
// ============================================================

const { ethers } = require("ethers");
const { getAllProfileIds } = require("./redis");
const { checkAllPositions } = require("./scanner");

const DEFAULT_BSC_WSS_URL = "wss://bsc-rpc.publicnode.com";
const DEFAULT_STALE_MS    = 20_000;
const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function cleanMessage(error) {
  return String(error?.message || error || "Unknown WebSocket error").split("\n")[0].slice(0, 220);
}

class LivePositionMonitor {
  constructor(options = {}) {
    this.url = options.url || process.env.BSC_WSS_URL || DEFAULT_BSC_WSS_URL;
    this.usingDefaultEndpoint = !options.url && !process.env.BSC_WSS_URL;
    this.enabled = options.enabled !== undefined
      ? !!options.enabled
      : String(process.env.LIVE_MONITOR_ENABLED || "true").toLowerCase() !== "false";

    this.providerFactory = options.providerFactory || ((url) => new ethers.WebSocketProvider(url));
    this.getAllProfileIds = options.getAllProfileIds || getAllProfileIds;
    this.checkAllPositions = options.checkAllPositions || checkAllPositions;
    this.staleMs = options.staleMs || parseInt(process.env.LIVE_STALE_SECONDS || "20", 10) * 1000 || DEFAULT_STALE_MS;
    this.reconnectDelaysMs = options.reconnectDelaysMs || DEFAULT_RECONNECT_DELAYS_MS;
    this.connectTimeoutMs = options.connectTimeoutMs || 12_000;
    this.onLog = options.onLog || ((line) => console.log(line));

    this.provider = null;
    this.rawSocket = null;
    this.generation = 0;
    this.started = false;
    this.stopping = false;
    this.sweeping = false;
    this.pendingSweep = false;
    this.reconnectTimer = null;
    this.staleTimer = null;
    this.reconnectAttempt = 0;
    this.everLive = false;
    this.socketListeners = null;

    this.state = {
      mode: this.enabled ? "connecting" : "disabled",
      lastBlockNumber: null,
      lastBlockAt: null,
      connectedAt: null,
      lastSweepAt: null,
      lastSweepDurationMs: null,
      lastError: null,
    };
  }

  getStatus() {
    const lastBlockMs = this.state.lastBlockAt ? new Date(this.state.lastBlockAt).getTime() : null;
    return {
      enabled: this.enabled,
      mode: this.state.mode,
      transport: "BSC WebSocket newHeads",
      usingDefaultEndpoint: this.usingDefaultEndpoint,
      lastBlockNumber: this.state.lastBlockNumber,
      lastBlockAt: this.state.lastBlockAt,
      secondsSinceBlock: lastBlockMs ? Math.max(0, Math.floor((Date.now() - lastBlockMs) / 1000)) : null,
      connectedAt: this.state.connectedAt,
      lastSweepAt: this.state.lastSweepAt,
      lastSweepDurationMs: this.state.lastSweepDurationMs,
      reconnectAttempt: this.reconnectAttempt,
      lastError: this.state.lastError,
      watchdogSeconds: Math.max(5, parseInt(process.env.POSITION_WATCHDOG_INTERVAL_SECONDS || "15", 10) || 15),
    };
  }

  async start() {
    if (this.started) return this.getStatus();
    this.started = true;
    this.stopping = false;

    if (!this.enabled) {
      this.state.mode = "disabled";
      this.onLog("  ⚪ Live position monitor disabled — HTTP watchdog only");
      return this.getStatus();
    }

    await this._connect(false);
    return this.getStatus();
  }

  async _connect(isReconnect) {
    if (this.stopping || !this.enabled) return;
    const generation = ++this.generation;
    this.state.mode = isReconnect ? "reconnecting" : "connecting";

    let provider;
    try {
      provider = this.providerFactory(this.url);
      this.provider = provider;
      this.rawSocket = provider.websocket || null;
      this._attachSocketLifecycle(provider, generation);

      const network = await Promise.race([
        provider.getNetwork(),
        sleep(this.connectTimeoutMs).then(() => { throw new Error("WebSocket connection timed out"); }),
      ]);
      if (generation !== this.generation || this.stopping) return;
      if (Number(network.chainId) !== 56) {
        throw new Error(`Wrong WebSocket network: expected BSC chain ID 56, got ${network.chainId}`);
      }

      provider.on("block", (blockNumber) => this._onBlock(blockNumber, provider, generation));
      this.state.connectedAt = new Date().toISOString();
      this.state.lastError = null;
      // It becomes fully LIVE on the first received block. Until then it is connecting.
      this.state.mode = "connecting";
      this._startStaleDetector(generation);
      this.onLog(`  🔌 BSC WebSocket connected${this.usingDefaultEndpoint ? " (public test endpoint)" : ""} — waiting for first block`);
    } catch (error) {
      if (generation !== this.generation || this.stopping) return;
      this.state.lastError = cleanMessage(error);
      this.state.mode = "fallback";
      this.onLog(`  ⚠️  Live feed unavailable: ${this.state.lastError} — HTTP watchdog is protecting positions`);
      // Schedule first so a pathological provider.destroy() cannot delay recovery.
      this._scheduleReconnect();
      await this._disposeProvider(provider || this.provider, generation);
    }
  }

  _attachSocketLifecycle(provider, generation) {
    const socket = provider.websocket;
    if (!socket || typeof socket.on !== "function") return;

    const onClose = (code) => {
      this._handleDisconnect(`WebSocket closed${code ? ` (code ${code})` : ""}`, generation);
    };
    const onError = (error) => {
      // ws normally emits close after error, but not every provider does.
      this._handleDisconnect(`WebSocket error: ${cleanMessage(error)}`, generation);
    };
    socket.once("close", onClose);
    socket.once("error", onError);
    this.socketListeners = { socket, onClose, onError };
  }

  _startStaleDetector(generation) {
    if (this.staleTimer) clearInterval(this.staleTimer);
    const cadence = Math.max(1000, Math.min(5000, Math.floor(this.staleMs / 3)));
    this.staleTimer = setInterval(() => {
      if (generation !== this.generation || this.stopping || !this.provider) return;
      const reference = this.state.lastBlockAt || this.state.connectedAt;
      if (!reference) return;
      if (Date.now() - new Date(reference).getTime() > this.staleMs) {
        this._handleDisconnect(`No BSC block received for ${Math.round(this.staleMs / 1000)}s (stale feed)`, generation);
      }
    }, cadence);
  }

  _onBlock(blockNumber, provider, generation) {
    if (generation !== this.generation || this.stopping || provider !== this.provider) return;
    this.everLive = true;
    this.reconnectAttempt = 0;
    this.state.mode = "live";
    this.state.lastBlockNumber = Number(blockNumber);
    this.state.lastBlockAt = new Date().toISOString();
    this.state.lastError = null;
    this._runSweep(provider);
  }

  async _runSweep(provider) {
    if (this.sweeping) {
      // Never overlap. Remember that at least one newer block arrived and run
      // one more sweep immediately after the current one completes.
      this.pendingSweep = true;
      return;
    }
    this.sweeping = true;
    const started = Date.now();
    try {
      const ids = await this.getAllProfileIds();
      for (const profileId of ids) {
        try {
          const results = await this.checkAllPositions(profileId, {
            provider,
            source: "live",
            blockNumber: this.state.lastBlockNumber,
          });
          for (const result of results) {
            if (result.action && !["HOLD", "BUSY"].includes(result.action)) {
              this.onLog(`  ⚡ [LIVE block ${this.state.lastBlockNumber}] ${result.symbol}: ${result.action} (${Number(result.changePct || 0).toFixed(2)}%)`);
            }
          }
        } catch (error) {
          this.onLog(`  ❌ Live position sweep failed for ${profileId}: ${cleanMessage(error)}`);
        }
      }
      this.state.lastSweepAt = new Date().toISOString();
      this.state.lastSweepDurationMs = Date.now() - started;
    } finally {
      this.sweeping = false;
      if (this.pendingSweep && !this.stopping && this.state.mode === "live") {
        this.pendingSweep = false;
        // Yield once so a burst of block callbacks cannot grow the stack.
        setImmediate(() => this._runSweep(this.provider));
      }
    }
  }

  _handleDisconnect(reason, generation) {
    if (generation !== this.generation || this.stopping) return;
    this.state.lastError = reason;
    this.state.mode = "reconnecting";
    this.onLog(`  🔄 ${reason} — reconnecting; HTTP watchdog remains active`);
    // Invalidate every callback belonging to this provider before cleanup.
    ++this.generation;
    const oldProvider = this.provider;
    this.provider = null;
    // Reconnect timing must not depend on provider cleanup completing.
    this._scheduleReconnect();
    this._disposeProvider(oldProvider).catch(() => {});
  }

  _scheduleReconnect() {
    if (this.stopping || !this.enabled || this.reconnectTimer) return;
    const index = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1);
    const delay = this.reconnectDelaysMs[index];
    this.reconnectAttempt += 1;
    if (this.state.mode !== "fallback") this.state.mode = "reconnecting";
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect(true);
    }, delay);
  }

  async _disposeProvider(provider, expectedGeneration = null) {
    if (!provider) return;
    if (this.staleTimer) { clearInterval(this.staleTimer); this.staleTimer = null; }

    if (this.socketListeners) {
      const { socket, onClose, onError } = this.socketListeners;
      if (typeof socket.removeListener === "function") {
        socket.removeListener("close", onClose);
        socket.removeListener("error", onError);
      }
      this.socketListeners = null;
    }

    try { provider.removeAllListeners(); } catch { /* already closed */ }
    try { await provider.destroy(); } catch { /* cleanup must never crash the bot */ }
    if (expectedGeneration === null || expectedGeneration === this.generation) {
      if (this.provider === provider) this.provider = null;
      this.rawSocket = null;
    }
  }

  async stop() {
    if (!this.started) return;
    this.stopping = true;
    this.started = false;
    ++this.generation;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.staleTimer) { clearInterval(this.staleTimer); this.staleTimer = null; }
    const provider = this.provider;
    this.provider = null;
    await this._disposeProvider(provider);
    this.state.mode = "disabled";
  }
}

// ── Process-wide instance used by server.js + status API ─────
let singleton = null;

function createLivePositionMonitor(options) { return new LivePositionMonitor(options); }
async function startLiveMonitor(options = {}) {
  if (!singleton) singleton = new LivePositionMonitor(options);
  return singleton.start();
}
async function stopLiveMonitor() {
  if (singleton) await singleton.stop();
  singleton = null;
}
function getLiveStatus() {
  if (singleton) return singleton.getStatus();
  return {
    enabled: false,
    mode: "disabled",
    transport: "BSC WebSocket newHeads",
    usingDefaultEndpoint: false,
    lastBlockNumber: null,
    lastBlockAt: null,
    secondsSinceBlock: null,
    connectedAt: null,
    lastSweepAt: null,
    lastSweepDurationMs: null,
    reconnectAttempt: 0,
    lastError: null,
    watchdogSeconds: Math.max(5, parseInt(process.env.POSITION_WATCHDOG_INTERVAL_SECONDS || "15", 10) || 15),
  };
}

module.exports = {
  DEFAULT_BSC_WSS_URL,
  LivePositionMonitor,
  createLivePositionMonitor,
  startLiveMonitor,
  stopLiveMonitor,
  getLiveStatus,
};
