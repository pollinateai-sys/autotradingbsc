// ============================================================
//  YOUR PERSONAL HALAL TOKEN LIST
//  Only add tokens YOU have personally verified as halal.
//  Set enabled: false to pause without removing.
// ============================================================

const HALAL_TOKENS = [
  {
    symbol:   "BTCB",
    name:     "Wrapped Bitcoin (BEP20)",
    contract: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    enabled:  true,
  },
  {
    symbol:   "ETH",
    name:     "Wrapped Ethereum (BEP20)",
    contract: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    enabled:  true,
  },
  {
    symbol:   "LINK",
    name:     "Chainlink (BEP20)",
    contract: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    enabled:  true,
  },
  {
    symbol:   "DOT",
    name:     "Polkadot (BEP20)",
    contract: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
    enabled:  true,
  },
  {
    symbol:   "ADA",
    name:     "Cardano (BEP20)",
    contract: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47",
    enabled:  true,
  },
  // ── ADD YOUR OWN VERIFIED HALAL TOKENS BELOW ─────────────
  // {
  //   symbol:   "TOKEN",
  //   name:     "Full Token Name",
  //   contract: "0x...",
  //   enabled:  true,
  // },
];

module.exports = HALAL_TOKENS;
