// ============================================================
//  PROFILE STRATEGIES — per-profile, fully editable SL/TP ladders
//
//  Strategies used to be hardcoded A/B/C in config/strategies.js.
//  They're now per-profile data stored in Redis
//  (profile:<id>:strategies), seeded from those built-ins on
//  first read. From the dashboard a person can:
//    · edit ANY strategy's stop loss / take-profit ladder
//    · create brand new strategies
//    · delete strategies (guarded: not while active, and not
//      while an open position is following it)
//
//  Validation is strict because these numbers move real money:
//  SL between -95% and 0%, 1–6 TP levels, ascending targets,
//  sell percentages totalling exactly 100%.
// ============================================================

const crypto = require("crypto");
const { STRATEGIES: DEFAULT_STRATEGIES } = require("../config/strategies");
const {
  getStrategies: readRawStrategies,
  saveStrategies,
  getSettings,
  getPositions,
} = require("./redis");

const MAX_STRATEGIES = 12;
const MAX_TP_LEVELS  = 6;

// ── Validation (pure) ────────────────────────────────────────
function validateStrategy(input) {
  if (!input || typeof input !== "object") throw new Error("Strategy must be an object");

  const name = String(input.name || "").trim();
  if (name.length < 2 || name.length > 48) {
    throw new Error("Strategy name must be 2–48 characters");
  }

  const stopLoss = Number(input.stopLoss);
  if (!isFinite(stopLoss) || stopLoss > 0 || stopLoss < -95) {
    throw new Error("Stop loss must be between -95% and 0% (e.g. -40)");
  }

  if (!Array.isArray(input.takeProfits) || input.takeProfits.length < 1) {
    throw new Error("Add at least one take-profit level");
  }
  if (input.takeProfits.length > MAX_TP_LEVELS) {
    throw new Error(`Maximum ${MAX_TP_LEVELS} take-profit levels`);
  }

  const takeProfits = input.takeProfits.map((tp, i) => {
    const targetPercent = Number(tp && tp.targetPercent);
    const sellPercent   = Number(tp && tp.sellPercent);
    if (!isFinite(targetPercent) || targetPercent <= 0 || targetPercent > 10000) {
      throw new Error(`TP${i + 1}: target must be above 0% (and below 10000%)`);
    }
    if (!isFinite(sellPercent) || sellPercent <= 0 || sellPercent > 100) {
      throw new Error(`TP${i + 1}: sell % must be between 0 and 100`);
    }
    return { targetPercent, sellPercent };
  });

  for (let i = 1; i < takeProfits.length; i++) {
    if (takeProfits[i].targetPercent <= takeProfits[i - 1].targetPercent) {
      throw new Error("Take-profit targets must be in ascending order");
    }
  }

  const total = takeProfits.reduce((s, tp) => s + tp.sellPercent, 0);
  if (Math.abs(total - 100) > 0.0001) {
    throw new Error(`Take-profit sell percentages must total exactly 100% (currently ${Math.round(total * 100) / 100}%)`);
  }

  return { name, stopLoss, takeProfits };
}

// ── Storage ──────────────────────────────────────────────────
function seedDefaults() {
  return Object.entries(DEFAULT_STRATEGIES).map(([key, s]) => ({
    key,
    name:        s.name,
    stopLoss:    s.stopLoss,
    takeProfits: s.takeProfits.map(tp => ({ ...tp })),
    builtIn:     true,
  }));
}

/** All strategies for a profile — seeds the built-in defaults on first read. */
async function getStrategies(profileId) {
  const saved = await readRawStrategies(profileId);
  if (saved === null) {
    const seeded = seedDefaults();
    await saveStrategies(profileId, seeded);
    return seeded;
  }
  return saved;
}

async function getStrategyByKey(profileId, key) {
  const list = await getStrategies(profileId);
  const found = list.find(s => s.key === key);
  if (!found) throw new Error(`Strategy "${key}" not found.`);
  return found;
}

/**
 * Which strategy should an existing position follow?
 * Normally the one it was opened with (position.strategyKey).
 * If that strategy no longer resolves for any reason, fall back
 * to the profile's currently active strategy instead of
 * abandoning the position.
 */
async function resolvePositionStrategy(profileId, position, settings) {
  try {
    return await getStrategyByKey(profileId, position.strategyKey || settings.activeStrategy);
  } catch {
    return await getStrategyByKey(profileId, settings.activeStrategy);
  }
}

// ── CRUD ─────────────────────────────────────────────────────
function newKey() { return "S" + crypto.randomBytes(3).toString("hex").toUpperCase(); }

async function createStrategy(profileId, input) {
  const list = await getStrategies(profileId);
  if (list.length >= MAX_STRATEGIES) {
    throw new Error(`Maximum ${MAX_STRATEGIES} strategies per profile — delete one first`);
  }
  const def = validateStrategy(input);
  let key = newKey();
  while (list.some(s => s.key === key)) key = newKey();
  const strategy = { key, ...def, builtIn: false };
  list.push(strategy);
  await saveStrategies(profileId, list);
  return strategy;
}

async function updateStrategy(profileId, key, patch) {
  const list = await getStrategies(profileId);
  const idx  = list.findIndex(s => s.key === key);
  if (idx === -1) throw new Error(`Strategy "${key}" not found.`);

  const merged = {
    name:        patch.name        !== undefined ? patch.name        : list[idx].name,
    stopLoss:    patch.stopLoss    !== undefined ? patch.stopLoss    : list[idx].stopLoss,
    takeProfits: patch.takeProfits !== undefined ? patch.takeProfits : list[idx].takeProfits,
  };
  const def = validateStrategy(merged);
  list[idx] = { ...list[idx], ...def };
  await saveStrategies(profileId, list);
  return list[idx];
}

async function deleteStrategy(profileId, key) {
  const list = await getStrategies(profileId);
  const idx  = list.findIndex(s => s.key === key);
  if (idx === -1) throw new Error(`Strategy "${key}" not found.`);
  if (list.length === 1) throw new Error("You must keep at least one strategy");

  const settings = await getSettings(profileId);
  if (settings.activeStrategy === key) {
    throw new Error(`"${list[idx].name}" is your active strategy — switch to another one first`);
  }

  const positions = await getPositions(profileId);
  const inUse = Object.values(positions).find(p => p.strategyKey === key);
  if (inUse) {
    throw new Error(`"${list[idx].name}" is being followed by your open ${inUse.symbol} position — close that position first`);
  }

  const [removed] = list.splice(idx, 1);
  await saveStrategies(profileId, list);
  return removed;
}

module.exports = {
  MAX_STRATEGIES, MAX_TP_LEVELS,
  validateStrategy,
  getStrategies, getStrategyByKey, resolvePositionStrategy,
  createStrategy, updateStrategy, deleteStrategy,
};
