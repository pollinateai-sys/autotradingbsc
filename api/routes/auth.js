// ============================================================
//  AUTH ROUTES — username + password, nothing else.
//  POST /api/auth/register → { username, password } → new profile
//  POST /api/auth/login    → { username, password } → existing profile
//  GET  /api/auth/me       → whoami (requires x-api-key)
//
//  Both register and login return a session token that never
//  expires — the browser stores it and stays signed in forever,
//  across restarts, until the person taps "Log out".
// ============================================================

const express = require("express");
const router  = express.Router();
const { registerProfile, loginProfile } = require("../lib/redis");
const { requireProfile } = require("../middleware/auth");

router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password are required" });
    }
    const result = await registerProfile(username, password);
    res.json({ ok: true, profile: result.profile, sessionToken: result.sessionToken });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "Username and password are required" });
    }
    const result = await loginProfile(username, password);
    res.json({ ok: true, profile: result.profile, sessionToken: result.sessionToken });
  } catch (e) {
    res.status(401).json({ ok: false, error: e.message });
  }
});

router.get("/me", requireProfile, (req, res) => {
  const { id, username, createdAt } = req.profileMeta;
  res.json({ ok: true, profile: { id, username, createdAt } });
});

module.exports = router;
