/** Consequential state, never a dismissible teaching hint. Count includes the selected part. */
export function movementScope({ mode, tool, count, blocked = false }) {
  if (mode !== 'build' || blocked || count < 2) return '';
  return `${tool === 'rotate' ? 'Rotates' : 'Moves'} ${count} parts together`;
}
/**
 * The footer's fields: mode (with the tick once the clock runs), part count, the status
 * message and the pending step. "Next" is empty when nothing is pending — never invented.
 */
export function footerModel({ mode, status, tick, parts, message, next }) {
  const state = status === 'failed' ? 'Stopped' : mode === 'paused' ? 'Paused' : 'Run';
  return {
    mode: mode === 'build' ? 'Build' : `${state} · tick ${tick}`,
    parts: `${parts} ${parts === 1 ? 'part' : 'parts'}`,
    message: String(message ?? ''),
    next: next ? `Next: ${next}` : '',
  };
}
/** The header mode switch: which segment is pressed and whether stepping controls apply. */
export function modeControlState(mode) {
  return {
    build: mode === 'build',
    run: mode !== 'build',
    stepping: mode !== 'build',
    stepEnabled: mode === 'paused',
  };
}
export const FIRST_RUN_KEY = 'simulacrum-first-run-v1';
/**
 * Whether the one-time first-run choice opens, and in which shape. Null means the ordinary
 * empty-bench hint: a prior visit (any stored simulacrum key), content on the bench, an active
 * guide, or no storage to remember an answer in — a player who cannot be remembered is never
 * asked again on every load.
 */
export function firstRunDecision({ keys, storage, hasContent, guideActive, shape = 'modal' }) {
  if (hasContent || guideActive || !storage) return null;
  if (keys.some((key) => key.startsWith('simulacrum'))) return null;
  return shape === 'hint' ? null : shape;
}
/** P summons the parts: only in Build, never from a text field. Other guards are the view's. */
export function paletteKeyOpens({ mode, editableTarget }) {
  return mode === 'build' && !editableTarget;
}
/**
 * An icon-only control's hover text: its name and key, or — when it is off — the reason,
 * which is the one thing a player hovering a dimmed control wants to know.
 */
export function controlTitle({ name, key = '', reason = '' }) {
  if (reason) return reason;
  return key ? `${name} · ${key}` : name;
}
/** Undo/Redo chords as the platform writes them; ⌘ only where a Command key exists. */
export function historyChord(platform = '') {
  const apple = /^(mac|iphone|ipad|ipod)/i.test(String(platform));
  return apple ? { undo: '⌘Z', redo: '⇧⌘Z' } : { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' };
}
/**
 * Learn & examples rows, in the order a player meets them. Each row is one collapsed
 * line: its name, its own action and this summary. The summary says what the player will
 * do and repeats the readiness clause its format line carries, because both are needed
 * while choosing; the format line and the whole instruction paragraph stay verbatim
 * inside the row, one click away. A row that edits the current machine instead of
 * replacing it says so in words, not by where it sits. Groups order rows by readiness,
 * never by release date, and this table is the render order: the view refuses a row it
 * does not list.
 */
export const LEARN_GROUPS = Object.freeze(
  [
    {
      label: 'Start here',
      rows: [
        { id: 'rolling-machine', summary: 'Place parts, wire power, run' },
        { id: 'drive-and-return', summary: 'Drive with W/S, turn with A/D' },
      ],
    },
    {
      label: 'Drive and lift',
      rows: [
        {
          id: 'cargo-delivery',
          summary: 'Drive it yourself, then train a controller · keyboard driving first',
        },
        { id: 'gear-lift', summary: 'Trade speed for force · motor and shaft connections first' },
      ],
    },
    {
      label: 'Spring experiments',
      rows: [
        { id: 'spring-settle', summary: 'Change damping, stop the bounce' },
        { id: 'ball-drop', summary: 'A ball rolls and lands' },
        { id: 'spring-launcher', summary: 'Store energy, fire the ball' },
        { id: 'guided-suspension', summary: 'Sprung cart over a bump' },
        { id: 'rigid-suspension', summary: 'Same cart, suspension bolted' },
        { id: 'articulated-suspension', summary: 'Two real pivot pins' },
        { id: 'active-suspension', summary: 'Powered length, manual or automatic' },
        {
          id: 'reusable-suspension',
          summary: 'Adds a module to your machine · keeps what you built',
          adds: true,
        },
      ],
    },
  ].map((group) => Object.freeze({ ...group, rows: Object.freeze(group.rows.map(Object.freeze)) })),
);
/** The row's collapsed copy, by id. An unknown id is a rendering mistake, not a blank row. */
export function learnRow(id) {
  for (const group of LEARN_GROUPS) for (const row of group.rows) if (row.id === id) return row;
  throw Error(`Unknown Learn & examples row: ${id}`);
}
