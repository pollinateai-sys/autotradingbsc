// ============================================================
//  SWAP COOLDOWN
//  When a token's swap attempt fails on-chain (reverted tx,
//  no pool, etc.) we put it on a per-profile cooldown so the
//  bot doesn't retry every 5 seconds and waste gas on something
//  that clearly won't work right now.
//
//  Storage: in-process Map only — intentionally not persisted
//  to Redis. On server restart the cooldown clears, which is fine
//  (the token gets one more attempt after a restart before being
//  cooled down again if it still fails).
// ============================================================

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

// Map key: `${profileId}:${contractAddress.toLowerCase()}`
// Value  : { until: timestamp, reason: string }
const cooldowns = new Map();

function isCooledDown(profileId, contractAddress) {
  const key    = `${profileId}:${contractAddress.toLowerCase()}`;
  const entry  = cooldowns.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) { cooldowns.delete(key); return false; }
  return true;
}

function getCooldownReason(profileId, contractAddress) {
  const entry = cooldowns.get(`${profileId}:${contractAddress.toLowerCase()}`);
  return entry ? entry.reason : null;
}

function setCooldown(profileId, contractAddress, reason, durationMs = DEFAULT_COOLDOWN_MS) {
  const key   = `${profileId}:${contractAddress.toLowerCase()}`;
  const until = Date.now() + durationMs;
  cooldowns.set(key, { until, reason });
  const mins = Math.round(durationMs / 60000);
  console.log(`  ⏳ Cooldown set for ${contractAddress.slice(0,10)}… — skipping for ${mins} min. Reason: ${reason}`);
}

function clearCooldown(profileId, contractAddress) {
  cooldowns.delete(`${profileId}:${contractAddress.toLowerCase()}`);
}

module.exports = { isCooledDown, getCooldownReason, setCooldown, clearCooldown };
