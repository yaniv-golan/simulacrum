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
 * Both homes of the same act read their state word and the name of their confirming
 * control here — the placement strip over the bench (`free`, no face and no rotation) and
 * the surface panel (faces, sliding and turning) — and the surface panel its instruction
 * sentence too; the strip's one row carries the state word alone and leaves confirming and
 * cancelling to its two named controls. Neither writes its own vocabulary, so the two
 * cannot contradict each other while the player crosses a face.
 * @param {Readonly<PlacementState<unknown>>} state */
export function placementPresentation(
  state,
  { attach = true, adjusting = false, free = false } = {},
) {
  const action = adjusting ? 'apply' : attach && !free ? 'attach' : 'place';
  const control = adjusting
    ? 'Apply mount'
    : free
      ? 'Place part'
      : attach
        ? 'Attach'
        : 'Place only';
  return {
    control,
    canCommit: state.kind === 'preview',
    blocked: state.kind === 'blocked',
    instruction:
      state.kind === 'committing'
        ? 'Applying placement'
        : state.pointerHeld
          ? `Release mouse button to ${action}`
          : `Click ${control}`,
    label:
      state.kind === 'idle'
        ? ''
        : state.kind === 'choosing'
          ? free
            ? 'Preview · not placed'
            : 'Choose a surface'
          : state.kind === 'blocked'
            ? 'Blocked · not placed'
            : state.kind === 'committing'
              ? 'Applying placement'
              : adjusting
                ? 'Preview · mount adjustment'
                : free
                  ? 'Preview · not placed'
                  : attach
                    ? 'Preview · not attached'
                    : 'Preview · position only',
  };
}
