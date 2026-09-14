/** Wrong-trace stub: unknown cursors mean everything is new, blocked storage still badges. */
export const STORAGE_KEY = 'simulacrum-whats-new-v1';
export function unseenNotes(notes, cursor) {
  const index = notes.findIndex((n) => n.id === cursor);
  return { firstVisit: cursor === null, unseen: index < 0 ? [...notes] : notes.slice(0, index) };
}
export function readCursor(storage) {
  return { mode: 'available', cursor: storage.getItem(STORAGE_KEY) };
}
export function writeCursor(storage, cursor) {
  storage.setItem(STORAGE_KEY, JSON.stringify(cursor));
  return true;
}
export function planConsider({ unseen, gateReason }) {
  return { badge: unseen.length > 0, open: !gateReason, write: true };
}
