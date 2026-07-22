export { installWorkshopCommandController } from "./workshop-command-controller.js";

/**
 * @param {{root?: Document|HTMLElement, onFocusChange?: (focused: boolean) => void, onLayoutChange?: (layout: {compact: boolean}) => void}} [options]
 */
export function installWorkspaceChrome({
  root = document,
  onFocusChange = () => {},
  onLayoutChange = () => {},
} = {}) {
  const $ = (selector) => root.querySelector(selector),
    menu = $(".tools-menu"),
    toolsButton = $("#tools-btn"),
    focusButton = $("#workspace-focus"),
    shell = $(".shell"),
    catalog = $(".catalog"),
    inspector = $(".inspector"),
    compactQuery = globalThis.matchMedia("(max-width: 1080px)");
  let focused = false,
    compact = false,
    lastSelectionState = null;

  const panels = {
    catalog: {
      element: catalog,
      side: "left",
      label: "component library",
    },
    inspector: { element: inspector, side: "right", label: "inspector" },
  };

  function updatePanelButton(panel) {
    const button = panel.querySelector(".panel-collapse"),
      entry = Object.values(panels).find((item) => item.element === panel),
      collapsed = panel.classList.contains("panel-collapsed");
    if (!button || !entry) return;
    button.textContent = collapsed
      ? entry.side === "left"
        ? "›"
        : "‹"
      : entry.side === "left"
        ? "‹"
        : "›";
    button.setAttribute(
      "aria-label",
      `${collapsed ? "Expand" : "Collapse"} ${entry.label}`,
    );
    button.setAttribute("aria-expanded", String(!collapsed));
    button.title = `${collapsed ? "Expand" : "Collapse"} ${entry.label}`;
  }

  function setPanelCollapsed(panel, collapsed, adaptive = false) {
    panel.classList.toggle("panel-collapsed", collapsed);
    if (adaptive && collapsed) panel.dataset.adaptiveCollapsed = "true";
    else delete panel.dataset.adaptiveCollapsed;
    updatePanelButton(panel);
  }

  function setPrimaryPanel(name) {
    if (!compact || !panels[name]) return;
    for (const [panelName, entry] of Object.entries(panels)) {
      if (panelName === name) setPanelCollapsed(entry.element, false, true);
      else if (!entry.element.classList.contains("panel-collapsed"))
        setPanelCollapsed(entry.element, true, true);
    }
    positionSelectionLabel();
  }

  function installPanelCollapse(panel, side, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `panel-collapse panel-collapse-${side}`;
    button.setAttribute("aria-label", `Collapse ${label}`);
    button.title = `Collapse ${label}`;
    button.textContent = side === "left" ? "‹" : "›";
    panel.append(button);
    updatePanelButton(panel);
    button.addEventListener("click", () => {
      const collapsed = !panel.classList.contains("panel-collapsed");
      setPanelCollapsed(panel, collapsed);
      if (compact && !collapsed) {
        const other = panel === catalog ? inspector : catalog;
        if (!other.classList.contains("panel-collapsed"))
          setPanelCollapsed(other, true, true);
      }
      positionSelectionLabel();
    });
  }

  installPanelCollapse(catalog, "left", "component library");
  installPanelCollapse(inspector, "right", "inspector");

  function applyResponsiveMode() {
    compact = compactQuery.matches;
    shell.classList.toggle("compact-workspace", compact);
    if (compact) {
      const hasSelection =
        !$(".inspector-content").classList.contains("hidden");
      lastSelectionState = hasSelection;
      setPrimaryPanel(hasSelection ? "inspector" : "catalog");
    } else {
      for (const entry of Object.values(panels))
        if (entry.element.dataset.adaptiveCollapsed === "true")
          setPanelCollapsed(entry.element, false, true);
      lastSelectionState = null;
    }
    positionSelectionLabel();
    onLayoutChange({ compact });
  }

  function syncSelection(hasSelection) {
    hasSelection = !!hasSelection;
    if (!compact || hasSelection === lastSelectionState) return;
    lastSelectionState = hasSelection;
    setPrimaryPanel(hasSelection ? "inspector" : "catalog");
  }

  function closeToolsMenu() {
    menu.classList.add("hidden");
    toolsButton.setAttribute("aria-expanded", "false");
  }

  function positionSelectionLabel() {
    const label = $(".selection-label"),
      mission = $(".mission");
    if (!label || !mission || label.classList.contains("hidden")) return;
    label.style.top = `${Math.max(92, mission.getBoundingClientRect().bottom + 10)}px`;
  }

  function toggleFocus(force = !focused) {
    focused = !!force;
    shell.classList.toggle("focus-workspace", focused);
    const label = focusButton.querySelector("span");
    if (label)
      label.innerHTML = focused
        ? "RESTORE PANELS<em>Show library & inspector · H</em>"
        : "CANVAS FOCUS<em>Hide side panels · H</em>";
    positionSelectionLabel();
    onFocusChange(focused);
    return focused;
  }

  toolsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !opening);
    toolsButton.setAttribute("aria-expanded", String(opening));
  });
  menu.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button"))
      closeToolsMenu();
  });
  focusButton.addEventListener("click", () => toggleFocus());
  root.addEventListener("click", (event) => {
    if (
      event.target instanceof Element &&
      !event.target.closest(".tools-menu-wrap")
    )
      closeToolsMenu();
  });
  globalThis.addEventListener("resize", positionSelectionLabel);
  compactQuery.addEventListener("change", applyResponsiveMode);
  applyResponsiveMode();

  return {
    closeToolsMenu,
    positionSelectionLabel,
    setPrimaryPanel,
    syncSelection,
    toggleFocus,
    get compact() {
      return compact;
    },
    get focused() {
      return focused;
    },
  };
}

export {
  createWorkshopUiPresenter,
  createWorkshopUiView,
} from "./workshop-ui-presenter.js";
