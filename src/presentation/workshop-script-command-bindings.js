/**
 * @typedef {{ open:()=>void, save:()=>void, setLanguage:(language:string)=>void,
 *   compile:()=>void, trust:()=>void, stop:()=>void, invalidate:()=>void }} ScriptCommandPort
 * @typedef {{ hideOthers:(selector:string)=>void }} WorkshopSurfacePort
 * @typedef {{ queryAll:(selector:string)=>Element[] }} WorkshopScriptView
 */

/**
 * Owns script-console command binding and focus restoration for the workshop.
 *
 * @param {{
 *   required:(selector:string)=>HTMLElement,
 *   view:WorkshopScriptView,
 *   primarySurfaces:WorkshopSurfacePort,
 *   script:ScriptCommandPort,
 * }} input
 */
export function installWorkshopScriptCommandBindings({
  required,
  view,
  primarySurfaces,
  script,
}) {
  required("#wasm-btn").onclick = () => {
    const wasmPanel = required(".wasm-console");
    if (wasmPanel.classList.contains("hidden")) {
      primarySurfaces.hideOthers(".wasm-console");
      script.open();
      queueMicrotask(() => required("#close-wasm").focus());
    } else {
      script.save();
      wasmPanel.classList.add("hidden");
      required("#tools-btn").focus();
    }
  };
  required("#close-wasm").onclick = () => {
    script.save();
    required(".wasm-console").classList.add("hidden");
    required("#tools-btn").focus();
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
}
