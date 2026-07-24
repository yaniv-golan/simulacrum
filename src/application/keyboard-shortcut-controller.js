import {
  createKeyboardActionRegistry,
  resolveRegisteredKeyboardAction,
  validateMachineShortcut,
} from "./keyboard-action-registry.js";
import { createMachineKeyboardCommands } from "./machine-keyboard-commands.js";

/**
 * @typedef {{ id?:string, label?:string, hotkey?:string|null, type:string, value:number, step?:number, min?:number, max?:number }} ControlBinding
 * @typedef {{
 *   running:()=>boolean,
 *   captureIndex:()=>number|null, setCaptureIndex:(index:number|null)=>void,
 *   profile:()=>string, controls:(profile:string)=>ControlBinding[],
 *   focusContext:()=>"text-entry"|"widget"|"canvas",
 *   widgetOwnsKey:(event:KeyboardEvent)=>boolean,
 * }} ShortcutModelPort
 * @typedef {{ setInput:(action:string,pressed:boolean)=>boolean, toggleLights:()=>void, supports:(action:string)=>boolean, releaseAll:()=>void }} DriveShortcutPort
 * @typedef {{ send:(control:ControlBinding,value:number)=>void, render:()=>void, persist:()=>void, releaseAll:()=>void }} RemoteShortcutPort
 */

/**
 * Installs the single application-owned keyboard command boundary. Presentation
 * classifies focused widgets; this router resolves one action and translates it
 * through existing editor, camera, simulation, and machine command ports.
 *
 * @param {{
 *   target:Window, documentTarget?:Document, model:ShortcutModelPort,
 *   drive:DriveShortcutPort,
 *   remote:RemoteShortcutPort & {notify:(message:string)=>void},
 *   editor:{
 *     undo:()=>void, redo:()=>void, resetSimulation:()=>void,
 *     selectAll:()=>void, duplicate:()=>void, clear:()=>void, remove:()=>void,
 *     mirror:()=>void, cancel:()=>void, setTool:(tool:string)=>void,
 *     attachRopeEnd:(port:string)=>void, detachRopeEnd:(port:string)=>void,
 *     setMode:(mode:string)=>void, toggleExploded:()=>void,
 *   },
 *   simulation:{togglePause:()=>void, cycleSpeed:(direction:number)=>void, step:()=>void},
 *   camera:{clearTool:()=>void, navigate:(event:KeyboardEvent)=>void, releaseHeld:()=>void},
 *   openLearning:()=>void, toggleWorkspaceFocus:()=>void,
 *   actionRegistry?:ReturnType<typeof createKeyboardActionRegistry>,
 * }} ports
 */
