// ============================================================
//  DIRECT LOGIC TESTS
//  Exercises the strategy engine straight against the mocks —
//  no HTTP layer. Verifies the actual money-math is correct:
//  multi-TP ladder sell amounts, stop loss trigger, and the
//  resulting BNB balance after a full cycle — now scoped to a
//  real profile with a connected mock wallet, since all of this
//  is profile-aware after the multi-user rework.
//
//  Run: node test/test_direct.js  (or `npm test`)
// ============================================================

const mocks = require("./setup-mocks.js");
process.env.AUTO_TRADE = "true";

const { openPosition, checkAndExecuteExits } = require("../api/lib/strategy");
const { updateSettings, registerProfile, getPosition } = require("../api/lib/redis");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}
function approx(a, b, eps = 0.001) { return Math.abs(a - b) < eps; }

async function makeProfile(username) {
  const { profile } = await registerProfile(username, `password-for-${username}-${Date.now()}`);
  await mocks.wallet.connectWallet(profile.id, "1111111111111111111111111111111111111111111111111111111111111111".slice(0, 64));
  mocks.wallet._setBnbBalance(profile.id, 10.0);
  return profile.id;
}

async function testFullTpLadder() {
  console.log("\n── Strategy A: full TP1→TP4 ladder ──");
  const profileId = await makeProfile("Alice");
  await updateSettings(profileId, { activeStrategy: "A", bankrollPercent: 1.0 });

  const token = { symbol: "BTCB", contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" };
  mocks.swap._setPrice(token.contract, 0.0001);

  const pos = await openPosition(profileId, token);
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
    const result = await checkAndExecuteExits(profileId, "BTCB");
    assert(result && result.action === step.expectAction,
      `Price +${step.pct}% triggers ${step.expectAction} (got ${result?.action})`);
    assert(result && result.sellPct === step.expectSell,
      `${step.expectAction} sells ${step.expectSell}% of original position (got ${result?.sellPct}%)`);
  }

  const finalBalance = await mocks.wallet.getBnbBalance(profileId);
  assert(approx(finalBalance, 10.195, 0.0001),
    `Final BNB balance after full TP ladder ≈ 10.195 (got ${finalBalance})`);

  const closedPos = await getPosition(profileId, "BTCB");
  assert(closedPos === null, "Position is fully closed after TP4 (no leftover)");
}

async function testStopLoss() {
  console.log("\n── Strategy A: stop loss ──");
  const profileId = await makeProfile("Bob");
  await updateSettings(profileId, { activeStrategy: "A", bankrollPercent: 1.0 });

  const token = { symbol: "ETH", contract: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" };
  mocks.swap._setPrice(token.contract, 0.0001);

  await openPosition(profileId, token);
  mocks.swap._setPrice(token.contract, 0.0001 * 0.55); // -45%, past -40% threshold

  const result = await checkAndExecuteExits(profileId, "ETH");
  assert(result && result.action === "STOP_LOSS", `-45% move triggers STOP_LOSS (got ${result?.action})`);
  assert(approx(result.changePct, -45, 0.5), `Reported change ≈ -45% (got ${result.changePct})`);
  assert((await getPosition(profileId, "ETH")) === null, "Position fully closed after stop loss");
}

async function testNoPrematureExit() {
  console.log("\n── Strategy A: no exit before any threshold ──");
  const profileId = await makeProfile("Carol");
  const token = { symbol: "LINK", contract: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD" };
  mocks.swap._setPrice(token.contract, 0.0001);
  await openPosition(profileId, token);

  mocks.swap._setPrice(token.contract, 0.0001 * 1.20); // +20%, below TP1 (+50%)
  const result = await checkAndExecuteExits(profileId, "LINK");
  assert(result && result.action === "HOLD", `+20% (below TP1) results in HOLD (got ${result?.action})`);

  const pos = await getPosition(profileId, "LINK");
  assert(pos && pos.remainingTokens === pos.totalTokens, "No tokens sold prematurely");
}

async function testDuplicateTpNotDoubleFired() {
  console.log("\n── Strategy A: same TP does not fire twice ──");
  const profileId = await makeProfile("Dave");
  const token = { symbol: "DOT", contract: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402" };
  mocks.swap._setPrice(token.contract, 0.0001);
  await openPosition(profileId, token);

  mocks.swap._setPrice(token.contract, 0.0001 * 1.55); // +55%, fires TP1
  const first = await checkAndExecuteExits(profileId, "DOT");
  assert(first.action === "TP1", "First check at +55% fires TP1");

  const second = await checkAndExecuteExits(profileId, "DOT");
  assert(second.action === "HOLD", `Re-check at same price does not re-fire TP1 (got ${second.action})`);
}

async function testProfileIsolation() {
  console.log("\n── Two profiles never see each other's positions or balances ──");
  const aliceId = await makeProfile("Isolation-Alice");
  const bobId   = await makeProfile("Isolation-Bob");

  const token = { symbol: "ADA", contract: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47" };
  mocks.swap._setPrice(token.contract, 0.0001);

  await openPosition(aliceId, token);
  const alicePos = await getPosition(aliceId, "ADA");
  const bobPos   = await getPosition(bobId, "ADA");

  assert(alicePos !== null, "Alice's position exists");
  assert(bobPos === null, "Bob has no position — Alice's buy did not leak into Bob's account");

  const aliceBalance = await mocks.wallet.getBnbBalance(aliceId);
  const bobBalance   = await mocks.wallet.getBnbBalance(bobId);
  assert(aliceBalance < 10.0, "Alice's balance decreased after her buy");
  assert(bobBalance === 10.0, "Bob's balance is untouched by Alice's trade");
}

async function testNoWalletBlocksTrading() {
  console.log("\n── Opening a position without a connected wallet fails clearly ──");
  const { profile } = await registerProfile("NoWallet", `no-wallet-password-${Date.now()}`);
  const token = { symbol: "BTCB", contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" };

  let threw = false, message = "";
  try { await openPosition(profile.id, token); }
  catch (e) { threw = true; message = e.message; }

  assert(threw, "openPosition() throws when no wallet is connected for this profile");
  assert(message.toLowerCase().includes("wallet"), `Error message mentions the wallet (got: "${message}")`);
}

async function main() {
  await testFullTpLadder();
  await testStopLoss();
  await testNoPrematureExit();
  await testDuplicateTpNotDoubleFired();
  await testProfileIsolation();
  await testNoWalletBlocksTrading();

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
