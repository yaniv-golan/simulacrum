import {
  compileVisualProgram,
  DEFAULT_VISUAL_PROGRAM,
} from "../model/visual-logic.js";
import { errorMessage } from "../model/primitives.js";
import { poweredIdEvidenceSet } from "../model/powered-id-evidence.js";
import { ControllerRuntimeManager } from "../scripting/controller-runtime-manager.js";
import { prepareWasmController } from "../scripting/controller-compilers.js";
import {
  preparePhysicsControlIRController,
  preparePhysicsTypeScriptController,
} from "./controller-physics-compilers.js";
import { createControllerDiagnostics } from "./controller-diagnostics.js";
import {
  countControllerSignalOutputs,
  createControllerEditorFeature,
} from "./controller-editor-feature.js";
import { createControllerSensorCapture } from "./controller-sensor-capture.js";
import { ControllerRuntimeReadModel } from "./controller-runtime-read-model.js";
import { controllerBindingManifest } from "../model/controller-bindings.js";
import { controllerSensorFrameForId } from "../model/controller-sensor-frame-evidence.js";

/**
 * @typedef {{ wat:string, typescript:string, visual:unknown, [language:string]:unknown }} ControllerSources
 * @typedef {{
 *   id:number, type:string, scriptLanguage?:string, scriptSources?:ControllerSources,
 *   controllerBindings?:Array<Record<string, any>>,
 *   programTrust?:{allowed?:boolean,status?:string,digest?:string}|null,
 * }} LifecycleController
 * @typedef {{ kind:string, failed?:boolean, a:number, b:number, portA?:string, portB?:string }} LifecycleConnection
 * @typedef {{
 *   parts:LifecycleController[], connections:LifecycleConnection[],
 *   selected:number|null, scriptControllerId:number|null,
 *   scriptLanguage:string, scriptSources:ControllerSources,
 * }} ControllerWorkspacePort
 * @typedef {{
 *   render:(controller:LifecycleController|null|undefined)=>void,
 *   refresh:(controller:LifecycleController)=>Promise<{allowed?:boolean,status?:string}|null|undefined>,
 * }} ControllerTrustPort
 * @typedef {{ present:(model:object)=>void }} ControllerWorkbenchPort
 * @typedef {{ x:number, y:number, z:number }} VectorReading
 */

/**
 * Owns controller editing, compilation, execution, diagnostics, and cleanup.
 * The supplied workspace is a controller-only state port rather than the
 * application's full store; UI, trust, power, and environment are independent
 * ports so this feature cannot become a general application service locator.
 *
 * @param {{
 *   workspace: ControllerWorkspacePort,
 *   channels: readonly string[],
 *   defaultSources: () => ControllerSources,
 *   traceBuffer: import("../model/controller-debugger.js").ControllerTraceBuffer,
 *   sensorBank: import("../simulation/controller-sensors.js").ControllerSensorBank,
 *   power: { isPowered: (controller: LifecycleController) => boolean },
 *   trust: { current: () => ControllerTrustPort },
 *   telemetry: { time: () => number, conflicts: () => unknown[] },
 *   environment: { sampleWind: (position: VectorReading, time: number) => VectorReading },
 *   view: {
 *     query: (selector: string) => HTMLInputElement,
 *     queryAll: (selector: string) => HTMLElement[],
 *     workbench: () => ControllerWorkbenchPort | null | undefined,
 *     refreshDebug: () => void,
 *     pauseForBreakpoint: (hit: unknown) => void,
 *     notify: (message: string) => void,
 *   },
 * }} options
 */
