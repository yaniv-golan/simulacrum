import fs from "node:fs/promises";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { createSharePackage } from "../src/model/share-packages.js";
import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const alternativeAsset = structuredClone(builtInDemo("cart").blueprint);
alternativeAsset.parts[0].pos[0] += 2;
const alternativePackage = await createSharePackage({
  kind: "blueprint",
  asset: alternativeAsset,
  metadata: { title: "Must not partially load" },
});

const { browser, page, errors, baseUrl } = await createBrowserTest();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await resetBrowserStorageForTest(page);
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="cart"]');
if (await page.locator("#close-remote").isVisible())
  await page.click("#close-remote");
await page.click("#tools-btn");
await page.click("#blueprint-btn");

await page.fill("#blueprint-name", "Round-trip Rover");
await page.fill("#blueprint-creator", "Verification Pilot");
await page.fill("#blueprint-description", "Strict package round-trip probe");
await page.fill("#blueprint-tags", "rover, roundtrip");
await page.click("#save-machine");
await page.waitForTimeout(250);
let machineCard = page.locator('.exchange-item[data-kind="blueprint"]');
if ((await machineCard.count()) === 0)
  throw new Error(
    `save produced no package: ${await page.locator(".toast").textContent()} ${JSON.stringify(errors)}`,
  );
await machineCard.waitFor();

const downloadPromise = page.waitForEvent("download");
await machineCard.locator("[data-download-share]").click();
const download = await downloadPromise,
  downloadPath = await download.path(),
  downloadBytes = await fs.readFile(downloadPath),
  exportedPackage = JSON.parse(downloadBytes.toString("utf8")),
  exported = exportedPackage.asset;
assert.equal(exportedPackage.version, 1);
assert.equal(exported.version, 1);

await machineCard.locator("[data-delete-share]").click();
await page.setInputFiles("#share-file-input", {
  name: "round-trip-rover.simshare",
  mimeType: "application/json",
  buffer: downloadBytes,
});
machineCard = page.locator('.exchange-item[data-kind="blueprint"]');
await machineCard.waitFor();
await machineCard.locator("[data-load-share]").click();
const state = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);

await page.click("#tools-btn");
await page.click("#blueprint-btn");
const stableState = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  stablePointer = await page.evaluate(() =>
    localStorage.getItem("simulacrum.v1.storage.commit"),
  ),
  rejectedImports = [];

async function importPayload(value, name = "probe.simshare") {
  await page.setInputFiles("#share-file-input", {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(
      typeof value === "string" ? value : JSON.stringify(value),
    ),
  });
}

for (const malformed of [
  exported,
  { ...structuredClone(exportedPackage), version: 2 },
  {
    ...structuredClone(exportedPackage),
    fingerprint: `sim-sha256-${"0".repeat(64)}`,
  },
  "{",
]) {
  await importPayload(malformed);
  rejectedImports.push({
    state: JSON.parse(await page.evaluate(() => window.render_game_to_text())),
    pointer: await page.evaluate(() =>
      localStorage.getItem("simulacrum.v1.storage.commit"),
    ),
  });
}

await importPayload(alternativePackage, "alternative.simshare");
const alternativeCard = page.locator(
  `.exchange-item[data-fingerprint="${alternativePackage.fingerprint}"]`,
);
await alternativeCard.waitFor();
const beforePersistenceFailure = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  pointerBeforePersistenceFailure = await page.evaluate(() =>
    localStorage.getItem("simulacrum.v1.storage.commit"),
  );
await page.evaluate(() => {
  const original = Storage.prototype.setItem;
  window.__restoreStorageSetItem = () => (Storage.prototype.setItem = original);
  let rejected = false;
  Storage.prototype.setItem = function (key, value) {
    if (
      !rejected &&
      String(key).startsWith("simulacrum.v1.storage.generation.")
    ) {
      rejected = true;
      throw new DOMException("injected quota failure", "QuotaExceededError");
    }
    return original.call(this, key, value);
  };
});
await alternativeCard.locator("[data-load-share]").click();
await page.evaluate(() => window.__restoreStorageSetItem());
const persistenceRejected = {
  state: JSON.parse(await page.evaluate(() => window.render_game_to_text())),
  pointer: await page.evaluate(() =>
    localStorage.getItem("simulacrum.v1.storage.commit"),
  ),
};

await alternativeCard.locator("[data-delete-share]").click();
await page.click("#close-blueprints");
await page.click("#edit-direct-surface");
const throttle = page.locator('.command-range[data-index="0"]'),
  brake = page.locator(".command-hold").first(),
  lights = page.locator(".command-toggle").first();
