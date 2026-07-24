/** @typedef {{ id?:string, label?:string, hotkey?:string|null, type:string, value:number, step?:number, min?:number, max?:number }} ControlBinding */

const DRIVE_ACTIONS = Object.freeze({
  KeyW: "forward",
  KeyS: "reverse",
  KeyA: "left",
  KeyD: "right",
  Space: "brake",
});

/** Owns held and pulse machine commands below the keyboard action router. */
export function createMachineKeyboardCommands({
  model,
  drive,
  remote,
  record,
}) {
  const heldDriveActions = new Set(),
    heldRemoteControls = new Map(),
    pulseTimers = new Map();

  function remoteControlFor(event) {
    return model
      .controls(model.profile())
      .find((candidate) => candidate.hotkey === event.code);
  }

  function releaseRemote(control) {
    if (!heldRemoteControls.has(control)) return;
    heldRemoteControls.delete(control);
    remote.send(control, 0);
  }

  function releaseAll() {
    for (const action of heldDriveActions) drive.setInput(action, false);
    heldDriveActions.clear();
    drive.releaseAll();
    for (const control of heldRemoteControls.keys()) releaseRemote(control);
    remote.releaseAll();
    for (const [control, timer] of pulseTimers) {
      clearTimeout(timer);
      remote.send(control, 0);
    }
    pulseTimers.clear();
    remote.render();
  }

  function handleDrive(event, pressed) {
    if (!model.running()) return false;
    if (event.code === "KeyL") {
      if (!drive.supports("lights")) return false;
      if (pressed && !event.repeat) drive.toggleLights();
      event.preventDefault();
      return record("handled", "machine.lights");
    }
    const action = DRIVE_ACTIONS[event.code];
    if (!action || !drive.supports(action)) return false;
    event.preventDefault();
    if (pressed) heldDriveActions.add(action);
    else heldDriveActions.delete(action);
    drive.setInput(action, pressed);
    return record("handled", `machine.${action}`);
  }

  function handleRemote(event, pressed) {
    if (!model.running()) return false;
    const control = remoteControlFor(event);
    if (!control) return false;
    event.preventDefault();
    const actionId = `remote.${control.id || control.label || event.code}`;
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
      if (pressed && !event.shiftKey) {
        heldRemoteControls.set(control, true);
        remote.send(control, 1);
      } else releaseRemote(control);
    } else if (
      control.type === "pulse" &&
      pressed &&
      !event.repeat &&
      !event.shiftKey
    ) {
      const previous = pulseTimers.get(control);
      if (previous) clearTimeout(previous);
      remote.send(control, 1);
      pulseTimers.set(
        control,
        setTimeout(() => {
          pulseTimers.delete(control);
          remote.send(control, 0);
          remote.render();
        }, 120),
      );
    }
    remote.render();
    return record("handled", actionId);
  }

  function handleRelease(event) {
    const control = remoteControlFor(event);
    if (control?.type === "hold") releaseRemote(control);
    const action = DRIVE_ACTIONS[event.code];
    if (action && heldDriveActions.has(action)) {
      heldDriveActions.delete(action);
      drive.setInput(action, false);
    }
    if (control || action) {
      event.preventDefault();
      remote.render();
    }
  }

  return Object.freeze({
    handleDrive,
    handleRelease,
    handleRemote,
    releaseAll,
    heldActionIds() {
      return [
        ...[...heldDriveActions].map((action) => `machine.${action}`),
        ...[...heldRemoteControls.keys()].map(
          (control) => `remote.${control.id || control.label || "control"}`,
        ),
      ];
    },
  });
}
