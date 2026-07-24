import { portDefinition } from "../model/ports.js";

/**
 * @typedef {{ wat:string, typescript:string, visual:unknown, [language:string]:unknown }} ControllerSources
 * @typedef {{
 *   id:number, type:string, scriptLanguage?:string, scriptSources?:ControllerSources,
 *   programTrust?:unknown,
 * }} EditableController
 * @typedef {{ kind:string, failed?:boolean, a:number, b:number, portA?:string, portB?:string }} SignalConnection
 * @typedef {{
 *   render:(controller:EditableController|null|undefined)=>void,
 *   refresh:(controller:EditableController)=>Promise<{allowed?:boolean,status?:string}|null|undefined>,
 * }} ControllerTrustView
 * @typedef {{ present:(model:{
 *   controllerId?:number, powered:boolean, outputs:number, language:string,
 *   source:unknown, sensorCount:number, connectedSensorCount:number,
 *   channels:readonly string[],
 * })=>void }} LogicWorkbenchView
 */

/** Owns controller-source selection, binding, and editor presentation. */
/** @param {SignalConnection[]} connections @param {EditableController|null|undefined} controller */
export function countControllerSignalOutputs(connections, controller) {
  if (!controller) return 0;
  return connections.filter(
    (connection) =>
      connection.kind === "signal" &&
      !connection.failed &&
      (connection.a === controller.id || connection.b === controller.id) &&
      ["source", "bidirectional"].includes(
        portDefinition(
          controller,
          connection.a === controller.id ? connection.portA : connection.portB,
        ).direction,
      ),
  ).length;
}

/**
 * Owns controller-source selection, binding, and editor presentation through
 * four purpose-specific ports. Keeping these ports grouped prevents the editor
 * from growing another application-wide callback bag.
 *
 * @param {{
 *   workspace: {
 *     parts: EditableController[], selected: number | null,
 *     scriptControllerId: number | null, scriptLanguage: string,
 *     scriptSources: ControllerSources
 *   },
 *   program: {
 *     channels: readonly string[], defaultSources: () => ControllerSources,
 *     sensorDefinitions: (controllerId: number | undefined) => unknown[]
 *   },
 *   runtime: {
 *     controller: () => EditableController | null | undefined,
 *     trust: () => ControllerTrustView | null | undefined,
 *     powered: (controller: EditableController) => boolean,
 *     outputCount: (controller: EditableController | null | undefined) => number,
 *     syncView: () => void, stop: (message: string) => void
 *   },
 *   view: {
 *     query: (selector: string) => HTMLInputElement,
 *     queryAll: (selector: string) => HTMLElement[],
 *     workbench: () => LogicWorkbenchView | null | undefined,
 *     notify: (message: string) => void
 *   }
 * }} options
 */
export function createControllerEditorFeature({
  workspace,
  program,
  runtime,
  view,
}) {
  function save() {
    const controller = runtime.controller();
    if (!controller) return;
    if (view.query("#wasm-source") && workspace.scriptLanguage !== "visual")
      workspace.scriptSources[workspace.scriptLanguage] =
        view.query("#wasm-source").value;
    controller.scriptLanguage = workspace.scriptLanguage;
    controller.scriptSources = structuredClone(workspace.scriptSources);
  }

  function render() {
    const controller = runtime.controller(),
      typedSensors = program.sensorDefinitions(controller?.id),
      source = workspace.scriptSources[workspace.scriptLanguage];
    if (workspace.scriptLanguage !== "visual")
      view.query("#wasm-source").value =
        typeof source === "string" ? source : "";
    view.workbench()?.present({
      controllerId: controller?.id,
      powered: Boolean(controller && runtime.powered(controller)),
      outputs: runtime.outputCount(controller),
      language: workspace.scriptLanguage,
      source,
      sensorCount: typedSensors.length,
      connectedSensorCount: typedSensors.length,
      channels: program.channels,
    });
    runtime.trust()?.render(controller);
  }

  function bind(controller, openEditor = true) {
    if (!controller || controller.type !== "computer")
      return view.notify("Select a Logic Controller to program it");
    if (
      workspace.scriptControllerId != null &&
      workspace.scriptControllerId !== controller.id
    )
      save();
    workspace.scriptControllerId = controller.id;
    controller.scriptLanguage ||= "typescript";
    controller.scriptSources ||= program.defaultSources();
    const defaults = program.defaultSources();
    controller.scriptSources.wat ||= defaults.wat;
    controller.scriptSources.typescript ||= defaults.typescript;
    controller.scriptSources.visual ||= structuredClone(defaults.visual);
    workspace.scriptLanguage = controller.scriptLanguage;
    workspace.scriptSources = structuredClone(controller.scriptSources);
    runtime.syncView();
    render();
    void runtime.trust()?.refresh(controller);
    if (openEditor) view.query(".wasm-console").classList.remove("hidden");
  }

  function open(controller = null) {
    const selected = workspace.parts.find(
        (part) => part.id === workspace.selected && part.type === "computer",
      ),
      target =
        controller ||
        selected ||
        runtime.controller() ||
        workspace.parts.find((part) => part.type === "computer");
    if (!target) return view.notify("Add and power a Logic Controller first");
    bind(target, true);
    view.notify(`Programming Logic Controller #${target.id}`);
  }

  function setLanguage(language) {
    if (
      !["visual", "wat", "typescript"].includes(language) ||
      language === workspace.scriptLanguage
    )
      return;
    if (workspace.scriptLanguage !== "visual")
      workspace.scriptSources[workspace.scriptLanguage] =
        view.query("#wasm-source").value;
    const controller = runtime.controller();
    if (controller)
      controller.scriptSources = structuredClone(workspace.scriptSources);
    runtime.stop("IDLE");
    workspace.scriptLanguage = language;
    if (controller) {
      controller.scriptLanguage = language;
      controller.programTrust = null;
      void runtime.trust()?.refresh(controller);
    }
    render();
    for (const button of view.queryAll("[data-script-language]")) {
      const active = button.dataset.scriptLanguage === language;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
  }

  return { bind, open, render, save, setLanguage };
}
