/**
 * @typedef {{ query:(selector:string)=>Element|null, queryAll:(selector:string)=>Element[] }} WorkshopCommandView
 * @typedef {{
 *   running:()=>boolean, setMode:(mode:string)=>void, stop:()=>void,
 *   pause:()=>void, cycleSpeed:(direction:number)=>void, reset:()=>void,
 *   undo:()=>void, redo:()=>void, clear:()=>void, clearSelection:()=>void,
 *   removeSelection:()=>void, duplicateSelection:()=>void, mirrorSelection:()=>void,
 * }} WorkshopCommandPort
 * @typedef {{ render:(category?:string)=>void }} CatalogCommandPort
 * @typedef {{
 *   render:()=>void, setProfile:(profile:string)=>void, toggleEdit:()=>void,
 *   addAuxiliary:()=>void, toggleDirectSurface:()=>void,
 * }} RemoteCommandPort
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
  required("#delete-part").onclick = () => workshop.removeSelection();
  required("#duplicate-part").onclick = () => workshop.duplicateSelection();
  required("#mirror-selection").onclick = () => workshop.mirrorSelection();

  required("#remote-btn").onclick = () => {
    required(".remote-console").classList.toggle("hidden");
    remote.render();
  };
  required("#close-remote").onclick = () =>
    required(".remote-console").classList.add("hidden");
  required("#remote-profile").onchange = (event) =>
    remote.setProfile(
      /** @type {HTMLSelectElement} */ (event.currentTarget).value,
    );
  required("#edit-remote").onclick = () => remote.toggleEdit();
  required("#add-command").onclick = () => remote.addAuxiliary();
  required("#toggle-direct-panel").onclick = () => remote.toggleDirectSurface();

  required("#environment-btn").onclick = () => {
    required(".environment-panel").classList.toggle("hidden");
    required(".remote-console").classList.add("hidden");
    required(".demo-browser").classList.add("hidden");
  };
  required("#close-environment").onclick = () =>
    required(".environment-panel").classList.add("hidden");
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

  required("#demos-btn").onclick = () => {
    required(".demo-browser").classList.toggle("hidden");
    required(".challenge-browser").classList.add("hidden");
    required(".environment-panel").classList.add("hidden");
  };
  required("#challenges-btn").onclick = () => {
    browser.renderChallenges();
    required(".challenge-browser").classList.toggle("hidden");
    required(".demo-browser").classList.add("hidden");
    required(".environment-panel").classList.add("hidden");
  };
  required("#close-challenges").onclick = () =>
    required(".challenge-browser").classList.add("hidden");
  required("#close-demos").onclick = () =>
    required(".demo-browser").classList.add("hidden");
  for (const demo of view.queryAll("[data-demo]")) {
    const button = /** @type {HTMLButtonElement} */ (demo);
    button.onclick = () => {
      browser.resetChallenge();
      browser.loadDemo(button.dataset.demo || "gearbox");
      required(".demo-browser").classList.add("hidden");
      required(".remote-console").classList.remove("hidden");
      remote.render();
    };
  }
  required("#blueprint-btn").onclick = () => browser.openBlueprints();

  required("#wasm-btn").onclick = () => {
    if (required(".wasm-console").classList.contains("hidden")) script.open();
    else {
      script.save();
      required(".wasm-console").classList.add("hidden");
    }
  };
  required("#close-wasm").onclick = () => {
    script.save();
    required(".wasm-console").classList.add("hidden");
  };
  for (const language of view.queryAll("[data-script-language]")) {
    const button = /** @type {HTMLButtonElement} */ (language);
    button.onclick = () =>
      script.setLanguage(button.dataset.scriptLanguage || "visual");
  }
  required("#compile-wasm").onclick = () => script.compile();
  required("#trust-program").onclick = () => script.trust();
  required("#stop-wasm").onclick = () => script.stop();
  required("#wasm-source").addEventListener("input", () => script.invalidate());

  return Object.freeze({});
}
