// ============================================================
//  ENTRY RULES — the editable "when to buy" engine
//
//  Before this, the scanner bought a token the moment it passed
//  the liquidity check (so starting the bot = instant buys).
//  Now each profile has its own entry rule set, stored in its
//  settings and editable from the dashboard:
//
//    {
//      enabled: true,          // false = buy immediately (old behavior)
//      logic: "ALL" | "ANY",   // must every condition pass, or just one?
//      conditions: [
//        { timeframe: "h1",  operator: "lte", changePct: -40 },
//        { timeframe: "h24", operator: "gte", changePct: 100 },
//      ]
//    }
//
//  Condition values come from DexScreener's priceChange fields
//  (5m / 1h / 6h / 24h % moves) via lib/market.js — no extra
//  API calls are needed, the scanner already fetches them.
//
//  Everything in this file is pure (no I/O) so it can be unit
//  tested directly.
// ============================================================

const TIMEFRAMES = {
  m5:  { field: "change5m",  label: "5m"  },
  h1:  { field: "change1h",  label: "1h"  },
  h6:  { field: "change6h",  label: "6h"  },
  h24: { field: "change24h", label: "24h" },
};

const OPERATORS = {
  lt:  { symbol: "<", test: (a, b) => a <  b },
  lte: { symbol: "≤", test: (a, b) => a <= b },
  gt:  { symbol: ">", test: (a, b) => a >  b },
  gte: { symbol: "≥", test: (a, b) => a >= b },
};

// Default: classic dip-buy on a runner. The token must have
// DUMPED at least 40% in the last hour AND still be UP at least
// 100% over 24h (so we're buying a violent dip on something
// with real momentum, not a dying coin). Fully editable per
// profile from the dashboard.
const DEFAULT_ENTRY_RULES = {
  enabled: true,
  logic: "ALL",
  conditions: [
    { timeframe: "h1",  operator: "lte", changePct: -40 },
    { timeframe: "h24", operator: "gte", changePct: 100 },
  ],
};

/** Validate + normalize an entryRules object from the API. Throws on bad input. */
function validateEntryRules(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("entryRules must be an object { enabled, logic, conditions[] }");
  }
  const enabled = input.enabled !== undefined ? !!input.enabled : true;
  const logic   = String(input.logic || "ALL").toUpperCase();
  if (logic !== "ALL" && logic !== "ANY") {
    throw new Error('Entry logic must be "ALL" (every condition) or "ANY" (at least one)');
  }
  if (!Array.isArray(input.conditions)) {
    throw new Error("entryRules.conditions must be an array");
  }
  if (enabled && input.conditions.length === 0) {
    throw new Error("Add at least one condition — or turn entry rules off to buy immediately");
  }
  if (input.conditions.length > 5) throw new Error("Maximum 5 entry conditions");

  const conditions = input.conditions.map((c, i) => {
    const tf  = String((c && c.timeframe) || "");
    const op  = String((c && c.operator) || "");
    const val = Number(c && c.changePct);
    if (!TIMEFRAMES[tf]) {
      throw new Error(`Condition ${i + 1}: timeframe must be one of ${Object.keys(TIMEFRAMES).join(", ")}`);
    }
    if (!OPERATORS[op]) {
      throw new Error(`Condition ${i + 1}: operator must be one of lt, lte, gt, gte`);
    }
    if (!isFinite(val) || val < -100 || val > 100000) {
      throw new Error(`Condition ${i + 1}: change % must be between -100 and 100000`);
    }
    return { timeframe: tf, operator: op, changePct: val };
  });

  return { enabled, logic, conditions };
}

/**
 * Evaluate a rule set against a token's market info (from lib/market.js).
 * Returns { pass, summary, checks[] } — checks are human-readable so the
 * dashboard / scan results can show exactly why a token was skipped.
 */
function evaluateEntryRules(rules, info) {
  const r = (rules && Array.isArray(rules.conditions)) ? rules : DEFAULT_ENTRY_RULES;

  if (!r.enabled) {
    return { pass: true, summary: "Entry rules off — buying immediately", checks: [] };
  }
  if (!info) {
    return { pass: false, summary: "no market data to evaluate entry rules", checks: [] };
  }

  const checks = r.conditions.map(c => {
    const tf = TIMEFRAMES[c.timeframe] || { field: null, label: c.timeframe };
    const op = OPERATORS[c.operator];
    const actual = (tf.field && info[tf.field] != null && isFinite(Number(info[tf.field])))
      ? Number(info[tf.field])
      : null;
    const ok = actual !== null && !!op && op.test(actual, c.changePct);
    const actualText = actual === null ? "n/a" : `${actual > 0 ? "+" : ""}${actual.toFixed(1)}%`;
    return {
      label: `${tf.label} change`,
      actual,
      required: c.changePct,
      operator: c.operator,
      ok,
      text: `${tf.label} ${actualText} (needs ${op ? op.symbol : c.operator} ${c.changePct}%)`,
    };
  });

  const pass = r.logic === "ANY" ? checks.some(c => c.ok) : checks.every(c => c.ok);
  const summary = checks.map(c => `${c.ok ? "✓" : "✗"} ${c.text}`).join(" · ");
  return { pass, summary, checks };
}

module.exports = { TIMEFRAMES, OPERATORS, DEFAULT_ENTRY_RULES, validateEntryRules, evaluateEntryRules };