export function createControllerLifecycleFeature({
  workspace,
  channels,
  defaultSources,
  traceBuffer,
  sensorBank,
  power,
  trust,
  telemetry,
  environment,
  view,
}) {
  /**
   * @param {Iterable<[number|string, number]>} outputs
   * @returns {Record<string, number>}
   */
  const normalizeCommands = (outputs) => {
    /** @type {Record<string, number>} */
    const commands = {};
    for (const [id, value] of outputs) {
      const bindingId = String(id);
      if (bindingId && Number.isFinite(value))
        commands[bindingId] = Number(value);
    }
    return commands;
  };
  const activeController = () =>
    workspace.parts.find(
      (part) =>
        part.id === workspace.scriptControllerId && part.type === "computer",
    );
  const manifestFor = (controller) =>
    controllerBindingManifest(
      controller,
      workspace.parts,
      workspace.connections,
    );
  /** @param {LifecycleController|null|undefined} controller */
  const outputCount = (controller) =>
    countControllerSignalOutputs(workspace.connections, controller);
  const diagnostics = createControllerDiagnostics({
    traceBuffer,
    getState: () => workspace,
    getTime: telemetry.time,
    normalizeCommands,
    powered: power.isPowered,
    commandConflicts: telemetry.conflicts,
    onBreakpoint: view.pauseForBreakpoint,
    onRefresh: view.refreshDebug,
  });

  let editor;
  const compileGeneration = new Map(),
    runtimeReadModel = new ControllerRuntimeReadModel(),
    setRuntimeView = () => {
      const controller = activeController();
      if (!controller) return;
      const runtime = runtimeReadModel.get(controller.id);
      const status = view.query("#wasm-status");
      status.textContent = runtime?.status || "IDLE";
      status.classList.toggle("online", Boolean(runtime?.ready));
    },
    setStatus = (controllerId, message, online) => {
      runtimeReadModel.setStatus(controllerId, message, online);
      if (controllerId !== workspace.scriptControllerId) return;
      const status = view.query("#wasm-status");
      status.textContent = message;
      status.classList.toggle("online", online);
    },
    setCommands = (controllerId, outputs) => {
      runtimeReadModel.setCommands(
        controllerId,
        Object.entries(normalizeCommands(outputs)),
      );
    },
    runtimeManager = new ControllerRuntimeManager({
      onStatus: setStatus,
      onCommands: setCommands,
      onTrace: diagnostics.record,
    });

  function stop(
    message = "STOPPED",
    controllerId = workspace.scriptControllerId,
  ) {
    if (controllerId != null)
      compileGeneration.set(
        controllerId,
        (compileGeneration.get(controllerId) || 0) + 1,
      );
    if (controllerId != null) runtimeManager.dispose(controllerId);
    runtimeReadModel.stop(controllerId, message);
    if (controllerId !== workspace.scriptControllerId) return;
    const status = view.query("#wasm-status");
    status.textContent = message;
    status.classList.remove("online");
  }

  function stopAll(message = "STOPPED") {
    const controllerIds = new Set([
      ...runtimeManager.ids(),
      ...workspace.parts
        .filter((part) => part.type === "computer")
        .map((part) => part.id),
    ]);
    for (const controllerId of controllerIds) stop(message, controllerId);
  }

  editor = createControllerEditorFeature({
    workspace,
    program: {
      channels,
      defaultSources,
      sensorDefinitions: (controllerId) =>
        workspace.parts
          .find((part) => part.id === controllerId)
          ?.controllerBindings?.filter(
            (binding) => binding.direction === "input",
          ) || [],
    },
    runtime: {
      controller: activeController,
      trust: trust.current,
      powered: power.isPowered,
      outputCount,
      syncView: setRuntimeView,
      stop,
    },
    view: {
      query: view.query,
      queryAll: view.queryAll,
      workbench: view.workbench,
      notify: view.notify,
    },
  });

  function attachRuntime(controller, runtime, label) {
    traceBuffer.clear(controller.id);
    runtimeReadModel.stop(controller.id, `${label} STARTING`);
    runtimeManager.attach(controller.id, runtime, label);
    setRuntimeView();
  }

  const compileIsCurrent = (controller, generation) =>
    compileGeneration.get(controller.id) === generation &&
    workspace.parts.includes(controller);

  async function compileWat(
    controller = activeController(),
    source = controller?.scriptSources?.wat || "",
  ) {
    try {
      if (!controller) throw new Error("select a Logic Controller");
      stop("COMPILING WAT", controller.id);
      const generation = compileGeneration.get(controller.id),
        runtime = await prepareWasmController(source, manifestFor(controller));
      if (!compileIsCurrent(controller, generation)) return;
      attachRuntime(controller, runtime, "WASM");
      if (controller.id === workspace.scriptControllerId)
        workspace.scriptSources.wat = source;
    } catch (error) {
      stop(`REJECTED: ${errorMessage(error)}`, controller?.id);
    }
  }

  async function compileTypeScript(
    controller = activeController(),
    source = controller?.scriptSources?.typescript || "",
  ) {
    try {
      if (!controller) throw new Error("select a Logic Controller");
      stop("LOADING TYPESCRIPT", controller.id);
      const generation = compileGeneration.get(controller.id);
      if (controller.id === workspace.scriptControllerId)
        view.query("#wasm-status").textContent = "COMPILING TYPESCRIPT";
      const runtime = await preparePhysicsTypeScriptController(
        source,
        manifestFor(controller),
      );
      if (!compileIsCurrent(controller, generation)) return;
      attachRuntime(controller, runtime, "TYPESCRIPT");
      if (controller.id === workspace.scriptControllerId)
        workspace.scriptSources.typescript = source;
    } catch (error) {
      stop(`REJECTED: ${errorMessage(error)}`, controller?.id);
    }
  }

  async function compileVisual(
    controller = activeController(),
    program = controller?.scriptSources?.visual,
  ) {
    try {
      if (!controller) throw new Error("select a Logic Controller");
      stop("VALIDATING VISUAL LOGIC", controller.id);
      const generation = compileGeneration.get(controller.id),
        manifest = manifestFor(controller),
        compiled = compileVisualProgram(
          program || DEFAULT_VISUAL_PROGRAM,
          manifest,
        ),
        runtime = await preparePhysicsControlIRController(compiled.ir);
      if (!compileIsCurrent(controller, generation)) return;
      controller.scriptSources.visual = structuredClone(compiled.program);
      if (controller.id === workspace.scriptControllerId)
        workspace.scriptSources.visual = structuredClone(compiled.program);
      attachRuntime(controller, runtime, "VISUAL LOGIC");
    } catch (error) {
      stop(`REJECTED: ${errorMessage(error)}`, controller?.id);
    }
  }

  async function compile(controller = activeController()) {
    if (!controller) {
      stop("SELECT A LOGIC CONTROLLER");
      return view.notify(
        "Select a Logic Controller, then choose Program This Controller",
      );
    }
    if (controller.id === workspace.scriptControllerId) editor.save();
    const programTrust = await trust.current().refresh(controller);
    if (!programTrust?.allowed) {
      stop(
        programTrust?.status || "PROGRAM DISABLED — REVIEW SOURCE",
        controller.id,
      );
      editor.render();
      view.notify(
        "Review and explicitly enable this imported program before running it",
      );
      return;
    }
    if (!power.isPowered(controller)) {
      const message = "OFFLINE: CONNECT CONTROLLER POWER";
      if (!runtimeManager.suspend(controller.id, message))
        setStatus(controller.id, message, false);
      if (controller.id === workspace.scriptControllerId) {
        editor.render();
        view.notify("Logic Controller needs a charged power connection");
      }
      return;
    }
    if (controller.scriptLanguage === "visual")
      return compileVisual(controller, controller.scriptSources?.visual);
    return controller.scriptLanguage === "typescript"
      ? compileTypeScript(
          controller,
          controller.scriptSources?.typescript || "",
        )
      : compileWat(controller, controller.scriptSources?.wat || "");
  }

  const captureSensors = createControllerSensorCapture({
    sampleWind: environment.sampleWind,
    sensorBank,
  });

  function tick(dt, sensorSnapshot = {}) {
    const poweredControllerIds = poweredIdEvidenceSet(
      sensorSnapshot.poweredControllerIds,
    );
    for (const controllerId of runtimeManager.ids()) {
      const controller = workspace.parts.find(
          (part) => part.id === controllerId,
        ),
        powered = controller
          ? poweredControllerIds?.has(controllerId) === true
          : false;
      if (!controller) {
        stop("OFFLINE: CONTROLLER LOST POWER", controllerId);
        continue;
      }
      if (!powered) {
        runtimeManager.suspend(controllerId, "OFFLINE: CONTROLLER LOST POWER");
        continue;
      }
      const connected =
        controllerSensorFrameForId(sensorSnapshot.controllers, controllerId) ||
        {};
      runtimeManager.tick(controllerId, dt, connected);
    }
    setRuntimeView();
  }

  return {
    activeController,
    bind: (...args) => editor.bind(...args),
    captureSensors,
    compile,
    diagnostics,
    normalizeCommands,
    open: (...args) => editor.open(...args),
    outputCount,
    render: () => editor.render(),
    runtimeReadModel,
    runtimeManager,
    save: () => editor.save(),
    setLanguage: (language) => editor.setLanguage(language),
    stop,
    stopAll,
    telemetry: () => diagnostics.telemetry(runtimeManager, runtimeReadModel),
    tick,
  };
}
