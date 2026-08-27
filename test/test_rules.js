// ============================================================
//  STRATEGY + ENTRY RULES TESTS
//  Covers the two editable engines added on top of the bot:
//   1. Per-profile strategies — validation, CRUD, delete guards,
//      and a full trade driven by a CUSTOM strategy (proving the
//      engine follows user-built ladders, not just built-ins).
//   2. Entry rules — validation + evaluation logic, and the
//      scanner gating: no more instant buys unless conditions
//      pass (or the rules are switched off).
//
//  Run: node test/test_rules.js  (or `npm test`)
// ============================================================

const mocks = require("./setup-mocks.js");
process.env.AUTO_TRADE = "true";

const {
  validateStrategy, getStrategies, createStrategy, updateStrategy, deleteStrategy,
} = require("../api/lib/strategies");
const {
  DEFAULT_ENTRY_RULES, validateEntryRules, evaluateEntryRules,
} = require("../api/lib/entryrules");
const { openPosition, checkAndExecuteExits } = require("../api/lib/strategy");
const { scanForNewEntries } = require("../api/lib/scanner");
const { registerProfile, updateSettings, getPositions } = require("../api/lib/redis");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}

const PK = "3333333333333333333333333333333333333333333333333333333333333333".slice(0, 64);

async function makeProfile(username) {
  const { profile } = await registerProfile(username, `password-for-${username}-${Date.now()}`);
  await mocks.wallet.connectWallet(profile.id, PK);
  mocks.wallet._setBnbBalance(profile.id, 10.0);
  return profile.id;
}

// ── 1. Strategy validation ─────────────────────────────────
function testStrategyValidation() {
  console.log("\n── Strategy validation ──");
  const good = validateStrategy({
    name: "My Ladder", stopLoss: -30,
    takeProfits: [{ targetPercent: 50, sellPercent: 50 }, { targetPercent: 100, sellPercent: 50 }],
  });
  assert(good.name === "My Ladder" && good.takeProfits.length === 2, "Valid strategy passes validation");

  const badCases = [
    [{ name: "x", stopLoss: -30, takeProfits: [{ targetPercent: 50, sellPercent: 100 }] }, "name too short"],
    [{ name: "Bad SL positive", stopLoss: 5, takeProfits: [{ targetPercent: 50, sellPercent: 100 }] }, "positive stop loss"],
    [{ name: "Bad SL deep", stopLoss: -99, takeProfits: [{ targetPercent: 50, sellPercent: 100 }] }, "stop loss beyond -95"],
    [{ name: "Empty TPs", stopLoss: -30, takeProfits: [] }, "no TP levels"],
    [{ name: "Bad total", stopLoss: -30, takeProfits: [{ targetPercent: 50, sellPercent: 60 }] }, "sell % not totalling 100"],
    [{ name: "Not ascending", stopLoss: -30, takeProfits: [{ targetPercent: 100, sellPercent: 50 }, { targetPercent: 50, sellPercent: 50 }] }, "descending TP targets"],
  ];
  for (const [input, label] of badCases) {
    let threw = false;
    try { validateStrategy(input); } catch { threw = true; }
    assert(threw, `Rejected: ${label}`);
  }
}

