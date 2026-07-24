import { activeFocusOwner } from "./keyboard-focus-context.js";

function rendered(element) {
  if (!(element instanceof HTMLElement) || !element.isConnected) return false;
  if (element.hidden || element.closest("[hidden], .hidden, [inert]"))
    return false;
  let current = element;
  while (current) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    )
      return false;
    current = current.parentElement;
  }
  return element.getClientRects().length > 0;
}

/**
 * Projects current presentation facts on demand for browser automation. This
 * is not stored state and does not replace telemetry or application owners.
 */
export function buildPresentationDebugReadModel({
  root = document,
  state,
  keyboard,
}) {
  const $ = (selector) => root.querySelector(selector),
    visible = (selector) => rendered($(selector)),
    surfaceSelectors = {
      catalog: ".catalog",
      inspector: ".inspector",
      outliner: ".assembly-outliner",
      remote: ".remote-console",
      directControl: ".drive-hud",
      challenge: ".challenge-hud",
      learn: ".learn-center",
      tools: ".tools-menu",
      environment: ".environment-panel",
      script: ".wasm-console",
      testReserve: ".test-reserve-panel",
      mechanismLab: ".mechanism-lab",
      failureAnalysis: ".failure-analysis",
      keyboardCommands: "#keyboard-command-surface",
    },
    surfaces = Object.fromEntries(
      Object.entries(surfaceSelectors).map(([name, selector]) => [
        name,
        visible(selector),
      ]),
    ),
    modal = Array.from(
      root.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ).find(rendered),
    statusFamilies = [];
  if (state.activeChallenge) statusFamilies.push("challenge");
  if (visible(".connection-banner")) statusFamilies.push("connection");
  if (visible(".toast")) statusFamilies.push("transient");
  if (visible(".failure-warning")) statusFamilies.push("failure");
  return {
    mode: state.editor.mode,
    workspace: {
      compact: $(".shell")?.classList.contains("compact-workspace") || false,
      focused: $(".shell")?.classList.contains("focus-workspace") || false,
      activeTool: state.editor.tool,
    },
    run: {
      running: state.running,
      paused: state.simulationPaused,
      speed: state.timeScale,
    },
    surfaces,
    activeModal: modal?.id || null,
    activeDrawer:
      Object.entries(surfaces).find(
        ([name, isVisible]) =>
          isVisible &&
          [
            "remote",
            "learn",
            "environment",
            "script",
            "testReserve",
            "mechanismLab",
            "failureAnalysis",
            "keyboardCommands",
          ].includes(name),
      )?.[0] || null,
    focusOwner: activeFocusOwner(root),
    statusFamilies,
    actionGroups: {
      modes: visible(".mode-switch"),
      header: visible(".header-actions"),
      editor: visible(".tool-group"),
      simulation: visible(".sim-controls"),
      camera: visible(".camera-tools"),
      directControl: surfaces.directControl,
    },
    keyboard: keyboard(),
  };
}
