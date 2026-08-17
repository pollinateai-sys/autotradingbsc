// ============================================================
//  WALLET ROUTES (per profile)
//  GET  /api/wallet            → connection status + BNB balance
//  POST /api/wallet/connect    → { privateKey } → encrypt & store
//  POST /api/wallet/disconnect → forget the stored key
// ============================================================

const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { connectWallet, disconnectWallet, getWalletInfo, getBnbBalance } = require("../lib/wallet");

router.get("/", requireProfile, async (req, res) => {
  try {
    const info = await getWalletInfo(req.profileId);
    let bnbBalance = null;
    if (info) {
      try { bnbBalance = await getBnbBalance(req.profileId); } catch { /* RPC hiccup, non-fatal */ }
    }
    res.json({ ok: true, wallet: info, bnbBalance });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/connect", requireProfile, async (req, res) => {
  try {
    const { privateKey } = req.body;
    if (!privateKey) return res.status(400).json({ ok: false, error: "Missing privateKey" });
    const result = await connectWallet(req.profileId, privateKey);
    res.json({ ok: true, wallet: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post("/disconnect", requireProfile, async (req, res) => {
  try {
    await disconnectWallet(req.profileId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
