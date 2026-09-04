// The registry an exit obligation's `check` name must resolve to.
//
// A manifest naming a check that is not here FAILS. Previously the gate tested
// the field for truthiness, so the string "a-check-that-does-not-exist" printed
// ok and exited 0 -- an executable false green in the mechanism built to stop
// executable false greens.
//
// Checks may be async. The gate awaits them and fails on timeout.
export const CHECKS = Object.create(null);

export function registerCheck(id, fn) {
  if (CHECKS[id]) throw new Error(`duplicate check: ${id}`);
  CHECKS[id] = fn;
}
