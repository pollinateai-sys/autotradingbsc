// ============================================================
//  HTTP LAYER TESTS
//  Boots the real Express app (api/index.js) against mocks and
//  exercises it over actual HTTP — verifies routing, per-profile
//  auth (x-api-key), the full profile-create → connect-wallet →
//  trade lifecycle, and that two profiles never cross-contaminate.
//
//  Run: node test/test_http.js  (or `npm test`)
// ============================================================

require("./setup-mocks.js");
process.env.AUTO_TRADE = "true";

const app = require("../api/index");

const PORT = 4399;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}

async function req(method, path, body, apiKey) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const FAKE_PK_A = "1111111111111111111111111111111111111111111111111111111111111111".slice(0, 64);
const FAKE_PK_B = "2222222222222222222222222222222222222222222222222222222222222222".slice(0, 64);

async function createAndLoginProfile(name) {
  const apiKey = `${name}-key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const r = await req("POST", "/api/profiles/create", { name, apiKey });
  return { apiKey, profile: r.json?.profile, status: r.status };
}

async function main() {
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 500));

  try {
    console.log("\n── Health check ──");
    let r = await req("GET", "/api/health");
    assert(r.status === 200 && r.json.status === "ok", "GET /api/health → 200");

    console.log("\n── Profile creation ──");
    r = await req("POST", "/api/profiles/create", { name: "", apiKey: "shortkey1" });
    assert(r.status === 400, "Create with empty name → 400");

    r = await req("POST", "/api/profiles/create", { name: "Shorty", apiKey: "abc" });
    assert(r.status === 400, "Create with <8 char key → 400");

    const alice = await createAndLoginProfile("Alice");
    assert(alice.status === 200 && alice.profile.name === "Alice", "Create profile 'Alice' → 200");

    r = await req("POST", "/api/profiles/create", { name: "Alice2", apiKey: alice.apiKey });
    assert(r.status === 400, "Re-registering the same API key → 400 (already in use)");

    r = await req("GET", "/api/profiles/generate-key");
    assert(r.status === 200 && /^[0-9a-f]{40}$/.test(r.json.apiKey), "GET /api/profiles/generate-key → 40-char hex key (no auth needed, pre-signup)");

    console.log("\n── Auth guard (no key / wrong key) ──");
    r = await req("GET", "/api/status");
    assert(r.status === 401, "GET /api/status without x-api-key → 401");

    r = await req("GET", "/api/status", null, "totally-made-up-key");
    assert(r.status === 401, "GET /api/status with an unregistered key → 401");

    r = await req("GET", "/api/status", null, alice.apiKey);
    assert(r.status === 200 && r.json.ok === true, "GET /api/status with Alice's real key → 200");
    assert(r.json.wallet.connected === false, "Fresh profile has no wallet connected yet");

    console.log("\n── Can't trade or start bot without a wallet ──");
    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, alice.apiKey);
    assert(r.status === 400, "Buy attempt with no wallet connected → 400");

    r = await req("POST", "/api/settings/start", {}, alice.apiKey);
    assert(r.status === 400, "Starting the bot with no wallet connected → 400");

    console.log("\n── Connect wallet ──");
    r = await req("POST", "/api/wallet/connect", { privateKey: "not-a-valid-key" }, alice.apiKey);
    assert(r.status === 400, "Connecting an invalid private key format → 400");

    r = await req("POST", "/api/wallet/connect", { privateKey: FAKE_PK_A }, alice.apiKey);
    assert(r.status === 200 && r.json.wallet.address, "Connecting a valid private key → 200 + returns address");
    const aliceAddress = r.json.wallet.address;

    r = await req("GET", "/api/status", null, alice.apiKey);
    assert(r.json.wallet.connected === true, "Status now shows wallet connected");
    assert(r.json.wallet.address === aliceAddress, "Status shows the same address that was connected");

    console.log("\n── Trade flow now that a wallet exists ──");
    r = await req("POST", "/api/settings/update", { activeStrategy: "B" }, alice.apiKey);
    assert(r.status === 200 && r.json.settings.activeStrategy === "B", "Strategy switch → applied");

    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, alice.apiKey);
    assert(r.status === 200 && r.json.ok === true, "POST /api/trade/buy BTCB → success now that wallet is connected");

    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, alice.apiKey);
    assert(r.status === 409, "Duplicate buy on open symbol → 409");

    r = await req("GET", "/api/positions", null, alice.apiKey);
    assert(r.status === 200 && r.json.count === 1, "GET /api/positions reflects the open position");
    assert(r.json.positions[0].nextTpTarget === 50, "Position shows correct next TP target (Strategy B TP1=50)");

    r = await req("POST", "/api/trade/close", { symbol: "BTCB" }, alice.apiKey);
    assert(r.status === 200 && r.json.ok === true, "POST /api/trade/close → success");

    r = await req("GET", "/api/positions/log", null, alice.apiKey);
    assert(r.json.log.length === 2, "Trade log has BUY + MANUAL_CLOSE entries");

    console.log("\n── Token management ──");
    const fakeAddr = "0x9999999999999999999999999999999999999999";
    r = await req("POST", "/api/tokens/add", { contract: fakeAddr }, alice.apiKey);
    assert(r.status === 200 && r.json.ok === true, "POST /api/tokens/add with valid address → success");

    r = await req("POST", "/api/tokens/toggle", { symbol: "NEWTKN", enabled: false }, alice.apiKey);
    assert(r.status === 200 && r.json.token.enabled === false, "Toggle token off → enabled:false");

    r = await req("POST", "/api/tokens/remove", { symbol: "NEWTKN" }, alice.apiKey);
    assert(r.status === 200, "Remove token → success");

    r = await req("GET", "/api/tokens", null, alice.apiKey);
    assert(r.json.tokens.length === 5, "Token list back to 5 after removal");

    console.log("\n── Bot start/stop (wallet now connected) ──");
    r = await req("POST", "/api/settings/start", {}, alice.apiKey);
    assert(r.status === 200 && r.json.settings.botRunning === true, "Start bot → botRunning:true");
    r = await req("POST", "/api/settings/stop", {}, alice.apiKey);
    assert(r.json.settings.botRunning === false, "Stop bot → botRunning:false");

    console.log("\n── Two independent profiles never cross-contaminate over HTTP ──");
    const bob = await createAndLoginProfile("Bob");
    assert(bob.status === 200, "Create second profile 'Bob' → 200");

    r = await req("GET", "/api/positions", null, bob.apiKey);
    assert(r.json.count === 0, "Bob sees zero positions (Alice's history doesn't leak)");

    r = await req("GET", "/api/tokens", null, bob.apiKey);
    assert(r.json.tokens.length === 5, "Bob gets his own fresh default token list, unaffected by Alice's edits");

    r = await req("POST", "/api/wallet/connect", { privateKey: FAKE_PK_B }, bob.apiKey);
    const bobAddress = r.json.wallet.address;
    assert(bobAddress !== aliceAddress, "Bob's connected wallet address differs from Alice's");

    r = await req("POST", "/api/trade/buy", { symbol: "ETH" }, bob.apiKey);
    assert(r.status === 200, "Bob can buy independently of Alice");

    r = await req("GET", "/api/positions", null, alice.apiKey);
    assert(r.json.count === 0, "Alice still shows zero open positions — Bob's buy did not leak into her account");

    console.log("\n── Wallet disconnect ──");
    r = await req("POST", "/api/wallet/disconnect", {}, bob.apiKey);
    assert(r.status === 200, "Disconnect wallet → success");
    r = await req("GET", "/api/status", null, bob.apiKey);
    assert(r.json.wallet.connected === false, "Status confirms wallet no longer connected");

    console.log("\n── whoami ──");
    r = await req("GET", "/api/profiles/me", null, alice.apiKey);
    assert(r.status === 200 && r.json.profile.name === "Alice", "GET /api/profiles/me returns the right profile");

    console.log("\n── Static dashboard ──");
    const staticRes = await fetch(BASE + "/");
    assert(staticRes.status === 200, "GET / serves the dashboard");
    const html = await staticRes.text();
    assert(html.includes("Halal BSC Trading Bot"), "Dashboard HTML contains expected title");

  } finally {
    server.close();
  }

  console.log("\n" + "─".repeat(50));
  if (failures === 0) {
    console.log(`✅ ALL HTTP TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(`❌ ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
}

main().catch(e => { console.error("❌ Test crashed:", e); process.exit(1); });
