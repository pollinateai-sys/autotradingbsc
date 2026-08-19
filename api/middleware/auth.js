// ============================================================
//  AUTH MIDDLEWARE
//  Every request carries the person's session token in the
//  `x-api-key` header (issued once at login, never expires).
//  We hash it, look up which profile it belongs to, and attach
//  req.profileId / req.profileMeta for every route downstream.
// ============================================================

const { getProfileIdByToken, getProfileMeta } = require("../lib/redis");

async function requireProfile(req, res, next) {
  const token = req.headers["x-api-key"];
  if (!token) {
    return res.status(401).json({ ok: false, error: "Not signed in" });
  }
  try {
    const profileId = await getProfileIdByToken(token);
    if (!profileId) {
      return res.status(401).json({ ok: false, error: "Session not recognized — please log in again" });
    }
    req.profileId   = profileId;
    req.profileMeta = await getProfileMeta(profileId);
    next();
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

module.exports = { requireProfile };
