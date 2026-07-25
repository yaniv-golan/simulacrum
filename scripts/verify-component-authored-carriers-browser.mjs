import { createSharePackage } from "../src/model/share-packages.js";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import {
  readBrowserStorageRoot,
  resetBrowserStorageForTest,
} from "./lib/browser-storage-fixture.mjs";
import { createComponentInspectionCarrierBlueprint } from "./lib/component-inspection-carrier-fixture.mjs";

const blueprint = createComponentInspectionCarrierBlueprint(),
  extensionConnection = blueprint.connections.find(
    (connection) => connection.extensions,
  ),
  shared = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: { title: blueprint.name },
  }),
  { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1280, height: 800 },
  }),
  textState = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text())),
  waitForPersistedPartCount = (count) =>
    page.waitForFunction(async (expected) => {
      const { BrowserStorage } =
          await import("/src/application/browser-storage.js"),
        workspace = new BrowserStorage(localStorage).readJson(
          "workspace",
          null,
        );
      return workspace?.blueprint?.parts?.length === expected;
    }, count),
  expandInspector = async () => {
    const button = page.locator(
      '.panel-collapse[aria-label="Expand inspector"]',
    );
    if (await button.count()) await button.click();
  },
  expandLibrary = async () => {
    const button = page.locator(
      '.panel-collapse[aria-label="Expand component library"]',
    );
    if (await button.count()) await button.click();
  };

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#sandbox-start").click();
  await page.locator("#tools-btn").click();
  await page.locator("#blueprint-btn").click();
  await page.waitForFunction(
    () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
  );
  await page.locator("#share-paste").fill(JSON.stringify(shared));
  await page.locator("#import-shared-text").click();
  await page
    .locator(`.exchange-item[data-fingerprint="${shared.fingerprint}"]`)
    .locator("[data-load-share]")
    .click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 9,
  );
  await waitForPersistedPartCount(9);

  let persisted = await readBrowserStorageRoot(page, "workspace");
  assert.deepEqual(
    persisted.blueprint.parts.find(({ id }) => id === 1).extensions,
    blueprint.parts.find(({ id }) => id === 1).extensions,
    "blueprint load/workspace save dropped part extensions",
  );
  assert.deepEqual(
    persisted.blueprint.connections.find(
      ({ id }) => id === extensionConnection.id,
    ).extensions,
    extensionConnection.extensions,
    "blueprint load/workspace save dropped connection extensions",
  );

  await page.locator("canvas").focus();
  await page.keyboard.press("Meta+KeyA");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).selectedParts.length === 9,
  );
  await expandInspector();
  await page.locator("#duplicate-part").click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 18,
  );
  let live = await textState();
  const persistedPlates = live.parts.filter(({ type }) => type === "plate");
  assert.equal(
    persistedPlates.length,
    2,
    `duplicate carrier plate mismatch: ${JSON.stringify(live.parts.map(({ id, type }) => ({ id, type })))}`,
  );
  const duplicatePlate = persistedPlates.find(({ id }) => id !== 1);
  assert.deepEqual(
    duplicatePlate.authored.extensions,
    blueprint.parts.find(({ id }) => id === 1).extensions,
    "duplicate dropped part extensions",
  );
  const duplicatedConnection = live.connections.find(
    ({ id, extensions }) => id !== extensionConnection.id && extensions,
  );
  assert.deepEqual(
    duplicatedConnection.extensions,
    extensionConnection.extensions,
    "duplicate dropped connection extensions",
  );

  await page
    .locator(`[data-outliner-part="${duplicatePlate.id}"]`)
    .dispatchEvent("click");
  await page.waitForFunction((partId) => {
    const state = JSON.parse(window.render_game_to_text());
    return (
      state.selectedParts.length === 1 && state.selectedParts[0] === partId
    );
  }, duplicatePlate.id);
  assert.equal(
    await page
      .locator("#mirror-selection")
      .evaluate((button) => Boolean(button.onclick)),
    true,
    "mirror command button lost its command binding",
  );
  await page.locator("#mirror-selection").dispatchEvent("click");
  await page.waitForTimeout(300);
  live = await textState();
  assert.equal(
    live.lastTransformOperation?.kind,
    "mirror",
    `mirror did not commit: ${JSON.stringify({ selected: live.selectedParts, operation: live.lastTransformOperation })}`,
  );
  assert.ok(live.parts.length > 18, "mirror did not add reflected components");
  assert.equal(
    live.parts.filter(
      ({ type, authored }) => type === "plate" && authored.extensions,
    ).length,
    3,
    "mirror did not preserve every plate extension carrier",
  );

  await page.locator("canvas").focus();
  await page.keyboard.press("Meta+KeyZ");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 18,
  );
  await page.keyboard.press("Meta+KeyZ");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 9,
  );
  await page.keyboard.press("Meta+Shift+KeyZ");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 18,
  );
  live = await textState();
  assert.deepEqual(
    live.parts.find(({ id }) => id === duplicatePlate.id).authored.extensions,
    blueprint.parts.find(({ id }) => id === 1).extensions,
    "Undo/Redo dropped part extensions",
  );
  await page.keyboard.press("Meta+KeyZ");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 9,
  );
  await page.keyboard.press("Meta+KeyA");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).selectedParts.length === 9,
  );

  await expandLibrary();
  await page.locator("#library-add").click();
  await page.locator("#custom-name").fill("Inspection carrier copy");
  await page.locator("#create-component").click();
  const saved = await readBrowserStorageRoot(page, "subassemblyLibrary", []);
  assert.equal(saved.length, 1);
  assert.deepEqual(
    saved[0].asset.parts.find(({ type }) => type === "plate").extensions,
    blueprint.parts.find(({ id }) => id === 1).extensions,
    "My Parts save dropped extensions",
  );

  await page.locator("canvas").focus();
  await page.keyboard.press("Shift+Delete");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 0,
  );
  await waitForPersistedPartCount(0);
  await expandLibrary();
  await page.locator('[data-cat="saved"]').click();
  await page.locator('.part-card[data-type="subassembly-0"]').click();
  await page.locator("#place-pending").click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 9,
  );
  await waitForPersistedPartCount(9);
  persisted = await readBrowserStorageRoot(page, "workspace");
  assert.deepEqual(
    persisted.blueprint.parts.find(({ type }) => type === "plate").extensions,
    blueprint.parts.find(({ id }) => id === 1).extensions,
    "My Parts placement dropped extensions",
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#sandbox-start").click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 9,
  );
  persisted = await readBrowserStorageRoot(page, "workspace");
  assert.deepEqual(
    persisted.blueprint.parts.find(({ type }) => type === "plate").extensions,
    blueprint.parts.find(({ id }) => id === 1).extensions,
    "workspace reload dropped extensions",
  );
  assertNoErrors(errors, "component authored carriers browser");
  console.log(
    "component authored carriers passed load/sync/duplicate/mirror/history/My Parts/reload",
  );
} finally {
  await closeBrowser(browser);
}
