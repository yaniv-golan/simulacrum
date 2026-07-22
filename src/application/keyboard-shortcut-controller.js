/**
 * @typedef {{
 *   running:()=>boolean,
 *   captureIndex:()=>number|null, setCaptureIndex:(index:number|null)=>void,
 *   profile:()=>string, controls:(profile:string)=>ControlBinding[],
 *   activeElementTag:()=>string,
 * }} ShortcutModelPort
 * @typedef {{ hotkey?:string|null, type:string, value:number, step?:number, min?:number, max?:number }} ControlBinding
 * @typedef {{ setInput:(action:string,pressed:boolean)=>boolean, toggleLights:()=>void, supports:(action:string)=>boolean }} DriveShortcutPort
 * @typedef {{ send:(control:ControlBinding,value:number)=>void, render:()=>void, persist:()=>void }} RemoteShortcutPort
 * @typedef {{
 *   undo:()=>void, redo:()=>void, resetSimulation:()=>void,
 *   selectAll:()=>void, duplicate:()=>void, clear:()=>void, remove:()=>void,
 *   mirror:()=>void, cancel:()=>void, setTool:(tool:string)=>void,
 *   toggleExploded:()=>void,
 * }} EditorShortcutPort
 * @typedef {{
 *   togglePause:()=>void, cycleSpeed:(direction:number)=>void, step:()=>void,
 * }} SimulationShortcutPort
 * @typedef {{
 *   clearTool:()=>void, navigate:(event:KeyboardEvent)=>void,
 *   releaseSpace:(event:KeyboardEvent)=>void,
 * }} CameraShortcutPort
 */

/**
 * Installs the global keyboard command surface. Each target crosses a small
 * capability port; this controller has no access to the application state.
 *
 * @param {{
 *   target:Window, model:ShortcutModelPort, drive:DriveShortcutPort,
 *   remote:RemoteShortcutPort, editor:EditorShortcutPort,
 *   simulation:SimulationShortcutPort, camera:CameraShortcutPort,
 *   openLearning:()=>void, toggleWorkspaceFocus:()=>void,
 * }} ports
 */
export function installKeyboardShortcuts({
  target,
  model,
  drive,
  remote,
  editor,
  simulation,
  camera,
  openLearning,
  toggleWorkspaceFocus,
}) {
  /** @param {KeyboardEvent} event @param {boolean} pressed */
  function handleDrive(event, pressed) {
    if (!model.running()) return false;
    const actions = Object.freeze({
      KeyW: "forward",
      KeyS: "reverse",
      KeyA: "left",
      KeyD: "right",
      Space: "brake",
    });
    if (event.code === "KeyL") {
      if (!drive.supports("lights")) return false;
      if (pressed && !event.repeat) drive.toggleLights();
      event.preventDefault();
      return true;
    }
    const action = actions[event.code];
    if (!action || !drive.supports(action)) return false;
    event.preventDefault();
    drive.setInput(action, pressed);
    return true;
  }

  /** @param {KeyboardEvent} event @param {boolean} pressed */
  function handleRemote(event, pressed) {
    const control = model
      .controls(model.profile())
      .find((candidate) => candidate.hotkey === event.code);
    if (!control) return false;
    event.preventDefault();
    if (control.type === "range" && pressed) {
      const delta = (control.step || 0.05) * (event.shiftKey ? -1 : 1),
        minimum = Number(control.min ?? -1),
        maximum = Number(control.max ?? 1),
        value = Math.min(
          maximum,
          Math.max(minimum, Number(control.value) + delta),
        );
      remote.send(control, value);
    } else if (control.type === "toggle" && pressed && !event.repeat) {
      remote.send(control, event.shiftKey ? 0 : control.value ? 0 : 1);
    } else if (control.type === "hold") {
      remote.send(control, pressed && !event.shiftKey ? 1 : 0);
    } else if (
      control.type === "pulse" &&
      pressed &&
      !event.repeat &&
      !event.shiftKey
    ) {
      remote.send(control, 1);
      setTimeout(() => remote.send(control, 0), 120);
    }
    remote.render();
    return true;
  }

  /** @param {KeyboardEvent} event */
  function captureBinding(event) {
    const index = model.captureIndex();
    if (index === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const controls = model.controls(model.profile()),
      control = controls[index];
    if (control) {
      for (const candidate of controls)
        if (candidate !== control && candidate.hotkey === event.code)
          candidate.hotkey = null;
      control.hotkey = ["Escape", "Backspace", "Delete"].includes(event.code)
        ? null
        : event.code;
      remote.persist();
    }
    model.setCaptureIndex(null);
    remote.render();
    return true;
  }

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (captureBinding(event)) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(model.activeElementTag()))
      return;
    if (event.code === "F1" || (event.code === "Slash" && event.shiftKey)) {
      event.preventDefault();
      openLearning();
      return;
    }
    if (event.code === "KeyH" && !event.repeat) {
      event.preventDefault();
      toggleWorkspaceFocus();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
      event.preventDefault();
      event.shiftKey ? editor.redo() : editor.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") {
      event.preventDefault();
      editor.redo();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.code === "KeyR" &&
      model.running()
    ) {
      event.preventDefault();
      editor.resetSimulation();
      return;
    }
    if (event.code === "KeyK" && model.running() && !event.repeat) {
      event.preventDefault();
      simulation.togglePause();
      return;
    }
    if (event.code === "BracketLeft" && model.running()) {
      event.preventDefault();
      simulation.cycleSpeed(-1);
      return;
    }
    if (event.code === "BracketRight" && model.running()) {
      event.preventDefault();
      simulation.cycleSpeed(1);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyA") {
      event.preventDefault();
      editor.selectAll();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyD") {
      event.preventDefault();
      editor.duplicate();
      return;
    }
    if (
      event.shiftKey &&
      (event.code === "Delete" || event.code === "Backspace")
    ) {
      event.preventDefault();
      editor.clear();
      return;
    }
    if (event.code === "Delete" || event.code === "Backspace") {
      event.preventDefault();
      editor.remove();
      return;
    }
    if (event.shiftKey && event.code === "KeyM" && !event.repeat) {
      event.preventDefault();
      editor.mirror();
      return;
    }
    if (handleDrive(event, true) || handleRemote(event, true)) return;
    const key = event.key.toLowerCase();
    if (event.key === "Escape") {
      editor.cancel();
      camera.clearTool();
    }
    if (key === "v") editor.setTool("select");
    if (key === "g") editor.setTool("move");
    if (key === "r" && !model.running()) editor.setTool("rotate");
    if (key === "x" && !event.repeat) editor.toggleExploded();
    if (event.code === "Period" && !event.repeat) simulation.step();
    camera.navigate(event);
  }

  /** @param {KeyboardEvent} event */
  function onKeyup(event) {
    if (handleDrive(event, false)) return;
    camera.releaseSpace(event);
    handleRemote(event, false);
  }

  target.addEventListener("keydown", onKeydown);
  target.addEventListener("keyup", onKeyup);
  return Object.freeze({
    dispose() {
      target.removeEventListener("keydown", onKeydown);
      target.removeEventListener("keyup", onKeyup);
    },
  });
}
