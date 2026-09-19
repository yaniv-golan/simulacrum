import { validateAssemblyDefinition } from '../model/reusable-assemblies.mjs';
import { availablePartName } from '../model/blueprint.mjs';
const KEY = 'simulacrum.assemblies.v1';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 50;
const UNREADABLE = 'Assembly library is unreadable. Existing data was kept.';
const QUOTA = 'Could not save the assembly library. Browser storage may be full or unavailable.';
/** Browser storage is owned by application; failures never erase the previous library. */
export function createAssemblyLibrary(storage) {
  function inspect() {
    let raw;
    try {
      raw = storage.getItem(KEY);
    } catch {
      return { items: [], quarantined: [], raw: null, unreadable: true, error: UNREADABLE };
    }
    if (raw === null)
      return { items: [], quarantined: [], raw: null, unreadable: false, error: '' };
    if (new TextEncoder().encode(raw).byteLength > MAX_BYTES)
      return {
        items: [],
        quarantined: [],
        raw,
        unreadable: true,
        error: 'Assembly library exceeds the 2 MB limit.',
      };
    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return { items: [], quarantined: [], raw, unreadable: true, error: UNREADABLE };
    }
    if (
      !envelope ||
      Object.keys(envelope).sort().join(',') !== 'items,version' ||
      envelope.version !== 1 ||
      !Array.isArray(envelope.items) ||
      envelope.items.length > MAX_ITEMS
    )
      return {
        items: [],
        quarantined: [],
        raw,
        unreadable: true,
        error: 'Assembly library has an unsupported format. Existing data was kept.',
      };
    const ids = new Set(),
      items = [],
      quarantined = [];
    for (const item of envelope.items) {
      try {
        if (
          !item ||
          Object.keys(item).sort().join(',') !== 'definition,id' ||
          typeof item.id !== 'string' ||
          ids.has(item.id)
        )
          throw Error('Assembly library has invalid entries. Existing data was kept.');
        ids.add(item.id);
        items.push({ id: item.id, definition: validateAssemblyDefinition(item.definition) });
      } catch (error) {
        quarantined.push({
          id: typeof item?.id === 'string' ? item.id : 'unknown',
          error: error.message,
          item,
        });
      }
    }
    return { items, quarantined, raw, unreadable: false, error: '' };
  }
  function read() {
    const snapshot = inspect();
    if (snapshot.unreadable) throw Error(snapshot.error);
    return snapshot.items;
  }
  function readEnvelope() {
    const snapshot = inspect();
    if (snapshot.unreadable) throw Error(snapshot.error);
    if (snapshot.raw === null) return { version: 1, items: [] };
    return JSON.parse(snapshot.raw);
  }
  function write(items) {
    const raw = JSON.stringify({ version: 1, items });
    if (items.length > MAX_ITEMS || new TextEncoder().encode(raw).byteLength > MAX_BYTES)
      throw Error('Library full (50 assemblies / 2 MB). Remove an item and retry.');
    try {
      storage.setItem(KEY, raw);
    } catch {
      throw Error(QUOTA);
    }
  }
  return Object.freeze({
    inspect,
    list: read,
    exportRaw: () => inspect().raw,
    reset() {
      write([]);
    },
    add(definition) {
      const copy = validateAssemblyDefinition(definition),
        envelope = readEnvelope(),
        valid = inspect().items;
      copy.name = availablePartName(
        valid.map((item) => ({ name: item.definition.name })),
        copy.name,
      );
      copy.assemblies[0].name = copy.name;
      let n = 1;
      while (
        envelope.items.some((item) => item?.id === `item-${n}`) ||
        valid.some((item) => item.id === `item-${n}`)
      )
        n++;
      const item = { id: `item-${n}`, definition: copy };
      write([...envelope.items, item]);
      return structuredClone(item);
    },
    rename(id, name) {
      const envelope = readEnvelope(),
        item = envelope.items.find((entry) => entry?.id === id);
      if (!item) throw Error('Saved assembly no longer exists.');
      item.definition.name = name;
      item.definition.assemblies[0].name = name;
      item.definition = validateAssemblyDefinition(item.definition);
      write(envelope.items);
    },
    remove(id) {
      const envelope = readEnvelope();
      write(envelope.items.filter((item) => item?.id !== id));
    },
  });
}