// ── 2. Strategy CRUD + guards (per profile, mocked Redis) ──
async function testStrategyCrud() {
  console.log("\n── Strategy CRUD (per profile) ──");
  const id = await makeProfile("CrudUser");

  const list = await getStrategies(id);
  assert(list.length === 3 && list.every(s => s.builtIn), "New profile is seeded with built-in A/B/C");

  const custom = await createStrategy(id, {
    name: "Dip Catcher", stopLoss: -20,
    takeProfits: [{ targetPercent: 80, sellPercent: 100 }],
  });
  assert(/^S[0-9A-F]{6}$/.test(custom.key), `Custom strategy gets an auto key (got ${custom.key})`);
  assert((await getStrategies(id)).length === 4, "List grows to 4 after create");

  const edited = await updateStrategy(id, "A", { stopLoss: -35 });
  assert(edited.stopLoss === -35 && edited.builtIn === true, "Built-in strategy A is editable (SL → -35)");

  await updateSettings(id, { activeStrategy: custom.key });
  let threw = false;
  try { await deleteStrategy(id, custom.key); } catch (e) { threw = /active strategy/.test(e.message); }
  assert(threw, "Cannot delete the ACTIVE strategy");

  await updateSettings(id, { activeStrategy: "B" });
  const { openPosition } = require("../api/lib/strategy");
  mocks.swap._setPrice("0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", 0.0001);
  await updateSettings(id, { activeStrategy: custom.key });
  await openPosition(id, { symbol: "BTCB", contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" }); // opened under custom.key
  await updateSettings(id, { activeStrategy: "B" });
  threw = false;
  try { await deleteStrategy(id, custom.key); } catch (e) { threw = /open BTCB position/.test(e.message); }
  assert(threw, "Cannot delete a strategy in use by an open position");

  // Clean up: close the open position so later scanner tests are unaffected
  const { deletePosition } = require("../api/lib/redis");
  await deletePosition(id, "BTCB");
  await deleteStrategy(id, custom.key);
  assert((await getStrategies(id)).length === 3, "Delete works once guards pass (back to 3)");
}

// ── 3. Entry rules validation + evaluation ─────────────────
function testEntryRules() {
  console.log("\n── Entry rules validation ──");
  const ok = validateEntryRules(DEFAULT_ENTRY_RULES);
  assert(ok.enabled && ok.conditions.length === 2, "Default dip-buy rule set validates");

  let threw = false;
  try { validateEntryRules({ enabled: true, logic: "ALL", conditions: [] }); } catch { threw = true; }
  assert(threw, "Empty conditions rejected while rules are enabled");

  threw = false;
  try { validateEntryRules({ enabled: false, logic: "ALL", conditions: [] }); } catch { threw = true; }
  assert(!threw, "Empty conditions allowed when rules are disabled");

  threw = false;
  try { validateEntryRules({ enabled: true, logic: "SOMETIMES" , conditions: [{ timeframe: "h1", operator: "lte", changePct: -40 }] }); } catch { threw = true; }
  assert(threw, "Bogus logic value rejected");

  threw = false;
  try { validateEntryRules({ enabled: true, logic: "ALL", conditions: [{ timeframe: "w1", operator: "lte", changePct: -40 }] }); } catch { threw = true; }
  assert(threw, "Unknown timeframe rejected");

  console.log("\n── Entry rules evaluation ──");
  const dumped = { change5m: -12, change1h: -47.5, change6h: -30, change24h: 180 };
  const pumped = { change5m: 3, change1h: 6.2, change6h: 25, change24h: 250 };
  const dead   = { change5m: -2, change1h: -45, change6h: -70, change24h: -80 };

  const gate1 = evaluateEntryRules(DEFAULT_ENTRY_RULES, dumped);
  assert(gate1.pass === true, "Runner that dumped 47% in 1h PASSES the default dip-buy rules");

  const gate2 = evaluateEntryRules(DEFAULT_ENTRY_RULES, pumped);
  assert(gate2.pass === false, "Coin still pumping (no dip) does NOT pass — no more instant buy");
  assert(gate2.summary.includes("1h"), "Skip summary explains which condition failed");

  const gate3 = evaluateEntryRules(DEFAULT_ENTRY_RULES, dead);
  assert(gate3.pass === false, "Coin down 80% over 24h (dumped but not a runner) does NOT pass");

  const any = evaluateEntryRules(
    { enabled: true, logic: "ANY", conditions: [{ timeframe: "h1", operator: "lte", changePct: -40 }, { timeframe: "h24", operator: "gte", changePct: 100 }] },
    pumped
  );
  assert(any.pass === true, "ANY logic passes when one of two conditions holds");

  const off = evaluateEntryRules({ enabled: false, logic: "ALL", conditions: [] }, pumped);
  assert(off.pass === true, "Disabled rules always pass (old instant-buy behavior)");
}

// ── 4. A CUSTOM strategy drives a real trade end-to-end ────
async function testCustomStrategyTrade() {
  console.log("\n── Custom strategy drives the trade engine ──");
  const id = await makeProfile("CustomStrat");
  const custom = await createStrategy(id, {
    name: "Quick Scalp", stopLoss: -15,
    takeProfits: [
      { targetPercent: 50, sellPercent: 60 },
      { targetPercent: 100, sellPercent: 40 },
    ],
  });
  await updateSettings(id, { activeStrategy: custom.key, bankrollPercent: 1.0 });

  const token = { symbol: "ETH", contract: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" };
  mocks.swap._setPrice(token.contract, 0.0001);
  const pos = await openPosition(id, token);
  assert(pos.strategyKey === custom.key, "Position snapshots the custom strategy key");

  mocks.swap._setPrice(token.contract, 0.0001 * 1.6); // +60% → TP1 (+50%, sell 60%)
  const tp1 = await checkAndExecuteExits(id, "ETH");
  assert(tp1 && tp1.action === "TP1" && tp1.sellPct === 60, `Custom TP1 fires at +50% selling 60% (got ${tp1 && tp1.action}/${tp1 && tp1.sellPct}%)`);

  mocks.swap._setPrice(token.contract, 0.0001 * 2.2); // +120% → TP2 (+100%, sell 40%) → all done
  const tp2 = await checkAndExecuteExits(id, "ETH");
  assert(tp2 && tp2.action === "TP2", "Custom TP2 fires at +100%");
  const positions = await getPositions(id);
  assert(!positions.ETH, "Position fully closed after final custom TP");
}

// ── 5. Scanner gating — the "no more instant buys" fix ─────
async function testScannerGating() {
  console.log("\n── Scanner respects entry rules ──");
  const id = await makeProfile("GateUser");
  // Mock market (mocks/market.js): change1h +1.2, change24h +4.5 —
  // neither a ≥40% 1h dump nor a ≥100% 24h runner → every token must be skipped
  const blocked = await scanForNewEntries(id);
  assert(blocked.opened.length === 0, "Default rules block ALL instant buys on flat market data");
  assert(blocked.skipped.length > 0 && blocked.skipped.every(s => /entry setup|Max open/i.test(s.reason)),
    "Skips carry a 'waiting for entry setup' explanation");
  assert(Object.keys(await getPositions(id)).length === 0, "No positions opened while gated");

  // Turn rules OFF → old behavior returns
  await updateSettings(id, { entryRules: { enabled: false, logic: "ALL", conditions: [] } });
  const free = await scanForNewEntries(id);
  assert(free.opened.length > 0, "With rules disabled, the scanner buys immediately again (old behavior)");

  // Rules ON but market now matches the dip-buy pattern → buys
  const id2 = await makeProfile("GateUser2");
  mocks.market._setChanges(-45, 150); // 1h -45%, 24h +150% → matches default rules
  const dip = await scanForNewEntries(id2);
  assert(dip.opened.length > 0, "Rules pass on a 1h -45% / 24h +150% dip → buys happen");
  mocks.market._setChanges(null, null); // restore defaults for other tests
}

async function main() {
  testStrategyValidation();
  await testStrategyCrud();
  testEntryRules();
  await testCustomStrategyTrade();
  await testScannerGating();

  console.log("\n" + "─".repeat(50));
  if (failures === 0) { console.log("✅ ALL STRATEGY/RULES TESTS PASSED"); process.exit(0); }
  else { console.log(`❌ ${failures} TEST(S) FAILED`); process.exit(1); }
}

main().catch(e => { console.error("❌ Test crashed:", e); process.exit(1); });
