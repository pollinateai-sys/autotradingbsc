// GET /api/status — full dashboard snapshot for the authenticated profile
const express = require("express");
const router  = express.Router();
const { requireProfile } = require("../middleware/auth");
const { getBnbBalance, getWalletInfo } = require("../lib/wallet");
const { getPositions, getStats, getSettings, getTokens } = require("../lib/redis");
const strategyStore = require("../lib/strategies");

router.get("/", requireProfile, async (req, res) => {
  try {
    const profileId = req.profileId;
    const walletInfo = await getWalletInfo(profileId);

    const [positions, stats, settings, tokens] = await Promise.all([
      getPositions(profileId),
      getStats(profileId),
      getSettings(profileId),
      getTokens(profileId),
    ]);

    let bnbBalance = null;
    if (walletInfo) {
      try { bnbBalance = await getBnbBalance(profileId); } catch { /* RPC hiccup */ }
    }

    // Strategy name/ladder for the dashboard — tolerate it being
    // missing (e.g. mid-edit) rather than failing the whole status poll
    const strategy = await strategyStore.getStrategyByKey(profileId, settings.activeStrategy).catch(() => null);

    res.json({
      ok: true,
      profile: { id: req.profileMeta.id, username: req.profileMeta.username },
      wallet: {
        connected:  !!walletInfo,
        address:    walletInfo?.address || null,
        bnbBalance,
      },
      settings,
      strategy: { key: settings.activeStrategy, ...strategy },
      positions: Object.values(positions),
      openCount: Object.keys(positions).length,
      stats,
      tokenCount: tokens.length,
      enabledTokenCount: tokens.filter(t => t.enabled).length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
