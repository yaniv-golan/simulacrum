import fs from "node:fs/promises";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { authoredComponentFields } from "../src/model/component-authoring.js";
import { createSharePackage } from "../src/model/share-packages.js";
import { DEFAULT_VISUAL_PROGRAM } from "../src/model/visual-logic.js";
import { assertCanonicalVisualProductState } from "./lib/component-visual-product-assertions.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();
await fs.mkdir("artifacts", { recursive: true });

const fixture = (connection) => {
  const axlePort = connection.a === 2 ? connection.portA : connection.portB,
    wheelZ = axlePort === "LEFT" ? -1 : 1;
  return {
    format: "simulacrum-blueprint",
    version: 1,
    name: "Endpoint port fixture",
    parts: [
      {
        id: 1,
        type: "wheel",
        pos: [0, 0.8, wheelZ],
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
  };
};

const chainFixture = () => {
  const component = (id, type, x) => {
      const authored = authoredComponentFields(type);
      return {
        id,
        type,
        pos: [x, 0.8, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        ...authored,
        ...(type === "battery"
          ? { storedEnergyWh: authored.config.capacityWh }
          : {}),
        ...(type === "computer"
          ? {
              scriptLanguage: "visual",
              scriptSources: {
                visual: structuredClone(DEFAULT_VISUAL_PROGRAM),
                typescript: "",
                wat: "",
              },
              controllerBindings: [],
            }
          : {}),
      };
    },
    controller = component(2, "computer", 0);
  controller.controllerBindings = [
    {
      id: "pilot.drive",
      direction: "input",
      endpointPartId: 3,
      endpointPortId: "SIGNAL",
      reading: "command",
    },
    {
      id: "motor.throttle",
      direction: "output",
      endpointPartId: 4,
      endpointPortId: "CONTROL",
      channel: "throttle",
    },
  ];
  return {
    format: "simulacrum-blueprint",
    version: 1,
    name: "Configured control chain fixture",
    parts: [
      component(1, "battery", -3),
      controller,
      component(3, "receiver", -1.5),
      component(4, "motor", 1.5),
    ],
    connections: [
      {
        id: "power-computer",
        kind: "power",
        a: 1,
        portA: "POWER",
        b: 2,
        portB: "POWER",
      },
      {
        id: "power-receiver",
        kind: "power",
        a: 1,
        portA: "POWER",
        b: 3,
        portB: "POWER",
      },
      {
        id: "power-motor",
        kind: "power",
        a: 1,
        portA: "POWER",
        b: 4,
        portB: "POWER",
      },
      {
        id: "sig-in",
        kind: "signal",
        a: 3,
        portA: "SIGNAL",
        b: 2,
        portB: "IN A",
      },
      {
        id: "sig-out",
        kind: "signal",
        a: 2,
        portA: "OUT",
        b: 4,
        portB: "CONTROL",
      },
    ],
    remoteProfiles: {},
    defaultRemoteProfile: null,
  };
};

async function importFixture(
  blueprint,
  expectedSelectedName = "Steel Axle #2",
) {
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
  await modal.waitFor({ state: "hidden" });
  assert.equal(
    await page
      .locator("body")
      .evaluate((element) => element.classList.contains("load-recovery")),
    false,
    "valid blueprint without remote profiles entered recovery freeze",
  );
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("#inspect-name").textContent(),
    expectedSelectedName,
    "fixture did not leave the expected component selected",
  );
}

async function portStatus(port) {
  return page.locator(`[data-port-control="${port}"] strong`).textContent();
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
  await page.locator('[data-port-control="RIGHT"]').scrollIntoViewIfNeeded();
  await page.locator('[data-port-control="RIGHT"]').click();
  assert.deepEqual(
    await page
      .locator('[data-port-row="RIGHT"] [data-port-action]')
      .allTextContents(),
    ["SELECT COUNTERPART", "FRAME", "TRACE PATH", "DISCONNECT"],
    "connected port did not progressively disclose its exact actions",
  );
  await page.locator('[data-port-action="trace"][data-port="RIGHT"]').click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).componentInspection
        ?.routeEvidence?.status === "resolved",
  );
  assert.deepEqual(
    (await page.evaluate(() => JSON.parse(window.render_game_to_text())))
      .componentInspection.routeEvidence.connectionIds,
    ["wheel-axle"],
    "direct path trace did not preserve exact connection identity",
  );
  await page.locator('[data-port-control="RIGHT"]').focus();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-port-control"),
    ),
    "RIGHT",
    "Escape did not collapse port actions and restore port focus",
  );
  await page.locator('[data-port-control="RIGHT"]').click();
  await page.screenshot({ path: "artifacts/port-editor-endpoint-b.png" });
  await page
    .locator('[data-port-action="disconnect"][data-port="RIGHT"]')
    .click();
  assert.equal(
    (await page.evaluate(() => JSON.parse(window.render_game_to_text())))
      .connections.length,
    0,
    "Disconnect did not remove exactly the selected endpoint connection",
  );
  assert.equal(
    (await page.evaluate(() => JSON.parse(window.render_game_to_text())))
      .selectedPart,
    2,
    "Disconnect did not preserve the selected component",
  );
  await page.locator('[data-port-control="RIGHT"]').click();
  await page.locator('[data-port-action="connect"][data-port="RIGHT"]').click();
  await page.locator('[data-outliner-part="1"]').click();
  await page.locator('[data-port-control="AXLE"]').click();
  await page.locator('[data-port-action="connect"][data-port="AXLE"]').click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).connections.length === 1,
  );
  await assertCanonicalVisualProductState(page, "interactive port connection");

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
  await page.locator('[data-port-control="LEFT"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/port-editor-endpoint-a.png" });

  await importFixture(chainFixture(), "Powered Motor #4");
  await page.locator('[data-outliner-part="1"]').click();
  await page.locator('[data-port-control="POWER"]').click();
  assert.equal(
    await page.locator('[data-route-target="POWER"] option').count(),
    3,
    "branched power network did not expose every owner-backed destination",
  );
  await page.locator('[data-route-target="POWER"]').selectOption("out:4:POWER");
  await page.locator('[data-port-action="trace"][data-port="POWER"]').click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).componentInspection
        ?.routeEvidence?.status === "resolved",
  );
  assert.deepEqual(
    (await page.evaluate(() => JSON.parse(window.render_game_to_text())))
      .componentInspection.routeEvidence.connectionIds,
    ["power-motor"],
    "native route-target chooser did not query the selected owner-produced destination",
  );

  await page.locator('[data-outliner-part="4"]').click();
  const chainRead = (
    await page.evaluate(() => JSON.parse(window.render_game_to_text()))
  ).componentInspection.configuredControlChains;
  assert.equal(chainRead.status, "available");
  assert.equal(chainRead.options.length, 1);
  assert.deepEqual(chainRead.options[0].ownerSummary, {
    inputAvailable: true,
    outputAvailable: true,
  });
  await page.locator(".configured-chain summary").click();
  await page.locator('[data-chain-action="trace"]').click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).componentInspection
        ?.routeEvidence?.status === "resolved",
  );
  const chainEvidence = (
    await page.evaluate(() => JSON.parse(window.render_game_to_text()))
  ).componentInspection.routeEvidence;
  assert.equal(chainEvidence.claim, "configured-routes-not-program-causality");
  assert.deepEqual(chainEvidence.input.connectionIds, ["sig-in"]);
  assert.deepEqual(chainEvidence.output.connectionIds, ["sig-out"]);
  assert.equal(
    chainEvidence.input.controllerPortSelection,
    "network-derived-minimum-hop",
  );
  assert.equal(
    chainEvidence.output.controllerPortSelection,
    "network-derived-minimum-hop",
  );
  assert.equal(chainEvidence.continuousOverlay, false);
  assert.ok(
    !JSON.stringify(chainEvidence).includes("route-evidence-v1:"),
    "read model leaked an opaque route-evidence capability token",
  );
  assert.equal(
    await page.locator(".configured-chain-result .chain-input").count(),
    1,
  );
  assert.equal(
    await page.locator(".configured-chain-result .chain-boundary").count(),
    1,
  );
  assert.equal(
    await page.locator(".configured-chain-result .chain-output").count(),
    1,
  );
  assert.match(
    await page
      .locator(".configured-chain-result .chain-boundary")
      .textContent(),
    /PROGRAM CAUSALITY NOT EVALUATED/,
  );
  await page.screenshot({ path: "artifacts/port-editor-configured-chain.png" });

  assertNoErrors(errors, "endpoint-port browser regression");
  console.log(
    "endpoint-port UI and configured controller-chain explanation passed",
  );
} finally {
  await closeBrowser(browser);
}
