// ============================================================
//  HTTP LAYER TESTS
//  Boots the real Express app (api/index.js) against mocks and
//  exercises it over actual HTTP — verifies routing, auth guards,
//  status codes, and the JSON contract the dashboard relies on.
//
//  Run: node test/test_http.js  (or `npm test`)
// ============================================================

require("./setup-mocks.js");
process.env.BOT_SECRET = "test_secret_for_ci";
process.env.AUTO_TRADE = "true";

const app = require("../api/index");

const PORT = 4399;
const BASE = `http://localhost:${PORT}`;
const AUTH = { "Content-Type": "application/json", "x-bot-secret": "test_secret_for_ci" };

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}

async function req(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers || { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json response */ }
  return { status: res.status, json };
}

async function main() {
  const server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 500));

  try {
    console.log("\n── Health & read endpoints ──");
    let r = await req("GET", "/api/health");
    assert(r.status === 200 && r.json.status === "ok", "GET /api/health → 200");

    r = await req("GET", "/api/status");
    assert(r.status === 200 && r.json.ok === true, "GET /api/status → ok:true");
    assert(typeof r.json.wallet.bnbBalance === "number", "status includes wallet.bnbBalance");
    assert(Array.isArray(r.json.positions), "status includes positions array");

    r = await req("GET", "/api/tokens");
    assert(r.status === 200 && r.json.tokens.length === 5, "GET /api/tokens → 5 seeded default tokens");

    r = await req("GET", "/api/settings");
    assert(r.status === 200 && r.json.strategies.length === 3, "GET /api/settings → 3 strategies (A, B, C)");

    console.log("\n── Auth guard ──");
    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }); // no auth header
    assert(r.status === 401, "POST /api/trade/buy without secret → 401");

    r = await req("POST", "/api/settings/update", { activeStrategy: "B" }, AUTH);
    assert(r.status === 200 && r.json.settings.activeStrategy === "B", "Authenticated strategy switch → 200 + applied");

    console.log("\n── Trade flow over HTTP ──");
    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, AUTH);
    assert(r.status === 200 && r.json.ok === true, "POST /api/trade/buy BTCB → success");

    r = await req("POST", "/api/trade/buy", { symbol: "BTCB" }, AUTH);
    assert(r.status === 409, "Duplicate buy on open symbol → 409");

    r = await req("GET", "/api/positions");
    assert(r.status === 200 && r.json.count === 1, "GET /api/positions reflects the open position");
    assert(r.json.positions[0].nextTpTarget === 50, "Position shows correct next TP target (Strategy B TP1=50)");

    r = await req("POST", "/api/trade/close", { symbol: "BTCB" }, AUTH);
    assert(r.status === 200 && r.json.ok === true, "POST /api/trade/close → success");

    r = await req("GET", "/api/positions");
    assert(r.json.count === 0, "Position gone after manual close");

    r = await req("GET", "/api/positions/log");
    assert(r.json.log.length === 2, "Trade log has BUY + MANUAL_CLOSE entries");

    console.log("\n── Token management over HTTP ──");
    const fakeAddr = "0x9999999999999999999999999999999999999999";
    r = await req("POST", "/api/tokens/add", { contract: fakeAddr }, AUTH);
    assert(r.status === 200 && r.json.ok === true, "POST /api/tokens/add with valid address → success");

    r = await req("POST", "/api/tokens/toggle", { symbol: "NEWTKN", enabled: false }, AUTH);
    assert(r.status === 200 && r.json.token.enabled === false, "Toggle token off → enabled:false");

    r = await req("POST", "/api/tokens/remove", { symbol: "NEWTKN" }, AUTH);
    assert(r.status === 200, "Remove token → success");

    r = await req("GET", "/api/tokens");
    assert(r.json.tokens.length === 5, "Token list back to 5 after removal");

    console.log("\n── Bot start/stop ──");
    r = await req("POST", "/api/settings/start", {}, AUTH);
    assert(r.json.settings.botRunning === true, "POST /api/settings/start → botRunning:true");
    r = await req("POST", "/api/settings/stop", {}, AUTH);
    assert(r.json.settings.botRunning === false, "POST /api/settings/stop → botRunning:false");

    console.log("\n── Static dashboard ──");
    r = await fetch(BASE + "/");
    assert(r.status === 200, "GET / serves the dashboard");
    const html = await r.text();
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
