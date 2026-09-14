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
