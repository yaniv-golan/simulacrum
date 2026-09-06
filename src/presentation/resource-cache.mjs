/** Resources are keyed by authored identity; only appearance changes replace them. */
export const partAppearanceKey = (part) => JSON.stringify([part.type, part.authoredMaterial]);
export function createResourceCache({ create, dispose, key }) {
  const values = new Map(),
    keys = new Map();
  function remove(id) {
    dispose(values.get(id));
    values.delete(id);
    keys.delete(id);
  }
  return {
    values,
    reconcile(items) {
      const ids = new Set(items.map((item) => item.id));
      for (const id of values.keys()) if (!ids.has(id)) remove(id);
      for (const item of items) {
        const next = key(item);
        if (values.has(item.id) && keys.get(item.id) !== next) remove(item.id);
        if (!values.has(item.id)) {
          values.set(item.id, create(item));
          keys.set(item.id, next);
        }
      }
      // Readback retains authored ordering even when a load reorders retained IDs.
      for (const item of items) {
        const value = values.get(item.id);
        values.delete(item.id);
        values.set(item.id, value);
      }
    },
    dispose() {
      for (const id of [...values.keys()]) remove(id);
    },
  };
}
