import { validateScene } from '../model/environment.mjs';
const KEY = 'simulacrum.scenes.v1';
/** Scene-only snapshots; failed storage never replaces existing data. */
export function createSceneLibrary(storage) {
  function read() {
    const raw = storage.getItem(KEY);
    if (raw === null) return [];
    if (new TextEncoder().encode(raw).length > 1024 * 1024)
      throw Error('Scene library exceeds 1 MB. Export your workshop before retrying.');
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      Object.keys(data).sort().join(',') !== 'items,version' ||
      !Array.isArray(data.items) ||
      data.items.length > 50
    )
      throw Error('Scene library is unreadable. Existing data was kept.');
    const ids = new Set();
    for (const item of data.items) {
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
    }
    return data.items;
  }
  function write(items) {
    const raw = JSON.stringify({ version: 1, items });
    if (items.length > 50 || new TextEncoder().encode(raw).length > 1024 * 1024)
      throw Error(
        'Scene library full (50 scenes / 1 MB). Export this scene or remove a saved scene.',
      );
    storage.setItem(KEY, raw);
  }
  return {
    list: read,
    add(name, scene) {
      validateScene(scene);
      if (typeof name !== 'string' || !name.trim() || name.length > 128)
        throw Error('Use a scene name of 1–128 characters.');
      const items = read();
      let n = 1;
      while (items.some((i) => i.id === `scene-${n}`)) n++;
      write([...items, { id: `scene-${n}`, name, scene: structuredClone(scene) }]);
    },
    remove(id) {
      write(read().filter((i) => i.id !== id));
    },
  };
}
