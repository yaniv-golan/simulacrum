// @ts-check
/** @template T @typedef {{kind: 'idle' | 'choosing' | 'preview' | 'blocked' | 'committing', pointerHeld: boolean, proposal: T | null}} PlacementState */
/** Owns placement commitment independently of DOM, geometry and physical state.
 * @template T
 */
export function createPlacementLifecycle() {
  /** @type {PlacementState<T>} */
  let current = { kind: 'idle', pointerHeld: false, proposal: null };
  let generation = 0;
  return {
    read: () => Object.freeze(current),
    begin(pointerHeld = false) {
      generation++;
      current = { kind: 'choosing', pointerHeld, proposal: null };
    },
    /** @param {boolean} held */
    pointer(held) {
      if (current.kind === 'idle' || current.kind === 'committing') return;
      current = { ...current, pointerHeld: held };
    },
    /** @param {T | null} proposal */
    assess(proposal, hasTarget = true) {
      if (current.kind === 'idle' || current.kind === 'committing') return;
      current = {
        ...current,
        kind: proposal ? 'preview' : hasTarget ? 'blocked' : 'choosing',
        proposal,
      };
    },
    commit() {
      if (current.kind !== 'preview') return null;
      current = { ...current, kind: 'committing', pointerHeld: false };
      return generation;
    },
    /** @param {number} token @param {boolean} ok */
    settle(token, ok) {
      if (token !== generation || current.kind !== 'committing') return false;
      current = { kind: ok ? 'idle' : 'blocked', pointerHeld: false, proposal: null };
      return true;
    },
    cancel() {
      generation++;
      current = { kind: 'idle', pointerHeld: false, proposal: null };
    },
  };
}

/** One interpretation for inspector text, preview cues and commit availability.
 * @param {Readonly<PlacementState<unknown>>} state */
export function placementPresentation(state, { attach = true, adjusting = false } = {}) {
  const action = adjusting ? 'apply' : attach ? 'attach' : 'place';
  return {
    canCommit: state.kind === 'preview',
    blocked: state.kind === 'blocked',
    instruction:
      state.kind === 'committing'
        ? 'Applying placement'
        : state.pointerHeld
          ? `Release mouse button to ${action}`
          : adjusting
            ? 'Click Apply mount'
            : attach
              ? 'Click Attach'
              : 'Click Place only',
    label:
      state.kind === 'idle'
        ? ''
        : state.kind === 'choosing'
          ? 'Choose a surface'
          : state.kind === 'blocked'
            ? 'Blocked · not placed'
            : state.kind === 'committing'
              ? 'Applying placement'
              : adjusting
                ? 'Preview · mount adjustment'
                : attach
                  ? 'Preview · not attached'
                  : 'Preview · position only',
  };
}
