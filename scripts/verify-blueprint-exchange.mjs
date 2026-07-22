import fs from "node:fs/promises";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import {
  createLocalSubassemblyRecord,
  createSubassemblyTemplate,
} from "../src/model/subassemblies.js";
import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import {
  readBrowserStorageRoot,
  resetBrowserStorageForTest,
} from "./lib/browser-storage-fixture.mjs";

await fs.mkdir("artifacts", { recursive: true });
const cart = builtInDemo("cart").blueprint;
const reusable = createSubassemblyTemplate(
    { parts: cart.parts, connections: cart.connections },
    [cart.parts[0].id],
    { name: "Cargo frame" },
  ),
  savedReusable = createLocalSubassemblyRecord(reusable, {
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1024, height: 720 },
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value) => {
        window.__copiedShare = value;
      },
    },
  });
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await resetBrowserStorageForTest(page, {
  subassemblyLibrary: [savedReusable],
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="cart"]');
await page.click("#close-remote");
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);

await page.fill("#blueprint-name", "Cargo Scout");
await page.fill("#blueprint-creator", "Test Pilot");
await page.fill(
  "#blueprint-description",
  "A compact challenge rover intended for remixing.",
);
await page.fill("#blueprint-tags", "rover, cargo, beginner");
await page.click("#save-machine");
const machineCard = page.locator('.exchange-item[data-kind="blueprint"]');
await machineCard.waitFor();
assert.equal(await machineCard.locator("h3").textContent(), "Cargo Scout");
assert.equal(await machineCard.locator(".exchange-thumb img").count(), 1);

await machineCard.locator('[data-rating="4"]').click();
await machineCard.locator("[data-favorite]").click();
await machineCard.locator("[data-link-share]").click();
await page.waitForFunction(() => window.__copiedShare?.includes("#share="));
const copiedLink = await page.evaluate(() => window.__copiedShare);

await page.click("#share-my-parts");
const componentCard = page.locator('.exchange-item[data-kind="subassembly"]');
await componentCard.waitFor();
await componentCard.locator("[data-install-share]").click();
const installedParts = await readBrowserStorageRoot(
  page,
  "subassemblyLibrary",
  [],
);
assert.equal(installedParts.length, 2, "shared component was not installed");

const downloadPromise = page.waitForEvent("download");
await machineCard.locator("[data-download-share]").click();
const download = await downloadPromise;
assert.match(download.suggestedFilename(), /cargo-scout\.simshare$/);
const downloadPath = await download.path();
const downloadBytes = await fs.readFile(downloadPath),
  downloaded = JSON.parse(downloadBytes.toString("utf8"));
assert.equal(downloaded.metadata.title, "Cargo Scout");
assert.equal(
  downloaded.metadata.rating,
  undefined,
  "personal rating leaked into the portable package",
);

const beforeImport = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
const machineFingerprint = beforeImport.exchange.entries.find(
  (entry) => entry.kind === "blueprint",
).fingerprint;
assert.equal(
  beforeImport.exchange.entries.find(
    (entry) => entry.fingerprint === machineFingerprint,
  ).rating,
  4,
);
await machineCard.locator("[data-delete-share]").click();
await page.reload({ waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);
assert.equal(
  await page.locator('.exchange-item[data-kind="blueprint"]').count(),
  0,
  "deleted design returned after reload",
);

await page.setInputFiles("#share-file-input", {
  name: download.suggestedFilename(),
  mimeType: "application/json",
  buffer: downloadBytes,
});
let importedCard = page.locator('.exchange-item[data-kind="blueprint"]');
await importedCard.waitFor();
assert.equal(
  await importedCard.locator(".exchange-origin").textContent(),
  "file",
);
await importedCard.locator("[data-delete-share]").click();

await page.evaluate((packageText) => {
  const transfer = new DataTransfer();
  transfer.items.add(
    new File([packageText], "cargo-scout.simshare", {
      type: "application/json",
    }),
  );
  document.querySelector("#exchange-drop-zone").dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    }),
  );
}, JSON.stringify(downloaded));
importedCard = page.locator('.exchange-item[data-kind="blueprint"]');
await importedCard.waitFor();
assert.equal(
  await importedCard.locator(".exchange-origin").textContent(),
  "file",
);
await importedCard.locator("[data-delete-share]").click();

