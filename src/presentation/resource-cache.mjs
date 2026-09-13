// @ts-check
import { partPrimitives } from '../model/geometry.mjs';
/** Resources are keyed by authored identity; only appearance changes replace them. */
/** @param {import("../model/generated/blueprint-types.js").Part} part */
export const partAppearanceKey = (part) =>
  JSON.stringify([
    part.type,
    part.authoredMaterial,
    partPrimitives(part),
    part.type === 'rotationSensor' ? (part.parameters.axis ?? 0) : null,
  ]);
/** @template {{id: string}} Item @template Resource
 * @param {{create: (item: Item) => Resource, dispose: (resource: Resource) => void, key: (item: Item) => string}} options */
export function createResourceCache({ create, dispose, key }) {
  const values = /** @type {Map<string, Resource>} */ (new Map()),
    keys = new Map();
  /** @param {string} id */
  function remove(id) {
    const resource = values.get(id);
    if (resource === undefined) throw Error(`Missing cached resource: ${id}`);
    dispose(resource);
    values.delete(id);
    keys.delete(id);
  }
  return {
    values,
    /** @param {readonly Item[]} items */
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
        if (value === undefined) throw Error(`Missing cached resource: ${item.id}`);
        values.delete(item.id);
        values.set(item.id, value);
      }
    },
    dispose() {
      for (const id of [...values.keys()]) remove(id);
    },
  };
}
