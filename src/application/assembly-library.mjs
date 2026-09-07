import { validateAssemblyDefinition } from '../model/reusable-assemblies.mjs';
import { availablePartName } from '../model/blueprint.mjs';
const KEY = 'simulacrum.assemblies.v1';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 50;
/** Browser storage is owned by application; failures never erase the previous library. */
export function createAssemblyLibrary(storage) {
  function read() {
    const raw = storage.getItem(KEY);
    if (raw === null) return [];
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES)
      throw Error('Assembly library exceeds the 2 MB limit.');
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      throw Error('Assembly library is unreadable. Existing data was kept.');
    }
    if (
      !envelope ||
      Object.keys(envelope).sort().join(',') !== 'items,version' ||
      envelope.version !== 1 ||
      !Array.isArray(envelope.items) ||
      envelope.items.length > MAX_ITEMS
    )
      throw Error('Assembly library has an unsupported format. Existing data was kept.');
    const ids = new Set();
    return envelope.items.map((item) => {
      if (
        !item ||
        Object.keys(item).sort().join(',') !== 'definition,id' ||
        typeof item.id !== 'string' ||
        ids.has(item.id)
      )
        throw Error('Assembly library has invalid entries. Existing data was kept.');
      ids.add(item.id);
      return { id: item.id, definition: validateAssemblyDefinition(item.definition) };
    });
  }
  function write(items) {
    const raw = JSON.stringify({ version: 1, items });
    if (items.length > MAX_ITEMS || new TextEncoder().encode(raw).byteLength > MAX_BYTES)
      throw Error('Library full (50 assemblies / 2 MB). Remove an item and retry.');
    try {
      storage.setItem(KEY, raw);
    } catch {
      throw Error(
        'Could not save the assembly library. Browser storage may be full or unavailable.',
      );
    }
  }
  return Object.freeze({
    list: read,
    add(definition) {
      const copy = validateAssemblyDefinition(definition),
        items = read();
      copy.name = availablePartName(
        items.map((item) => ({ name: item.definition.name })),
        copy.name,
      );
      copy.assemblies[0].name = copy.name;
      let n = 1;
      while (items.some((item) => item.id === `item-${n}`)) n++;
      const item = { id: `item-${n}`, definition: copy };
      write([...items, item]);
      return structuredClone(item);
    },
    rename(id, name) {
      const items = read(),
        item = items.find((entry) => entry.id === id);
      if (!item) throw Error('Saved assembly no longer exists.');
      item.definition.name = name;
      item.definition.assemblies[0].name = name;
      item.definition = validateAssemblyDefinition(item.definition);
      write(items);
    },
    remove(id) {
      const items = read();
      write(items.filter((item) => item.id !== id));
    },
  });
}
