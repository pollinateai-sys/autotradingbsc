// ============================================================
//  UI PREFERENCES — per profile, fully customizable dashboard
//
//  Everything here is presentation/comfort only: it never changes
//  trading behaviour, so it is validated but intentionally very
//  permissive. Stored per profile so a person's look-and-feel
//  follows them to any device they sign in from.
// ============================================================

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Built-in accent presets. "custom" uses accentColor verbatim.
const ACCENT_PRESETS = {
  jade:    { label: "Jade",    color: "#22a870" },
  azure:   { label: "Azure",   color: "#3b82f6" },
  violet:  { label: "Violet",  color: "#8b5cf6" },
  amber:   { label: "Amber",   color: "#f59e0b" },
  rose:    { label: "Rose",    color: "#f43f5e" },
  cyan:    { label: "Cyan",    color: "#06b6d4" },
  crimson: { label: "Crimson", color: "#dc2626" },
  slate:   { label: "Slate",   color: "#64748b" },
};

const THEMES   = ["midnight", "carbon", "navy", "light"];
const DENSITIES = ["comfortable", "compact"];
const CURRENCIES = ["usd", "bnb"];

const DEFAULT_UI_PREFERENCES = {
  // Appearance
  theme:          "midnight",     // background palette
  accentPreset:   "jade",         // key of ACCENT_PRESETS, or "custom"
  accentColor:    "#22a870",      // used when accentPreset === "custom"
  highlightColor: "#c9a227",      // secondary/gold highlight
  density:        "comfortable",  // comfortable | compact
  showStarMotif:  true,           // decorative 8-point stars
  // Branding
  dashboardName:  "BSC Spot Trading Bot",
  tagline:        "Spot only · No leverage · No margin",
  // Behaviour / comfort
  refreshSeconds:      3,     // dashboard snapshot polling
  priceCurrency:       "usd", // how token prices are displayed
  confirmBeforeClose:  true,  // confirm dialog on manual close
  confirmBeforeEnable: false, // confirm dialog when enabling a discovered coin
  showDiscovery:       true,  // show/hide the Coins Found section
  showProfileAdmin:    true,  // show/hide Profile Management section
  compactNumbers:      true,  // 1.2M vs 1,200,000
};

function validateUiPreferences(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("uiPreferences must be an object");
  }
  const merged = { ...DEFAULT_UI_PREFERENCES, ...input };

  if (!THEMES.includes(merged.theme)) {
    throw new Error(`Theme must be one of: ${THEMES.join(", ")}`);
  }
  if (merged.accentPreset !== "custom" && !ACCENT_PRESETS[merged.accentPreset]) {
    throw new Error(`Accent must be "custom" or one of: ${Object.keys(ACCENT_PRESETS).join(", ")}`);
  }
  for (const field of ["accentColor", "highlightColor"]) {
    if (!HEX_COLOR.test(String(merged[field]))) {
      throw new Error(`${field} must be a hex colour like #22a870`);
    }
  }
  if (!DENSITIES.includes(merged.density)) {
    throw new Error(`Density must be one of: ${DENSITIES.join(", ")}`);
  }
  if (!CURRENCIES.includes(merged.priceCurrency)) {
    throw new Error(`Price currency must be one of: ${CURRENCIES.join(", ")}`);
  }

  const refresh = Number(merged.refreshSeconds);
  if (!isFinite(refresh) || refresh < 2 || refresh > 120) {
    throw new Error("Refresh interval must be between 2 and 120 seconds");
  }

  const name = String(merged.dashboardName || "").trim();
  if (name.length < 2 || name.length > 40) {
    throw new Error("Dashboard name must be 2–40 characters");
  }
  const tagline = String(merged.tagline ?? "").trim();
  if (tagline.length > 80) throw new Error("Tagline must be 80 characters or fewer");

  // If a preset is selected, keep accentColor in sync so the client can
  // always just read accentColor without re-resolving the preset.
  const accentColor = merged.accentPreset === "custom"
    ? String(merged.accentColor).toLowerCase()
    : ACCENT_PRESETS[merged.accentPreset].color;

  return {
    theme:          merged.theme,
    accentPreset:   merged.accentPreset,
    accentColor,
    highlightColor: String(merged.highlightColor).toLowerCase(),
    density:        merged.density,
    showStarMotif:  !!merged.showStarMotif,
    dashboardName:  name,
    tagline,
    refreshSeconds:      Math.round(refresh),
    priceCurrency:       merged.priceCurrency,
    confirmBeforeClose:  !!merged.confirmBeforeClose,
    confirmBeforeEnable: !!merged.confirmBeforeEnable,
    showDiscovery:       !!merged.showDiscovery,
    showProfileAdmin:    !!merged.showProfileAdmin,
    compactNumbers:      !!merged.compactNumbers,
  };
}

module.exports = {
  ACCENT_PRESETS, THEMES, DENSITIES, CURRENCIES,
  DEFAULT_UI_PREFERENCES, validateUiPreferences,
};