await page.fill("#share-paste", copiedLink);
await page.click("#import-shared-text");
importedCard = page.locator('.exchange-item[data-kind="blueprint"]');
await importedCard.waitFor();
assert.equal(
  await importedCard.locator(".exchange-origin").textContent(),
  "link",
);
await importedCard.locator("[data-load-share]").click();
await page.click("#tools-btn");
await page.click("#wasm-btn");
await page.waitForFunction(() => {
  const script = JSON.parse(window.render_game_to_text()).script;
  return script.acquisition === "SHARE_IMPORT" && script.trust;
});
let importedTrust = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
).script;
assert.equal(importedTrust.trust.allowed, false);
assert.equal(
  await page.locator("#trust-program").isVisible(),
  true,
  "imported executable did not require explicit review",
);
await page.click("#compile-wasm");
await page.waitForFunction(() =>
  document.querySelector("#wasm-status").textContent.includes("DISABLED"),
);
await page.click("#trust-program");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).script.trust?.allowed === true,
);
importedTrust = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
).script;
assert.equal(importedTrust.trust.allowed, true);
await page.click("#close-wasm");
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);
importedCard = page.locator(
  `.exchange-item[data-fingerprint="${machineFingerprint}"]`,
);

await page.screenshot({
  path: "artifacts/blueprint-exchange-compact.png",
  fullPage: false,
});
const layout = await page.evaluate(() => {
  const modal = document
    .querySelector(".exchange-card")
    .getBoundingClientRect();
  const cards = [...document.querySelectorAll(".exchange-item")].map((item) =>
    item.getBoundingClientRect(),
  );
  return {
    modal: {
      left: modal.left,
      top: modal.top,
      right: modal.right,
      bottom: modal.bottom,
    },
    columns: new Set(cards.map((card) => Math.round(card.left))).size,
  };
});
assert.ok(
  layout.modal.left >= 0 &&
    layout.modal.top >= 0 &&
    layout.modal.right <= 1024 &&
    layout.modal.bottom <= 720,
  "Exchange escapes a constrained laptop viewport",
);
assert.equal(layout.columns, 2, "compact Exchange should use two card columns");
await importedCard.locator("[data-remix-share]").click();
const remixStarted = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
assert.equal(remixStarted.exchange.remix.parentFingerprint, machineFingerprint);
await page.click("#demos-btn");
await page.click('[data-demo="drone"]');
const unrelatedLoaded = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
assert.equal(
  unrelatedLoaded.exchange.remix,
  null,
  "loading an unrelated machine retained stale remix attribution",
);
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);
await page.fill("#blueprint-name", "Flight Lab Drone");
await page.click("#save-machine");
await page.setViewportSize({ width: 1440, height: 900 });
const wideColumns = await page.evaluate(
  () =>
    new Set(
      [...document.querySelectorAll(".exchange-item")].map((card) =>
        Math.round(card.getBoundingClientRect().left),
      ),
    ).size,
);
assert.equal(wideColumns, 3, "wide Exchange should use three card columns");
await page.screenshot({
  path: "artifacts/blueprint-exchange-wide.png",
  fullPage: false,
});

importedCard = page.locator(
  `.exchange-item[data-fingerprint="${machineFingerprint}"]`,
);
await importedCard.locator("[data-load-share]").click();
const loaded = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
assert.equal(loaded.parts.length, cart.parts.length);
assert.equal(loaded.exchange.open, false);

await page.reload({ waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);
const persisted = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
assert.ok(
  persisted.exchange.entries.some(
    (entry) =>
      entry.fingerprint === machineFingerprint && entry.origin === "link",
  ),
  "imported package did not persist",
);

await page.goto(`${baseUrl}#share=invalid`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(100);
assert.equal(
  errors.length,
  0,
  "a malformed startup share link escaped the import boundary",
);

console.log(
  JSON.stringify(
    {
      designs: persisted.exchange.entries.length,
      shareLinkCharacters: copiedLink.length,
      downloaded: download.suggestedFilename(),
      compactColumns: layout.columns,
      wideColumns,
      installedReusableParts: installedParts.length,
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assertNoErrors(errors, "blueprint Exchange");
});