await throttle.evaluate((input) => {
  input.value = "0.55";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await lights.click();
await brake.dispatchEvent("pointerdown");
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.click("#save-machine");
machineCard = page.locator(
  `.exchange-item[data-fingerprint="${exportedPackage.fingerprint}"]`,
);
await machineCard.waitFor();
const interactionDownloadPromise = page.waitForEvent("download");
await machineCard.locator("[data-download-share]").click();
const interactionDownload = await interactionDownloadPromise,
  afterInteractionPackage = JSON.parse(
    await fs.readFile(await interactionDownload.path(), "utf8"),
  ),
  afterInteraction = afterInteractionPackage.asset;

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => {
  const text = JSON.parse(window.render_game_to_text());
  return text.parts.length > 0 && text.remote?.profile === "cart";
});
await page.click("#sandbox-start");
const restoredWorkspace = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);

// Local-data recovery is explicit, two-step, verified, and preserves unrelated keys.
await page.evaluate(() => localStorage.setItem("unrelated.test", "keep"));
await page.click("#tools-btn");
await page.click("#settings-btn");
assert.equal(await page.locator(".local-data-panel").isVisible(), true);
await page.click("#request-local-reset");
assert.equal(await page.locator("#confirm-local-reset").isVisible(), true);
await page.click("#cancel-local-reset");
assert.equal(await page.locator("#confirm-local-reset").isHidden(), true);
await page.click("#request-local-reset");
await Promise.all([
  page.waitForNavigation({ waitUntil: "domcontentloaded" }),
  page.click("#confirm-local-reset-button"),
]);
const resetWorkspace = await page.evaluate(async () => {
    const { BrowserStorage } =
        await import("/src/application/browser-storage.js"),
      storage = new BrowserStorage(localStorage),
      pointer = JSON.parse(
        localStorage.getItem("simulacrum.v1.storage.commit"),
      ),
      manifest = JSON.parse(
        localStorage.getItem(
          `simulacrum.v1.storage.manifest.${pointer.manifestId}`,
        ),
      );
    return {
      workspace: storage.readJson("workspace", null),
      trust: storage.readJson("executableTrust", null),
      unrelated: localStorage.getItem("unrelated.test"),
      previousManifestId: manifest.previousManifestId,
      rootsEmpty: Object.values(manifest.roots).every(
        (value) => value === null,
      ),
    };
  }),
  resetState = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  );

console.log(
  JSON.stringify(
    {
      exported: {
        packageVersion: exportedPackage.version,
        blueprintVersion: exported.version,
        parts: exported.parts.length,
        connections: exported.connections.length,
        profile: exported.defaultRemoteProfile,
      },
      live: {
        parts: state.parts.length,
        connections: state.connections.length,
        profile: state.remote.profile,
      },
      errors,
      rejectedImports: rejectedImports.length,
      persistenceRejected:
        persistenceRejected.pointer === pointerBeforePersistenceFailure,
      restoredControls: restoredWorkspace.remote.controls,
      localReset: resetWorkspace,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.equal(exportedPackage.version, 1, "current share is not package v1");
  assert.equal(exported.version, 1, "embedded asset is not blueprint v1");
  assert.equal(state.parts.length, exported.parts.length, "load lost parts");
  assert.equal(
    state.connections.length,
    exported.connections.length,
    "load lost connections",
  );
  assert.equal(state.remote.profile, "cart", "load lost remote profile");
  for (const [index, rejected] of rejectedImports.entries()) {
    assert.deepEqual(
      rejected.state,
      stableState,
      `malformed package ${index} partially mutated the application`,
    );
    assert.equal(
      rejected.pointer,
      stablePointer,
      `malformed package ${index} switched the storage pointer`,
    );
  }
  assert.deepEqual(
    persistenceRejected.state,
    beforePersistenceFailure,
    "pre-pointer persistence failure partially loaded a blueprint",
  );
  assert.equal(
    persistenceRejected.pointer,
    pointerBeforePersistenceFailure,
    "pre-pointer persistence failure changed the authoritative manifest",
  );
  assert.deepEqual(
    afterInteraction.remoteProfiles,
    exported.remoteProfiles,
    "live control interaction mutated portable remote definitions",
  );
  assert.equal(
    afterInteractionPackage.fingerprint,
    exportedPackage.fingerprint,
    "workspace-only control state changed portable identity",
  );
  const restoredByLabel = Object.fromEntries(
    restoredWorkspace.remote.controls.map((control) => [
      control.label,
      control.value,
    ]),
  );
  assert.equal(restoredByLabel["Drive throttle"], 0.55);
  assert.equal(restoredByLabel.Headlights, 1);
  assert.equal(restoredByLabel.Brake, 0);
  assert.equal(resetWorkspace.workspace, null);
  assert.equal(resetWorkspace.trust, null);
  assert.equal(resetWorkspace.unrelated, "keep");
  assert.equal(resetWorkspace.previousManifestId, null);
  assert.equal(resetWorkspace.rootsEmpty, true);
  assert.equal(
    resetState.parts.length,
    0,
    "reset reload restored old assembly",
  );
  assertNoErrors(errors, "blueprint package round-trip");
});
