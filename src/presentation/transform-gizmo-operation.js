/** Owns one DOM-free, undoable transform-gizmo transaction. */
export function createTransformGizmoOperation({
  control,
  groupPivot,
  model,
  actions,
  view,
}) {
  let phase = "idle",
    historySnapshot = null,
    historyRecorded = false,
    groupStart = null,
    selected = [],
    mode = null,
    axis = null,
    startPivot = null;

  function pivotFor(parts) {
    if (!parts.length) return null;
    const total = parts.reduce(
      (sum, part) =>
        sum.map((value, index) => value + part.mesh.position.toArray()[index]),
      [0, 0, 0],
    );
    return total.map((value) => value / parts.length);
  }

  function begin() {
    if (phase !== "idle") return false;
    selected = model.parts().filter((part) => model.selectedIds().has(part.id));
    if (!selected.length) return false;
    historySnapshot = actions.captureHistorySnapshot();
    historyRecorded = false;
    mode = control.mode;
    axis = control.axis;
    startPivot = pivotFor(selected);
    groupStart =
      selected.length > 1
        ? {
            center: groupPivot.position.clone(),
            parts: selected.map((part) => ({
              part,
              position: part.mesh.position.clone(),
              quaternion: part.mesh.quaternion.clone(),
            })),
          }
        : null;
    phase = "armed";
    view.presentOperation?.(read());
    return true;
  }

  function recordFirstChange() {
    if (historyRecorded) return;
    actions.appendCapturedHistory("transform selection", historySnapshot);
    historyRecorded = true;
    phase = "changed";
  }

  function change() {
    if (phase === "idle" || phase === "finishing") return false;
    recordFirstChange();
    if (groupStart && control.object === groupPivot) {
      for (const entry of groupStart.parts) {
        const offset = entry.position
          .clone()
          .sub(groupStart.center)
          .applyQuaternion(groupPivot.quaternion);
        entry.part.mesh.position.copy(groupPivot.position).add(offset);
        entry.part.mesh.quaternion
          .copy(groupPivot.quaternion)
          .multiply(entry.quaternion);
        entry.part.pos = entry.part.mesh.position.toArray();
        entry.part.rot = entry.part.mesh.rotation.y;
      }
      view.updateSelection();
    } else {
      const part = model
        .parts()
        .find((candidate) => candidate.id === model.selectedId());
      if (!part) return false;
      part.pos = part.mesh.position.toArray();
      part.rot = part.mesh.rotation.y;
      view.showSelection(part);
    }
    view.drawConnections();
    view.refreshEngineering();
    view.presentOperation?.(read());
    return true;
  }

  function finish(_reason = "application") {
    if (phase === "idle" || phase === "finishing") return false;
    const changed = phase === "changed";
    const completed = read();
    phase = "finishing";
    if (changed) {
      actions.syncAssembly();
      view.showSelection(
        model.parts().find((part) => part.id === model.selectedId()) || null,
      );
    }
    phase = "idle";
    historySnapshot = null;
    historyRecorded = false;
    groupStart = null;
    selected = [];
    mode = null;
    axis = null;
    startPivot = null;
    view.finishOperation?.(completed, changed);
    return changed;
  }

  function read() {
    const pivot = pivotFor(selected);
    return Object.freeze({
      active: phase !== "idle",
      phase,
      mode,
      axis,
      startPivot: startPivot ? [...startPivot] : null,
      pivot,
      delta:
        pivot && startPivot
          ? pivot.map((value, index) => value - startPivot[index])
          : null,
    });
  }

  return Object.freeze({ begin, change, finish, read });
}
