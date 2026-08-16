// ============================================================
//  DIRECT LOGIC TESTS
//  Exercises the strategy engine straight against the mocks —
//  no HTTP layer. Verifies the actual money-math is correct:
//  multi-TP ladder sell amounts, stop loss trigger, and the
//  resulting BNB balance after a full cycle.
//
//  Run: node test/test_direct.js  (or `npm test`)
// ============================================================

const mocks = require("./setup-mocks.js");
process.env.AUTO_TRADE = "true";

const { openPosition, checkAndExecuteExits } = require("../api/lib/strategy");
const { updateSettings } = require("../api/lib/redis");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}
function approx(a, b, eps = 0.001) { return Math.abs(a - b) < eps; }

async function testFullTpLadder() {
  console.log("\n── Strategy A: full TP1→TP4 ladder ──");
  await updateSettings({ activeStrategy: "A", bankrollPercent: 1.0 });
  mocks.wallet._setBnbBalance(10.0);

  const token = { symbol: "BTCB", contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" };
  mocks.swap._setPrice(token.contract, 0.0001);

  const pos = await openPosition(token);
  assert(approx(pos.bnbSpent, 0.1), `Buy spent 1% of 10 BNB = 0.1 BNB (got ${pos.bnbSpent})`);
  assert(pos.totalTokens === 1000, `Received 1000 tokens at entry price (got ${pos.totalTokens})`);

  const steps = [
    { pct: 55,  expectAction: "TP1", expectSell: 25 },
    { pct: 105, expectAction: "TP2", expectSell: 25 },
    { pct: 210, expectAction: "TP3", expectSell: 25 },
    { pct: 410, expectAction: "TP4", expectSell: 25 },
  ];
  for (const step of steps) {
    mocks.swap._setPrice(token.contract, 0.0001 * (1 + step.pct / 100));
    const result = await checkAndExecuteExits("BTCB");
    assert(result && result.action === step.expectAction,
      `Price +${step.pct}% triggers ${step.expectAction} (got ${result?.action})`);
    assert(result && result.sellPct === step.expectSell,
      `${step.expectAction} sells ${step.expectSell}% of original position (got ${result?.sellPct}%)`);
  }

  const finalBalance = await mocks.wallet.getBnbBalance();
  assert(approx(finalBalance, 10.195, 0.0001),
    `Final BNB balance after full TP ladder ≈ 10.195 (got ${finalBalance})`);

  const { getPosition } = require("../api/lib/redis");
  const closedPos = await getPosition("BTCB");
  assert(closedPos === null, "Position is fully closed after TP4 (no leftover)");
}

async function testStopLoss() {
  console.log("\n── Strategy A: stop loss ──");
  await updateSettings({ activeStrategy: "A", bankrollPercent: 1.0 });

  const token = { symbol: "ETH", contract: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" };
  mocks.swap._setPrice(token.contract, 0.0001);

  const pos = await openPosition(token);
  mocks.swap._setPrice(token.contract, 0.0001 * 0.55); // -45%, past -40% threshold

  const result = await checkAndExecuteExits("ETH");
  assert(result && result.action === "STOP_LOSS", `-45% move triggers STOP_LOSS (got ${result?.action})`);
  assert(approx(result.changePct, -45, 0.5), `Reported change ≈ -45% (got ${result.changePct})`);

  const { getPosition } = require("../api/lib/redis");
  assert((await getPosition("ETH")) === null, "Position fully closed after stop loss");
}

async function testNoPrematureExit() {
  console.log("\n── Strategy A: no exit before any threshold ──");
  const token = { symbol: "LINK", contract: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD" };
  mocks.swap._setPrice(token.contract, 0.0001);
  await openPosition(token);

  mocks.swap._setPrice(token.contract, 0.0001 * 1.20); // +20%, below TP1 (+50%)
  const result = await checkAndExecuteExits("LINK");
  assert(result && result.action === "HOLD", `+20% (below TP1) results in HOLD (got ${result?.action})`);

  const { getPosition } = require("../api/lib/redis");
  const pos = await getPosition("LINK");
  assert(pos && pos.remainingTokens === pos.totalTokens, "No tokens sold prematurely");
}

async function testDuplicateTpNotDoubleFired() {
  console.log("\n── Strategy A: same TP does not fire twice ──");
  const token = { symbol: "DOT", contract: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402" };
  mocks.swap._setPrice(token.contract, 0.0001);
  await openPosition(token);

  mocks.swap._setPrice(token.contract, 0.0001 * 1.55); // +55%, fires TP1
  const first = await checkAndExecuteExits("DOT");
  assert(first.action === "TP1", "First check at +55% fires TP1");

  // Price stays in the same +55% band — TP1 must not fire again
  const second = await checkAndExecuteExits("DOT");
  assert(second.action === "HOLD", `Re-check at same price does not re-fire TP1 (got ${second.action})`);
}

async function main() {
  await testFullTpLadder();
  await testStopLoss();
  await testNoPrematureExit();
  await testDuplicateTpNotDoubleFired();

  console.log("\n" + "─".repeat(50));
  if (failures === 0) {
    console.log(`✅ ALL DIRECT LOGIC TESTS PASSED`);
    process.exit(0);
  } else {
    console.log(`❌ ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
}

main().catch(e => { console.error("❌ Test crashed:", e); process.exit(1); });
