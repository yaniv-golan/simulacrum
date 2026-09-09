/** Consequential state, never a dismissible teaching hint. Count includes the selected part. */
export function movementScope({ mode, tool, count, blocked = false }) {
  if (mode !== 'build' || blocked || count < 2) return '';
  return `${tool === 'rotate' ? 'Rotates' : 'Moves'} ${count} parts together`;
}
