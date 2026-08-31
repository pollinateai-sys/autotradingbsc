// ============================================================
//  HTTP LAYER TESTS
//  Boots the real Express app (api/index.js) against mocks and
//  exercises it over actual HTTP — verifies routing, per-profile
//  auth via session tokens, the full register → login →
//  connect-wallet → trade lifecycle, that a password never comes
//  back over the wire in any response, and that two profiles
//  never cross-contaminate.
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

async function req(method, path, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["x-api-key"] = token;
  const res = await fetch(BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

const FAKE_PK_A = "1111111111111111111111111111111111111111111111111111111111111111".slice(0, 64);
const FAKE_PK_B = "2222222222222222222222222222222222222222222222222222222222222222".slice(0, 64);

async function registerAndLogin(username) {
  const password = `password-${username}-${Date.now()}`;
  const r = await req("POST", "/api/auth/register", { username, password });
  return { username, password, token: r.json?.sessionToken, profile: r.json?.profile, status: r.status };
}

async function main() {
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 500));

  try {
    console.log("\n── Health check ──");
    let r = await req("GET", "/api/health");
    assert(r.status === 200 && r.json.status === "ok", "GET /api/health → 200");

    console.log("\n── Registration ──");
    r = await req("POST", "/api/auth/register", { username: "ab", password: "longenoughpassword" });
    assert(r.status === 400, "Username under 3 chars → 400");

    r = await req("POST", "/api/auth/register", { username: "shortpw", password: "short1" });
    assert(r.status === 400, "Password under 8 chars → 400");

    r = await req("POST", "/api/auth/register", { username: "bad name!", password: "longenoughpassword" });
    assert(r.status === 400, "Username with invalid characters → 400");

    const alice = await registerAndLogin("alice_trader");
    assert(alice.status === 200 && alice.profile.username === "alice_trader", "Register 'alice_trader' → 200");
    assert(typeof alice.token === "string" && alice.token.length === 48, "Register returns a 48-char session token");
    assert(!JSON.stringify(alice).includes("passwordHash"), "passwordHash never appears anywhere in the response");

    r = await req("POST", "/api/auth/register", { username: "alice_trader", password: "someotherpassword" });
    assert(r.status === 400, "Registering an already-taken username → 400");

    r = await req("POST", "/api/auth/register", { username: "Alice_Trader", password: "someotherpassword" });
    assert(r.status === 400, "Username uniqueness is case-insensitive (Alice_Trader taken too)");

    console.log("\n── Login ──");
    r = await req("POST", "/api/auth/login", { username: "alice_trader", password: "wrong-password-entirely" });
    assert(r.status === 401, "Login with wrong password → 401");

    r = await req("POST", "/api/auth/login", { username: "nobody_here", password: "whatever12345" });
    assert(r.status === 401, "Login with unknown username → 401 (no user-enumeration hint)");

    r = await req("POST", "/api/auth/login", { username: "ALICE_TRADER", password: alice.password });
    assert(r.status === 200, "Login is case-insensitive on username");
    const aliceToken2 = r.json.sessionToken;
    assert(aliceToken2 !== alice.token, "Each login issues a brand new session token");

    console.log("\n── Both of Alice's sessions stay valid at once (multi-device, forever) ──");
    r = await req("GET", "/api/auth/me", null, alice.token);
    assert(r.status === 200, "Original registration token still works after a second login");
    r = await req("GET", "/api/auth/me", null, aliceToken2);
    assert(r.status === 200, "New login token also works");

    console.log("\n── Auth guard (no token / wrong token) ──");
    r = await req("GET", "/api/status");
    assert(r.status === 401, "GET /api/status without x-api-key → 401");

    r = await req("GET", "/api/status", null, "totally-made-up-token");
    assert(r.status === 401, "GET /api/status with an unrecognized token → 401");

    r = await req("GET", "/api/status", null, alice.token);
    assert(r.status === 200 && r.json.ok === true, "GET /api/status with Alice's real token → 200");
    assert(r.json.wallet.connected === false, "Fresh profile has no wallet connected yet");
    assert(r.json.liveMonitor && typeof r.json.liveMonitor.mode === "string", "Status exposes live monitor mode");
    assert(r.json.liveMonitor.transport === "BSC WebSocket newHeads", "Status identifies the BSC WebSocket transport");

    console.log("\n── Can't trade or start bot without a wallet ──");
    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, alice.token);
    assert(r.status === 400, "Buy attempt with no wallet connected → 400");

    r = await req("POST", "/api/settings/start", {}, alice.token);
    assert(r.status === 400, "Starting the bot with no wallet connected → 400");

    console.log("\n── Connect wallet ──");
    r = await req("POST", "/api/wallet/connect", { privateKey: "not-a-valid-key" }, alice.token);
    assert(r.status === 400, "Connecting an invalid private key format → 400");

    r = await req("POST", "/api/wallet/connect", { privateKey: FAKE_PK_A }, alice.token);
    assert(r.status === 200 && r.json.wallet.address, "Connecting a valid private key → 200 + returns address");
    const aliceAddress = r.json.wallet.address;

    r = await req("GET", "/api/status", null, alice.token);
    assert(r.json.wallet.connected === true, "Status now shows wallet connected");
    assert(r.json.wallet.address === aliceAddress, "Status shows the same address that was connected");

    console.log("\n── Trade flow now that a wallet exists ──");
    r = await req("POST", "/api/settings/update", { activeStrategy: "B" }, alice.token);
    assert(r.status === 200 && r.json.settings.activeStrategy === "B", "Strategy switch → applied");

    r = await req("POST", "/api/settings/update", { scanIntervalSeconds: 5 }, alice.token);
    assert(r.status === 200 && r.json.settings.scanIntervalSeconds === 5, "5-second scan interval accepted");

    r = await req("POST", "/api/settings/update", { scanIntervalSeconds: 1 }, alice.token);
    assert(r.json.settings.scanIntervalSeconds === 3, "Scan interval floor of 3s enforced even if a lower value is sent");

    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, alice.token);
    assert(r.status === 200 && r.json.ok === true, "POST /api/trade/buy BTCB → success now that wallet is connected");

    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, alice.token);
    assert(r.status === 409, "Duplicate buy on open symbol → 409");

    r = await req("GET", "/api/positions", null, alice.token);
    assert(r.status === 200 && r.json.count === 1, "GET /api/positions reflects the open position");
    assert(r.json.positions[0].nextTpTarget === 50, "Position shows correct next TP target (Strategy B TP1=50)");

    r = await req("POST", "/api/trade/close", { symbol: "BTCB" }, alice.token);
    assert(r.status === 200 && r.json.ok === true, "POST /api/trade/close → success");

    r = await req("GET", "/api/positions/log", null, alice.token);
    assert(r.json.log.length === 2, "Trade log has BUY + MANUAL_CLOSE entries");

    console.log("\n── Token management ──");
    const fakeAddr = "0x9999999999999999999999999999999999999999";
    r = await req("POST", "/api/tokens/add", { contract: fakeAddr }, alice.token);
    assert(r.status === 200 && r.json.ok === true, "POST /api/tokens/add with valid address → success");

    r = await req("POST", "/api/tokens/toggle", { symbol: "NEWTKN", enabled: false }, alice.token);
    assert(r.status === 200 && r.json.token.enabled === false, "Toggle token off → enabled:false");

    r = await req("POST", "/api/tokens/remove", { symbol: "NEWTKN" }, alice.token);
    assert(r.status === 200, "Remove token → success");

    r = await req("GET", "/api/tokens", null, alice.token);
    assert(r.json.tokens.length === 5, "Token list back to 5 after removal");

    console.log("\n── Bot start/stop (wallet now connected) ──");
    r = await req("POST", "/api/settings/start", {}, alice.token);
    assert(r.status === 200 && r.json.settings.botRunning === true, "Start bot → botRunning:true");
    r = await req("POST", "/api/settings/stop", {}, alice.token);
    assert(r.json.settings.botRunning === false, "Stop bot → botRunning:false");

    console.log("\n── Two independent profiles never cross-contaminate over HTTP ──");
    const bob = await registerAndLogin("bob_trader");
    assert(bob.status === 200, "Register second profile 'bob_trader' → 200");

    r = await req("GET", "/api/positions", null, bob.token);
    assert(r.json.count === 0, "Bob sees zero positions (Alice's history doesn't leak)");

    r = await req("GET", "/api/tokens", null, bob.token);
    assert(r.json.tokens.length === 5, "Bob gets his own fresh default token list, unaffected by Alice's edits");

    r = await req("POST", "/api/wallet/connect", { privateKey: FAKE_PK_B }, bob.token);
    const bobAddress = r.json.wallet.address;
    assert(bobAddress !== aliceAddress, "Bob's connected wallet address differs from Alice's");

    r = await req("POST", "/api/trade/buy", { symbol: "ETH" }, bob.token);
    assert(r.status === 200, "Bob can buy independently of Alice");

    r = await req("GET", "/api/positions", null, alice.token);
    assert(r.json.count === 0, "Alice still shows zero open positions — Bob's buy did not leak into her account");

    console.log("\n── Wallet disconnect ──");
    r = await req("POST", "/api/wallet/disconnect", {}, bob.token);
    assert(r.status === 200, "Disconnect wallet → success");
    r = await req("GET", "/api/status", null, bob.token);
    assert(r.json.wallet.connected === false, "Status confirms wallet no longer connected");

    console.log("\n── whoami ──");
    r = await req("GET", "/api/auth/me", null, alice.token);
    assert(r.status === 200 && r.json.profile.username === "alice_trader", "GET /api/auth/me returns the right profile");
    assert(!("passwordHash" in r.json.profile), "whoami response never includes passwordHash");

    console.log("\n── Strategy CRUD over HTTP ──");
    r = await req("GET", "/api/strategies", null, alice.token);
    assert(r.status === 200 && r.json.strategies.length === 3, "GET /api/strategies seeds built-in A/B/C");
    assert(r.json.strategies.every(s => s.builtIn === true), "Seeded strategies are flagged builtIn");

    r = await req("POST", "/api/strategies", {
      name: "HTTP Custom", stopLoss: -30,
      takeProfits: [{ targetPercent: 80, sellPercent: 100 }],
    }, alice.token);
    assert(r.status === 200 && r.json.strategy.key, "Create custom strategy → 200 + auto key");
    const customKey = r.json.strategy.key;

    r = await req("POST", "/api/strategies", {
      name: "Bad Totals", stopLoss: -30,
      takeProfits: [{ targetPercent: 50, sellPercent: 40 }],
    }, alice.token);
    assert(r.status === 400, "Create with sell % not totalling 100 → 400");

    r = await req("POST", "/api/strategies/update", { key: "A", stopLoss: -35 }, alice.token);
    assert(r.status === 200 && r.json.strategy.stopLoss === -35, "Built-in strategy A is editable over HTTP");

    r = await req("POST", "/api/strategies/update", { key: "NOPE", stopLoss: -35 }, alice.token);
    assert(r.status === 400, "Updating an unknown strategy key → 400");

    r = await req("POST", "/api/settings/update", { activeStrategy: "ZZZ" }, alice.token);
    assert(r.status === 400, "Activating an unknown strategy → 400");

    r = await req("POST", "/api/settings/update", { activeStrategy: customKey }, alice.token);
    assert(r.status === 200 && r.json.settings.activeStrategy === customKey, "Activating a custom strategy → applied");

    r = await req("POST", "/api/strategies/delete", { key: customKey }, alice.token);
    assert(r.status === 400, "Cannot delete the ACTIVE strategy");

    r = await req("POST", "/api/settings/update", { activeStrategy: "A" }, alice.token);
    assert(r.status === 200, "Switch back to A");
    r = await req("POST", "/api/strategies/delete", { key: customKey }, alice.token);
    assert(r.status === 200, "Delete works once no longer active");

    console.log("\n── Entry rules (editable buy conditions) ──");
    r = await req("GET", "/api/status", null, alice.token);
    assert(r.json.settings.entryRules && Array.isArray(r.json.settings.entryRules.conditions),
      "Status exposes entryRules with conditions");
    assert(r.json.settings.entryRules.enabled === true, "Entry rules default to ENABLED (no instant buys)");

    r = await req("POST", "/api/settings/update", { entryRules: { enabled: true, logic: "ALL", conditions: [] } }, alice.token);
    assert(r.status === 400, "Empty conditions while enabled → 400");

    r = await req("POST", "/api/settings/update", { entryRules: { enabled: true, logic: "NOPE", conditions: [{ timeframe: "h1", operator: "lte", changePct: -40 }] } }, alice.token);
    assert(r.status === 400, "Bogus logic value → 400");

    r = await req("POST", "/api/settings/update", { entryRules: { enabled: true, logic: "ANY", conditions: [{ timeframe: "h1", operator: "lte", changePct: -40 }] } }, alice.token);
    assert(r.status === 200 && r.json.settings.entryRules.logic === "ANY", "Valid entry rules persist");

    r = await req("POST", "/api/scan/now", {}, alice.token);
    assert(r.status === 200 && r.json.results.opened.length === 0, "Scan with unmet entry rules opens NOTHING (mock market is flat)");
    assert(r.json.results.skipped.length > 0, "Skipped rows explain what failed");

    r = await req("POST", "/api/settings/update", { entryRules: { enabled: false, logic: "ALL", conditions: [] } }, alice.token);
    assert(r.status === 200, "Disabling entry rules is allowed (with empty conditions)");
    r = await req("POST", "/api/scan/now", {}, alice.token);
    assert(r.status === 200 && r.json.results.opened.length > 0, "With rules off, scan buys immediately (old behavior)");

    console.log("\n── Coin discovery over HTTP ──");
    r = await req("GET", "/api/discover", null, alice.token);
    assert(r.status === 200 && Array.isArray(r.json.coins), "GET /api/discover returns a coin batch");
    assert(r.json.filters && r.json.filters.minAgeDays === 30, "Default screening filters include a 30-day min age");
    assert(r.json.coins.every(c => c.ageDays === null || c.ageDays >= 30), "Every returned coin meets the min age");
    assert(r.json.coins.every(c => c.liquidityUsd >= r.json.filters.minLiquidityUsd), "Every returned coin meets min liquidity");

    r = await req("GET", "/api/discover", null, null);
    assert(r.status === 401, "Discovery requires auth");

    r = await req("POST", "/api/discover/filters", { minLiquidityUsd: 1000, minVolume24hUsd: 0, minAgeDays: 0, maxAgeDays: 0, minTxns24h: 0, minMarketCapUsd: 0, maxMarketCapUsd: 0, excludeStables: false, sortBy: "volume" }, alice.token);
    assert(r.status === 200 && r.json.filters.sortBy === "volume", "Saving custom screening filters → 200");

    r = await req("POST", "/api/discover/filters", { sortBy: "vibes" }, alice.token);
    assert(r.status === 400, "Invalid sort key rejected → 400");

    r = await req("GET", "/api/discover", null, alice.token);
    const loosened = r.json.coins.length;
    assert(loosened > 0, "Loosened filters return more coins");
    const firstCoin = r.json.coins[0];

    r = await req("POST", "/api/discover/dismiss", { contract: firstCoin.contract }, alice.token);
    assert(r.status === 200, "Dismiss ('Skip') a coin → 200");

    r = await req("GET", "/api/discover", null, alice.token);
    assert(!r.json.coins.some(c => c.contract === firstCoin.contract), "Skipped coin no longer appears in the next batch");
    assert(r.json.dismissedCount === 1, "Dismissed count is reported back");

    r = await req("POST", "/api/discover/reset", {}, alice.token);
    assert(r.status === 200, "Un-skip all → 200");
    r = await req("GET", "/api/discover", null, alice.token);
    assert(r.json.coins.some(c => c.contract === firstCoin.contract), "Un-skipped coin returns to the results");

    const enableTarget = r.json.coins[0];
    r = await req("POST", "/api/discover/enable", { contract: enableTarget.contract }, alice.token);
    assert(r.status === 200 && r.json.token.enabled === true, "Enabling a discovered coin adds it to the trading list");
    assert(r.json.token.addedVia === "discovery", "Token is tagged as added via discovery");

    r = await req("GET", "/api/discover", null, alice.token);
    assert(!r.json.coins.some(c => c.contract.toLowerCase() === enableTarget.contract.toLowerCase()),
      "Enabled coin disappears from discovery (already on the trading list)");

    r = await req("POST", "/api/discover/enable", { contract: "not-an-address" }, alice.token);
    assert(r.status === 400, "Enabling a bogus address → 400");

    console.log("\n── Discovery is per-profile ──");
    r = await req("GET", "/api/discover", null, bob.token);
    assert(r.json.dismissedCount === 0, "Bob has his own (empty) skip list — Alice's dismissals don't leak");

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
