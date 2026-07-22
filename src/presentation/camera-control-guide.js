function detectedPlatform() {
  const navigatorWithHints =
    /** @type {Navigator & {userAgentData?: {platform?: string}}} */ (
      globalThis.navigator
    );
  return (
    navigatorWithHints?.userAgentData?.platform ||
    globalThis.navigator?.platform ||
    ""
  );
}

/** Returns user-facing camera vocabulary without coupling input behavior to an OS. */
export function cameraControlGuide(platform = detectedPlatform()) {
  const apple = /mac|iphone|ipad|ipod/i.test(platform);
  return {
    platform: apple ? "MAC TRACKPAD & MOUSE" : "MOUSE, TRACKPAD & KEYS",
    orbitTitle: apple
      ? "Orbit: Option-drag, or choose Orbit then drag"
      : "Orbit: Alt-drag, secondary-button drag, or choose Orbit then drag",
    panTitle: apple
      ? "Pan: Space-drag, or choose Pan then drag"
      : "Pan: Space-drag, middle-button drag, or choose Pan then drag",
    rows: apple
      ? [
          ["⌥ + Drag", "Orbit"],
          ["Space + Drag", "Pan"],
          ["Pinch / Scroll", "Zoom to pointer"],
          ["⇧ + Scroll", "Pan sideways"],
          ["Secondary-drag", "Orbit"],
          ["Double-click", "Focus part"],
          ["F / ⇧F", "Frame / follow"],
          ["1 / 3 / 7", "Front / side / top"],
          ["Home", "Reset view"],
        ]
      : [
          ["Alt + Drag", "Orbit"],
          ["Space + Drag", "Pan"],
          ["Wheel / Pinch", "Zoom to pointer"],
          ["Shift + Wheel", "Pan sideways"],
          ["Secondary-drag", "Orbit"],
          ["Middle-button drag", "Pan"],
          ["Double-click", "Focus part"],
          ["F / Shift+F", "Frame / follow"],
          ["1 / 3 / 7", "Front / side / top"],
          ["Home", "Reset view"],
        ],
  };
}

/** Installs platform-appropriate, jargon-free camera help in the workshop dock. */
export function installCameraControlGuide({
  root = document,
  platform = detectedPlatform(),
} = {}) {
  const guide = cameraControlGuide(platform),
    card = root.querySelector(".camera-help-card"),
    trigger = root.querySelector("#camera-help"),
    orbit = root.querySelector("#orbit-view"),
    pan = root.querySelector("#pan-view");
  if (!card) return guide;
  card.setAttribute("aria-label", `Camera controls for ${guide.platform}`);
  card.innerHTML = `<div class="camera-help-head"><b>CAMERA · ${guide.platform}</b><button type="button" class="camera-help-close" aria-label="Hide camera controls">×</button></div>${guide.rows
    .map(([gesture, action]) => `<span><kbd>${gesture}</kbd> ${action}</span>`)
    .join("")}`;
  const setOpen = (open) => {
    card.classList.toggle("hidden", !open);
    trigger?.setAttribute("aria-expanded", String(open));
  };
  trigger?.setAttribute("aria-haspopup", "dialog");
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.addEventListener("click", () =>
    setOpen(card.classList.contains("hidden")),
  );
  card.querySelector(".camera-help-close")?.addEventListener("click", () => {
    setOpen(false);
    if (trigger instanceof HTMLElement) trigger.focus();
  });
  root.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Node ? event.target : null;
    if (
      !card.classList.contains("hidden") &&
      target &&
      !card.contains(target) &&
      !trigger?.contains(target)
    )
      setOpen(false);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !card.classList.contains("hidden"))
      setOpen(false);
  });
  if (orbit instanceof HTMLElement) orbit.title = guide.orbitTitle;
  if (pan instanceof HTMLElement) pan.title = guide.panTitle;
  return { ...guide, setOpen };
}
