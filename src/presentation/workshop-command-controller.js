import { createPrimarySurfaceController } from "./primary-surface-controller.js";
import { bindSelectedCommandButtons } from "./selected-command-button-bindings.js";
import { installWorkshopScriptCommandBindings } from "./workshop-script-command-bindings.js";

/**
 * @typedef {{ query:(selector:string)=>Element|null, queryAll:(selector:string)=>Element[] }} WorkshopCommandView
 * @typedef {{ running:()=>boolean, setMode:(mode:string)=>void, stop:()=>void, pause:()=>void, cycleSpeed:(direction:number)=>void, reset:()=>void, undo:()=>void, redo:()=>void, clear:()=>void, clearSelection:()=>void, executeSelectedCommand:(commandId:string)=>void }} WorkshopCommandPort
 * @typedef {{ render:(category?:string)=>void }} CatalogCommandPort
 * @typedef {{ render:()=>void, releaseHeld:()=>void, setProfile:(profile:string)=>void, toggleEdit:()=>void, addAuxiliary:()=>void, toggleDirectSurface:()=>void }} RemoteCommandPort
 * @typedef {{
 *   setTime:(value:string)=>void, setWind:(enabled:boolean)=>void,
 * }} EnvironmentCommandPort
 * @typedef {{
 *   renderChallenges:()=>void, loadDemo:(kind:string)=>void,
 *   resetChallenge:()=>void, openBlueprints:()=>void,
 * }} BrowserCommandPort
 * @typedef {{
 *   open:()=>void, save:()=>void, setLanguage:(language:string)=>void,
 *   compile:()=>void, trust:()=>void, stop:()=>void, invalidate:()=>void,
 * }} ScriptCommandPort
 */
/**
 * Owns static workshop command bindings. It changes only presentation-local
 * visibility; all model mutations are emitted through typed command ports.
 *
 * @param {{
 *   view:WorkshopCommandView, workshop:WorkshopCommandPort,
 *   catalog:CatalogCommandPort, remote:RemoteCommandPort,
 *   environment:EnvironmentCommandPort, browser:BrowserCommandPort,
 *   script:ScriptCommandPort,
 * }} ports
 */
export function installWorkshopCommandController({
  view,
  workshop,
  catalog,
  remote,
  environment,
  browser,
  script,
}) {
  /** @param {string} selector */
  const required = (selector) => {
    const element = view.query(selector);
    if (!element) throw new Error(`Missing workshop control ${selector}`);
    return /** @type {HTMLElement} */ (element);
  };
  for (const tab of view.queryAll(".tabs button")) {
    const button = /** @type {HTMLButtonElement} */ (tab);
    button.onclick = () => {
      for (const candidate of view.queryAll(".tabs button")) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-selected", String(active));
      }
      catalog.render(button.dataset.cat);
    };
  }
  required(".search input").oninput = (event) => {
    const input = /** @type {HTMLInputElement} */ (event.currentTarget),
      needle = input.value.toLowerCase();
    for (const card of view.queryAll(".part-card"))
      card.classList.toggle(
        "hidden",
        !card.textContent?.toLowerCase().includes(needle),
      );
  };
  for (const control of view.queryAll("[data-mode]")) {
    const button = /** @type {HTMLButtonElement} */ (control);
    button.onclick = () => workshop.setMode(button.dataset.mode || "build");
  }
  required("#run-btn").onclick = () =>
    workshop.running() ? workshop.stop() : workshop.setMode("test");
  required("#sim-pause").onclick = () => workshop.pause();
  required("#sim-speed").onclick = () => workshop.cycleSpeed(1);
  required("#sim-reset").onclick = () => workshop.reset();
  required("#undo-tool").onclick = () => workshop.undo();
  required("#redo-tool").onclick = () => workshop.redo();
  required("#clear-build").onclick = () => workshop.clear();
  required("#close-inspect").onclick = () => workshop.clearSelection();
  bindSelectedCommandButtons(required, workshop.executeSelectedCommand);
  const remoteButton = required("#remote-btn"),
    remotePanel = required(".remote-console"),
    primarySurfaces = createPrimarySurfaceController({
      query: view.query,
      releaseHeld: remote.releaseHeld,
    });
  remoteButton.onclick = () => {
    const opening = remotePanel.classList.contains("hidden");
    remotePanel.classList.toggle("hidden", !opening);
    remoteButton.setAttribute("aria-expanded", String(opening));
    if (opening) {
      primarySurfaces.hideOthers(".remote-console");
      remote.render();
      queueMicrotask(() => required("#close-remote").focus());
    } else remote.releaseHeld();
  };
  required("#close-remote").onclick = () => {
    remote.releaseHeld();
    remotePanel.classList.add("hidden");
    remoteButton.setAttribute("aria-expanded", "false");
    remoteButton.focus();
  };
  required("#remote-profile").onchange = (event) =>
    remote.setProfile(
      /** @type {HTMLSelectElement} */ (event.currentTarget).value,
    );
  required("#edit-remote").onclick = () => remote.toggleEdit();
  required("#add-command").onclick = () => remote.addAuxiliary();
  required("#toggle-direct-panel").onclick = () => remote.toggleDirectSurface();
  required("#environment-btn").onclick = () =>
    primarySurfaces.toggle({
      selector: ".environment-panel",
      closeSelector: "#close-environment",
      openerSelector: "#tools-btn",
    });
  required("#close-environment").onclick = () => {
    required(".environment-panel").classList.add("hidden");
    required("#tools-btn").focus();
  };
  required("#time-of-day").oninput = (event) =>
    environment.setTime(
      /** @type {HTMLInputElement} */ (event.currentTarget).value,
    );
  required("#wind-enabled").onchange = (event) =>
    environment.setWind(
      /** @type {HTMLInputElement} */ (event.currentTarget).checked,
    );
  for (const preset of view.queryAll("[data-time]")) {
    const button = /** @type {HTMLButtonElement} */ (preset);
    button.onclick = () => environment.setTime(button.dataset.time || "14");
  }
  required("#demos-btn").onclick = () =>
    primarySurfaces.toggle({
      selector: ".demo-browser",
      closeSelector: "#close-demos",
      openerSelector: "#demos-btn",
    });
  required("#challenges-btn").onclick = () =>
    primarySurfaces.toggle({
      selector: ".challenge-browser",
      closeSelector: "#close-challenges",
      openerSelector: "#challenges-btn",
      prepare: browser.renderChallenges,
    });
  required("#close-challenges").onclick = () => {
    required(".challenge-browser").classList.add("hidden");
    required("#challenges-btn").focus();
  };
  required("#close-demos").onclick = () => {
    required(".demo-browser").classList.add("hidden");
    required("#demos-btn").focus();
  };
  for (const demo of view.queryAll("[data-demo]")) {
    const button = /** @type {HTMLButtonElement} */ (demo);
    button.onclick = () => {
      browser.resetChallenge();
      browser.loadDemo(button.dataset.demo || "gearbox");
      primarySurfaces.hideOthers(".remote-console");
      required(".remote-console").classList.remove("hidden");
      remoteButton.setAttribute("aria-expanded", "true");
      remote.render();
      queueMicrotask(() => required("#close-remote").focus());
    };
  }
  required("#blueprint-btn").onclick = () => browser.openBlueprints();
  installWorkshopScriptCommandBindings({
    required,
    view,
    primarySurfaces,
    script,
  });
  return Object.freeze({});
}
