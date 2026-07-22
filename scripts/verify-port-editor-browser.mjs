import fs from "node:fs/promises";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { authoredComponentFields } from "../src/model/component-authoring.js";
import { createSharePackage } from "../src/model/share-packages.js";

const { browser, page, errors, baseUrl } = await createBrowserTest();
await fs.mkdir("artifacts", { recursive: true });

const fixture = (connection) => ({
  format: "simulacrum-blueprint",
  version: 1,
  name: "Endpoint port fixture",
  parts: [
    {
      id: 1,
      type: "wheel",
      pos: [-1.05, 0.8, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      ...authoredComponentFields("wheel"),
    },
    {
      id: 2,
      type: "axle",
      pos: [0, 0.8, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      ...authoredComponentFields("axle"),
    },
  ],
  connections: [
    {
      id: "wheel-axle",
      kind: "mechanical",
      capacity: { ultimateForceN: 24000, ultimateTorqueNm: 6000 },
      ...connection,
    },
  ],
  remoteProfiles: {},
  defaultRemoteProfile: null,
});

async function importFixture(blueprint) {
  const modal = page.locator("#blueprint-modal");
  if (await modal.evaluate((element) => element.classList.contains("hidden"))) {
    await page.click("#tools-btn");
    await page.click("#blueprint-btn");
  }
  await page.waitForFunction(
    () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
  );
  const shared = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: {
      title: blueprint.name,
      description: "Endpoint-port browser fixture",
    },
  });
  await page.fill("#share-paste", JSON.stringify(shared));
  await page.click("#import-shared-text");
  await page
    .locator(`.exchange-item[data-fingerprint="${shared.fingerprint}"]`)
    .locator("[data-load-share]")
    .click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("#inspect-name").textContent(),
    "Steel Axle",
    "fixture did not leave the axle selected",
  );
}

async function portStatus(port) {
  return page.locator(`.port[data-port="${port}"] strong`).textContent();
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.click("#sandbox-start");

  await importFixture(fixture({ a: 1, portA: "AXLE", b: 2, portB: "RIGHT" }));
  assert.equal(
    await portStatus("RIGHT"),
    "CONNECTED",
    "endpoint-B port was not shown as connected",
  );
  assert.equal(
    await portStatus("LEFT"),
    "AVAILABLE",
    "endpoint-B lookup marked every same-kind port as connected",
  );
  await page.locator('.port[data-port="RIGHT"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/port-editor-endpoint-b.png" });

  await importFixture(fixture({ a: 2, portA: "LEFT", b: 1, portB: "AXLE" }));
  assert.equal(
    await portStatus("LEFT"),
    "CONNECTED",
    "endpoint-A port was not shown as connected",
  );
  assert.equal(
    await portStatus("RIGHT"),
    "AVAILABLE",
    "endpoint-A lookup marked every same-kind port as connected",
  );
  await page.locator('.port[data-port="LEFT"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/port-editor-endpoint-a.png" });

  assertNoErrors(errors, "endpoint-port browser regression");
  console.log("endpoint-port UI passed in both connection orders");
} finally {
  await closeBrowser(browser);
}
