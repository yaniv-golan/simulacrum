export const CONTROLLER_STYLES = Object.freeze({
  "drive-pad": { label: "Drive pad", profiles: ["*"] },
  "compact-grid": { label: "Compact instruments", profiles: ["*"] },
});

export function createDefaultControllerLayouts() {
  return {
    cart: {
      style: "drive-pad",
      title: "Rover Pilot",
      accent: "#70e0c4",
      collapsed: false,
    },
  };
}

export function normalizeControllerLayouts(value = {}) {
  const result = createDefaultControllerLayouts();
  for (const [profile, layout] of Object.entries(value || {})) {
    if (!layout || typeof layout !== "object") continue;
    const requestedStyle = CONTROLLER_STYLES[layout.style]
        ? layout.style
        : "compact-grid",
      supportedProfiles = CONTROLLER_STYLES[requestedStyle].profiles,
      style =
        supportedProfiles.includes("*") || supportedProfiles.includes(profile)
          ? requestedStyle
          : "compact-grid";
    result[profile] = {
      style,
      title: String(layout.title || "Direct Control").slice(0, 28),
      accent: /^#[0-9a-f]{6}$/i.test(layout.accent) ? layout.accent : "#70e0c4",
      collapsed: !!layout.collapsed,
    };
  }
  return result;
}
