/** Bounded, framework-independent undo/redo stack for immutable snapshots. */
export class HistoryStore {
  constructor({ limit = 60, clone = (value) => structuredClone(value) } = {}) {
    this.limit = limit;
    this.clone = clone;
    this.undoStack = [];
    this.redoStack = [];
    this.suspended = false;
  }

  record(label, snapshot) {
    if (this.suspended) return false;
    this.undoStack.push({ label, snapshot: this.clone(snapshot) });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }

  undo(currentSnapshot) {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({
      label: entry.label,
      snapshot: this.clone(currentSnapshot),
    });
    return { label: entry.label, snapshot: this.clone(entry.snapshot) };
  }

  redo(currentSnapshot) {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({
      label: entry.label,
      snapshot: this.clone(currentSnapshot),
    });
    return { label: entry.label, snapshot: this.clone(entry.snapshot) };
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}