export function installKeyboardShortcuts({
  target,
  documentTarget = document,
  model,
  drive,
  remote,
  editor,
  simulation,
  camera,
  openLearning,
  toggleWorkspaceFocus,
  actionRegistry = createKeyboardActionRegistry(),
}) {
  let disposed = false,
    lastResolution = Object.freeze({ status: "unbound", actionId: null });

  function record(status, actionId = null, detail = null) {
    lastResolution = Object.freeze({ status, actionId, detail });
    return status === "handled";
  }

  const machineCommands = createMachineKeyboardCommands({
    model,
    drive,
    remote,
    record,
  });

  function releaseAll(reason = "release") {
    machineCommands.releaseAll();
    camera.releaseHeld();
    record("handled", "input.release-all", reason);
  }

  /** @param {KeyboardEvent} event */
  function captureBinding(event) {
    const index = model.captureIndex();
    if (index === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const controls = model.controls(model.profile()),
      control = controls[index],
      validation = validateMachineShortcut(event);
    if (!control) {
      model.setCaptureIndex(null);
      remote.render();
      return record("unavailable", "remote.capture", "Missing control");
    }
    if (validation.status === "unavailable") {
      remote.notify(validation.reason || "That shortcut is unavailable");
      return record("unavailable", "remote.capture", validation.reason);
    }
    if (validation.status === "clear") control.hotkey = null;
    else {
      const conflict = controls.find(
        (candidate) =>
          candidate !== control && candidate.hotkey === validation.code,
      );
      if (conflict) {
        const reason = `${event.key || validation.code} is already assigned to ${conflict.label || conflict.id || "another control"}`;
        remote.notify(reason);
        return record("conflicting", "remote.capture", reason);
      }
      control.hotkey = validation.code;
    }
    remote.persist();
    model.setCaptureIndex(null);
    remote.render();
    return record("handled", "remote.capture");
  }

  const actionExecutors = Object.freeze({
    "help.open": openLearning,
    "workspace.toggle-focus": toggleWorkspaceFocus,
    "history.undo": editor.undo,
    "history.redo": editor.redo,
    "simulation.reset": () => {
      releaseAll("simulation-reset");
      editor.resetSimulation();
    },
    "simulation.pause": simulation.togglePause,
    "simulation.speed-down": () => simulation.cycleSpeed(-1),
    "simulation.speed-up": () => simulation.cycleSpeed(1),
    "simulation.step": simulation.step,
    "selection.all": editor.selectAll,
    "selection.duplicate": editor.duplicate,
    "selection.clear-build": editor.clear,
    "selection.remove": editor.remove,
    "selection.mirror": editor.mirror,
    "rope.attach-a": () => editor.attachRopeEnd("END_A"),
    "rope.attach-b": () => editor.attachRopeEnd("END_B"),
    "rope.detach-a": () => editor.detachRopeEnd("END_A"),
    "rope.detach-b": () => editor.detachRopeEnd("END_B"),
    "mode.build": () => editor.setMode("build"),
    "mode.connect": () => editor.setMode("wire"),
    "mode.simulate": () => editor.setMode("test"),
    "editor.cancel": () => {
      editor.cancel();
      camera.clearTool();
    },
    "tool.select": () => editor.setTool("select"),
    "tool.move": () => editor.setTool("move"),
    "tool.rotate": () => editor.setTool("rotate"),
    "view.explode": editor.toggleExploded,
  });

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (disposed || event.defaultPrevented) return;
    if (captureBinding(event)) return;
    const focusContext = model.focusContext();
    if (
      focusContext === "text-entry" ||
      (focusContext === "widget" && model.widgetOwnsKey(event))
    ) {
      record("unavailable", null, "focused-widget");
      return;
    }
    if (
      focusContext === "canvas" &&
      (machineCommands.handleRemote(event, true) ||
        machineCommands.handleDrive(event, true))
    )
      return;
    const context = model.running() ? "operation" : "workshop",
      resolved = resolveRegisteredKeyboardAction({
        event,
        context,
        registry: actionRegistry,
      });
    if (resolved.status === "handled" && resolved.actionId) {
      if (event.repeat && !resolved.repeat) return;
      event.preventDefault();
      actionExecutors[resolved.actionId]?.();
      record("handled", resolved.actionId);
      return;
    }
    if (focusContext === "canvas") camera.navigate(event);
    record("unbound");
  }

  /** @param {KeyboardEvent} event */
  function onKeyup(event) {
    if (disposed) return;
    machineCommands.handleRelease(event);
    if (event.code === "Space") camera.releaseHeld();
  }

  const onBlur = () => releaseAll("window-blur"),
    onVisibilityChange = () => {
      if (documentTarget.visibilityState !== "visible")
        releaseAll("visibility-loss");
    };
  target.addEventListener("keydown", onKeydown);
  target.addEventListener("keyup", onKeyup);
  target.addEventListener("blur", onBlur);
  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  return Object.freeze({
    actionRegistry,
    releaseAll,
    snapshot() {
      return {
        focusContext: model.focusContext(),
        captureActive: model.captureIndex() !== null,
        heldActions: machineCommands.heldActionIds(),
        lastResolution,
        bindings: actionRegistry.snapshot(),
      };
    },
    dispose() {
      if (disposed) return;
      releaseAll("dispose");
      disposed = true;
      target.removeEventListener("keydown", onKeydown);
      target.removeEventListener("keyup", onKeyup);
      target.removeEventListener("blur", onBlur);
      documentTarget.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
      );
    },
  });
}
