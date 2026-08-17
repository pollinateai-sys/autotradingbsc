// ============================================================
//  AUTH MIDDLEWARE
//  Every request carries the person's own API key in the
//  `x-api-key` header. We hash it, look up which profile it
//  belongs to, and attach req.profileId / req.profileMeta for
//  every route downstream. No separate login/session step —
//  the key itself is the credential, same pattern as any
//  standard API key (present it, or you're not authenticated).
// ============================================================

const { getProfileIdByApiKey, getProfileMeta } = require("../lib/redis");

async function requireProfile(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey) {
    return res.status(401).json({ ok: false, error: "Missing x-api-key header" });
  }
  try {
    const profileId = await getProfileIdByApiKey(apiKey);
    if (!profileId) {
      return res.status(401).json({ ok: false, error: "Invalid API key" });
    }
    req.profileId   = profileId;
    req.profileMeta = await getProfileMeta(profileId);
    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = { requireProfile };
