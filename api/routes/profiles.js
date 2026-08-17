// ============================================================
//  PROFILE ROUTES
//  POST /api/profiles/create        → register a new profile
//  GET  /api/profiles/generate-key  → suggest a strong random key
//  GET  /api/profiles/me            → whoami (requires x-api-key)
//
//  There's no separate "login" route — once a profile exists,
//  its API key IS the credential for every other endpoint.
// ============================================================

const express = require("express");
const router  = express.Router();
const { createProfile } = require("../lib/redis");
const { generateApiKey } = require("../lib/crypto");
const { requireProfile } = require("../middleware/auth");

router.post("/create", async (req, res) => {
  try {
    const { name, apiKey } = req.body;
    if (!name || !name.trim())  return res.status(400).json({ ok: false, error: "Missing name" });
    if (!apiKey || apiKey.length < 8) {
      return res.status(400).json({ ok: false, error: "API key must be at least 8 characters" });
    }
    const profile = await createProfile(name.trim(), apiKey);
    res.json({ ok: true, profile });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/generate-key", (req, res) => {
  res.json({ ok: true, apiKey: generateApiKey() });
});

router.get("/me", requireProfile, (req, res) => {
  res.json({ ok: true, profile: req.profileMeta });
});

module.exports = router;
