// ============================================================
//  LIVE POSITION MONITOR TESTS — no network, no Redis, no funds
//
//  A fake ethers-like WebSocket provider verifies:
//   · first BSC block switches CONNECTING → LIVE
//   · every block triggers a position sweep
//   · rapid blocks coalesce without overlapping sweeps
//   · socket close reconnects with a fresh provider
//   · wrong chain is rejected into watchdog fallback
//   · disabled mode never creates a socket
// ============================================================

require("./setup-mocks.js");
const { EventEmitter } = require("events");
const { createLivePositionMonitor } = require("../api/lib/livefeed");

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.error(`  ❌ ${msg}`); failures++; }
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class FakeProvider extends EventEmitter {
  constructor(chainId = 56) {
    super();
    this.chainId = chainId;
    this.websocket = new EventEmitter();
    this.destroyed = false;
  }
  async getNetwork() { return { chainId: BigInt(this.chainId) }; }
  async destroy() { this.destroyed = true; this.removeAllListeners(); }
  block(number) { this.emit("block", number); }
  close(code = 1006) { this.websocket.emit("close", code); }
}

async function testBlocksAndCoalescing() {
  console.log("\n── Live feed: blocks + no overlapping sweeps ──");
  const provider = new FakeProvider();
  let sweeps = 0, concurrent = 0, maxConcurrent = 0;
  const monitor = createLivePositionMonitor({
    url: "wss://fake-bsc",
    providerFactory: () => provider,
    getAllProfileIds: async () => ["profile-a"],
    checkAllPositions: async (profileId, options) => {
      sweeps++;
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      assert(profileId === "profile-a", "Sweep receives the right profile ID");
      assert(options.source === "live", "Sweep is labelled as live");
      await wait(20);
      concurrent--;
      return [];
    },
    staleMs: 500,
    reconnectDelaysMs: [10],
    connectTimeoutMs: 100,
    onLog: () => {},
  });

  await monitor.start();
  assert(monitor.getStatus().mode === "connecting", "Connected feed waits for its first block");

  provider.block(100);
  await wait(3);
  assert(monitor.getStatus().mode === "live", "First BSC block changes status to LIVE");
  assert(monitor.getStatus().lastBlockNumber === 100, "Latest block number is exposed in status");

  // Burst while block 100's slow sweep is still active. It must produce only
  // one coalesced follow-up and concurrency must stay at one.
  provider.block(101);
  provider.block(102);
  provider.block(103);
  await wait(60);
  assert(maxConcurrent === 1, `Rapid block callbacks never overlap (max concurrent ${maxConcurrent})`);
  assert(sweeps === 2, `Block burst coalesces to current + latest sweep (got ${sweeps})`);
  assert(monitor.getStatus().lastBlockNumber === 103, "Status tracks the newest block in a burst");
  assert(monitor.getStatus().lastSweepAt !== null, "Successful sweep timestamp is reported");

  await monitor.stop();
  assert(provider.destroyed, "Stopping destroys the WebSocket provider cleanly");
  assert(monitor.getStatus().mode === "disabled", "Stopped monitor reports disabled");
}

async function testReconnect() {
  console.log("\n── Live feed: disconnect + reconnect ──");
  const providers = [];
  const monitor = createLivePositionMonitor({
    url: "wss://fake-bsc",
    providerFactory: () => {
      const p = new FakeProvider();
      providers.push(p);
      return p;
    },
    getAllProfileIds: async () => [],
    checkAllPositions: async () => [],
    staleMs: 500,
    reconnectDelaysMs: [10],
    connectTimeoutMs: 100,
    onLog: () => {},
  });

  await monitor.start();
  providers[0].block(200);
  await wait(3);
  assert(monitor.getStatus().mode === "live", "Initial provider reaches LIVE");

  providers[0].close(1006);
  await wait(3);
  assert(["reconnecting", "connecting"].includes(monitor.getStatus().mode), "Socket close enters reconnecting state");
  await wait(20);
  assert(providers.length === 2, `Reconnect creates a fresh provider (got ${providers.length})`);
  providers[1].block(201);
  await wait(3);
  assert(monitor.getStatus().mode === "live", "Fresh provider returns monitor to LIVE");
  assert(monitor.getStatus().lastBlockNumber === 201, "Reconnected feed receives new blocks");
  assert(providers[0].destroyed, "Disconnected provider is destroyed");
  await monitor.stop();
}

async function testWrongChainFallsBack() {
  console.log("\n── Live feed: wrong-chain protection ──");
  const bad = new FakeProvider(1); // Ethereum, not BSC
  const monitor = createLivePositionMonitor({
    url: "wss://wrong-chain",
    providerFactory: () => bad,
    getAllProfileIds: async () => [],
    checkAllPositions: async () => [],
    reconnectDelaysMs: [1000],
    connectTimeoutMs: 100,
    onLog: () => {},
  });
  await monitor.start();
  const status = monitor.getStatus();
  assert(status.mode === "fallback", `Wrong chain enters FALLBACK (got ${status.mode})`);
  assert(/chain ID 56/.test(status.lastError || ""), "Fallback reason clearly names required chain ID 56");
  assert(bad.destroyed, "Wrong-chain provider is destroyed");
  await monitor.stop();
}

async function testDisabledMode() {
  console.log("\n── Live feed: explicit disabled mode ──");
  let factoryCalls = 0;
  const monitor = createLivePositionMonitor({
    enabled: false,
    providerFactory: () => { factoryCalls++; return new FakeProvider(); },
    onLog: () => {},
  });
  await monitor.start();
  assert(monitor.getStatus().mode === "disabled", "Disabled monitor reports disabled");
  assert(factoryCalls === 0, "Disabled monitor never creates a WebSocket");
  await monitor.stop();
}

async function main() {
  await testBlocksAndCoalescing();
  await testReconnect();
  await testWrongChainFallsBack();
  await testDisabledMode();

  console.log("\n" + "─".repeat(50));
  if (failures === 0) { console.log("✅ ALL LIVE MONITOR TESTS PASSED"); process.exit(0); }
  console.log(`❌ ${failures} LIVE MONITOR TEST(S) FAILED`);
  process.exit(1);
}

main().catch(e => { console.error("❌ Live monitor test crashed:", e); process.exit(1); });
