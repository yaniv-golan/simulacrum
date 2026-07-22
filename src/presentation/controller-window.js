const DEFAULT_LAYOUT = Object.freeze({
  style: "compact-grid",
  title: "Direct Control",
  accent: "#70e0c4",
  collapsed: false,
});

export function updateControllerWindowChrome({
  $,
  layout,
  graphic,
  compact = false,
  running = false,
}) {
  const modeButton = $("#controller-mode"),
    collapseButton = $("#collapse-controller"),
    controller = $(".drive-hud"),
    compactCollapsed =
      compact && !running && !controller.classList.contains("compact-expanded"),
    collapsed = !!layout?.collapsed || compactCollapsed;
  controller.classList.toggle("graphic-controller", graphic);
  controller.classList.toggle("collapsed", collapsed);
  controller.classList.toggle("compact-auto-collapsed", compactCollapsed);
  controller.style.setProperty(
    "--controller-accent",
    layout?.accent || "#70e0c4",
  );
  modeButton.textContent = graphic ? "CUSTOM" : "GENERIC";
  modeButton.disabled = false;
  modeButton.title = `Using ${graphic ? "custom model" : "generic"} controls — click for ${graphic ? "generic" : "custom model"} controls`;
  modeButton.setAttribute("aria-label", modeButton.title);
  modeButton.setAttribute("aria-pressed", String(graphic));
  collapseButton.textContent = collapsed ? "+" : "−";
  collapseButton.title = collapsed
    ? "Expand controller"
    : "Collapse controller to its status bar";
  collapseButton.setAttribute("aria-label", collapseButton.title);
  collapseButton.setAttribute("aria-expanded", String(!collapsed));
}

/**
 * Owns the presentation-only controller window behavior. Commands still flow
 * through the application's shared remote channel dispatcher.
 */
export function installControllerWindow({
  $,
  state,
  persistLayouts,
  persistVisibility,
  render,
  refreshVisibility,
  openAdvanced,
}) {
  const editable = (target) =>
    target.closest("input, textarea, select, [contenteditable='true']");
  for (const surface of [$(".drive-hud"), $(".remote-head")])
    for (const eventName of ["selectstart", "contextmenu", "dragstart"])
      surface.addEventListener(eventName, (event) => {
        if (!editable(event.target)) event.preventDefault();
      });

  const ensureLayout = () =>
    state.controllerLayouts[state.remoteProfile] ||
    (state.controllerLayouts[state.remoteProfile] = { ...DEFAULT_LAYOUT });

  $("#edit-direct-surface").onclick = openAdvanced;
  $("#controller-mode").onclick = () => {
    const layout = ensureLayout();
    layout.style = layout.style === "drive-pad" ? "compact-grid" : "drive-pad";
    persistLayouts();
    render();
  };
  $("#collapse-controller").onclick = () => {
    const controller = $(".drive-hud"),
      compactBuild =
        $(".shell").classList.contains("compact-workspace") && !state.running;
    if (compactBuild) {
      controller.classList.toggle("compact-expanded");
      render();
      return;
    }
    const layout = ensureLayout();
    layout.collapsed = !layout.collapsed;
    persistLayouts();
    render();
  };
  $("#close-controller").onclick = () => {
    state.directSurfaces[state.remoteProfile] = false;
    persistVisibility();
    refreshVisibility();
  };
  $("#controller-launcher").onclick = () => {
    state.directSurfaces[state.remoteProfile] = true;
    persistVisibility();
    render();
  };
  $("#design-direct-surface").onclick = () => {
    const designer = $(".controller-design"),
      layout = ensureLayout();
    designer.classList.toggle("hidden");
    $("#design-direct-surface").setAttribute(
      "aria-expanded",
      String(!designer.classList.contains("hidden")),
    );
    $("#controller-style").value = layout.style;
    $("#controller-accent").value = layout.accent;
    $("#controller-title").value = layout.title;
  };

  const updateDesign = () => {
    const layout = ensureLayout();
    layout.style = $("#controller-style").value;
    layout.accent = $("#controller-accent").value;
    layout.title = $("#controller-title").value.trim() || "Direct Control";
    persistLayouts();
    render();
  };
  $("#controller-style").onchange = updateDesign;
  $("#controller-accent").oninput = updateDesign;
  $("#controller-title").oninput = updateDesign;
}
