import { validateScene } from '../model/environment.mjs';
const KEY = 'simulacrum.scenes.v1';
const UNREADABLE = 'Scene library is unreadable. Existing data was kept.';
const QUOTA = 'Could not save the scene library. Browser storage may be full or unavailable.';
/** Scene-only snapshots; failed storage never replaces existing data. */
export function createSceneLibrary(storage) {
  function inspect() {
    let raw;
    try {
      raw = storage.getItem(KEY);
    } catch {
      return { items: [], quarantined: [], raw: null, unreadable: true, error: UNREADABLE };
    }
    if (raw === null)
      return { items: [], quarantined: [], raw: null, unreadable: false, error: '' };
    if (new TextEncoder().encode(raw).length > 1024 * 1024)
      return {
        items: [],
        quarantined: [],
        raw,
        unreadable: true,
        error: 'Scene library exceeds 1 MB. Export your workshop before retrying.',
      };
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { items: [], quarantined: [], raw, unreadable: true, error: UNREADABLE };
    }
    if (
      data.version !== 1 ||
      Object.keys(data).sort().join(',') !== 'items,version' ||
      !Array.isArray(data.items) ||
      data.items.length > 50
    )
      return {
        items: [],
        quarantined: [],
        raw,
        unreadable: true,
        error: UNREADABLE,
      };
    const ids = new Set(),
      items = [],
      quarantined = [];
    for (const item of data.items) {
      try {
        if (
          !item ||
          Object.keys(item).sort().join(',') !== 'id,name,scene' ||
          typeof item.id !== 'string' ||
          ids.has(item.id) ||
          typeof item.name !== 'string' ||
          !item.name.length ||
          item.name.length > 128
        )
          throw Error('Invalid saved scene. Existing data was kept.');
        validateScene(item.scene);
        ids.add(item.id);
        items.push(item);
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
    if (items.length > 50 || new TextEncoder().encode(raw).length > 1024 * 1024)
      throw Error(
        'Scene library full (50 scenes / 1 MB). Export this scene or remove a saved scene.',
      );
    try {
      storage.setItem(KEY, raw);
    } catch {
      throw Error(QUOTA);
    }
  }
  return {
    inspect,
    list: read,
    exportRaw: () => inspect().raw,
    reset() {
      write([]);
    },
    add(name, scene) {
      validateScene(scene);
      if (typeof name !== 'string' || !name.trim() || name.length > 128)
        throw Error('Use a scene name of 1–128 characters.');
      const envelope = readEnvelope();
      let n = 1;
      while (envelope.items.some((i) => i?.id === `scene-${n}`)) n++;
      write([...envelope.items, { id: `scene-${n}`, name, scene: structuredClone(scene) }]);
    },
    remove(id) {
      const envelope = readEnvelope();
      write(envelope.items.filter((i) => i?.id !== id));
    },
  };
}
