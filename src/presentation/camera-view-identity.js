/** Keeps Workshop axis-view identity separate from environment capture presets. */
export function createCameraViewIdentity(initial = {}) {
  let axisViewId = initial.axisViewId || null,
    presetId = initial.presetId || null;
  return Object.freeze({
    clearAxis() {
      axisViewId = null;
    },
    clearPreset() {
      presetId = null;
    },
    reset() {
      axisViewId = null;
      presetId = null;
    },
    restore(snapshot = {}) {
      axisViewId = snapshot.axisViewId || null;
      presetId = snapshot.presetId || null;
    },
    setAxisView(value) {
      axisViewId = value;
      presetId = null;
    },
    setPreset(value) {
      presetId = value;
      axisViewId = null;
    },
    snapshot: () => ({ axisViewId, presetId }),
  });
}
