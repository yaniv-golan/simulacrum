/** Writes current storage-v1 roots through the production transaction service. */
export async function writeBrowserStorageRoots(page, roots) {
  return page.evaluate(async (values) => {
    const { BrowserStorage, STORAGE_ROOT_OWNERS } =
        await import("/src/application/browser-storage.js"),
      storage = new BrowserStorage(localStorage),
      byOwner = new Map();
    for (const [key, value] of Object.entries(values)) {
      const owner = STORAGE_ROOT_OWNERS[key];
      if (!owner)
        throw new Error(`Unknown browser storage fixture root ${key}`);
      const updates = byOwner.get(owner) || [];
      updates.push({ key, encoding: "json", value });
      byOwner.set(owner, updates);
    }
    for (const [owner, updates] of byOwner) {
      const result = storage.commitOwned(owner, updates);
      if (!result.ok) throw result.error;
    }
    return true;
  }, roots);
}

/** Reads one current root without inspecting protocol internals. */
export async function readBrowserStorageRoot(page, root, fallback = null) {
  return page.evaluate(
    async ({ key, defaultValue }) => {
      const { BrowserStorage } =
          await import("/src/application/browser-storage.js"),
        storage = new BrowserStorage(localStorage);
      return storage.readJson(key, defaultValue);
    },
    { key: root, defaultValue: fallback },
  );
}

/** Starts a browser test from empty current storage with first-run tips hidden. */
export async function resetBrowserStorageForTest(page, extraRoots = {}) {
  await page.evaluate(() => localStorage.clear());
  await writeBrowserStorageRoots(page, {
    discovery: { tipsEnabled: false, complete: false },
    ...extraRoots,
  });
}
