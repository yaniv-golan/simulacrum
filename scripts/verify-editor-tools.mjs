import fs from "node:fs";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import {
  readBrowserStorageRoot,
  resetBrowserStorageForTest,
} from "./lib/browser-storage-fixture.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import { assertCanonicalVisualProductState } from "./lib/component-visual-product-assertions.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();
fs.mkdirSync("artifacts", { recursive: true });

async function textState() {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

function assertExplicitConnections(assembly, label) {
  const parts = new Map(assembly.parts.map((part) => [part.id, part]));
  for (const connection of assembly.connections) {
    assert.ok(
      connection.portA && connection.portB,
      `${label} lost an endpoint port`,
    );
    const physical = ["mechanical", "mesh"].includes(connection.kind);
    if (physical) {
      assert.ok(
        connection.capacity?.ultimateForceN > 0 &&
          connection.capacity?.ultimateTorqueNm > 0,
        `${label} lost physical joint capacity`,
      );
      for (const [endpoint, partId, portId] of [
        ["A", connection.a, connection.portA],
        ["B", connection.b, connection.portB],
      ]) {
        const part = parts.get(partId),
          descriptor = TYPES[part.type].ports.find(
            (port) => port.id === portId,
          );
        if (descriptor.behavior === "structural-surface")
          assert.equal(
            connection[`anchor${endpoint}`]?.length,
            3,
            `${label} lost a structural-surface anchor`,
          );
      }
    } else
      assert.equal(
        connection.capacity,
        undefined,
        `${label} added structural capacity to a network edge`,
      );
  }
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#sandbox-start");
  await page.waitForTimeout(300);

  const builtInMechanisms = page.locator(
    '.part-card[data-type^="builtin-subassembly-"]',
  );
  assert.equal(
    await builtInMechanisms.count(),
    7,
    "ordinary reusable subassemblies are missing from the component library",
  );
  assert.deepEqual(
    await builtInMechanisms.locator("b").allTextContents(),
    [
      "Rigid axle suspension",
      "Trailing arm suspension",
      "Double wishbone corner",
      "Rocker-bogie suspension",
      "Active leveling suspension",
      "Four-wheel central tire inflation system",
      "Scripted orbital staging assembly",
    ],
    "reusable construction families are not discoverable by topology",
  );

  await page.keyboard.press("ControlOrMeta+A");
  let state = await textState();
  assert.equal(state.parts.length, 9, "sandbox gearbox fixture changed");
  assert.equal(
    state.selectedParts.length,
    9,
    "select-all did not prepare a complete reusable assembly",
  );
  await page.click('.panel-collapse[aria-label="Expand component library"]');
  await page.click("#library-add");
  assert.equal(
    await page.locator("#creator-selection-count").textContent(),
    "9 SELECTED PARTS",
    "subassembly creator does not explain its selection scope",
  );
  await page.fill("#custom-name", "Bench transmission");
  await page.click("#create-component");
  const library = await readBrowserStorageRoot(page, "subassemblyLibrary", []);
  assert.equal(library.length, 1, "reusable assembly was not persisted");
  assert.deepEqual(library[0].origin, {
    kind: "LOCAL_AUTHORING",
    sourceFingerprint: null,
  });
  assert.deepEqual(Object.keys(library[0]).sort(), [
    "asset",
    "createdAt",
    "format",
    "origin",
    "programAcquisitionByController",
    "updatedAt",
    "version",
  ]);
  assert.equal(library[0].asset.parts.length, 9, "saved assembly lost parts");
  assert.equal(
    library[0].asset.connections.length,
    14,
    "saved assembly lost internal physical/network links",
  );
  assertExplicitConnections(library[0].asset, "saved subassembly");
  assert.ok(
    library[0].asset.parts.some((part) => part.type === "computer"),
    "saved assembly dropped its programmable controller",
  );
  assert.ok(
    await page.locator('.part-card[data-type="subassembly-0"]').isVisible(),
    "saved assembly is not discoverable in My Parts",
  );

  await page.keyboard.press("Shift+Delete");
  assert.equal(
    (await textState()).parts.length,
    0,
    "clear did not empty plate",
  );
  await page.click('.tabs [data-cat="all"]');
  await page.click('.part-card[data-type="battery"]');
  await page.mouse.click(640, 430);
  await page.waitForTimeout(150);
  state = await textState();
  assert.equal(state.parts.length, 1, "battery placement did not complete");
  assert.equal(
    state.selectedParts.length,
    1,
    "placed battery was not the primary selection",
  );
  await assertCanonicalVisualProductState(page, "battery placement");
  const constructionNote = page
    .locator(".component-construction .component-contract-note")
    .first();
  assert.equal(
    await constructionNote.evaluate((note) => getComputedStyle(note).fontSize),
    "9px",
    "Blueprint Construction note escaped the compact Inspector type scale",
  );
  await constructionNote.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "artifacts/inspector-construction-typography.png",
  });
  const colorInput = page.locator("[data-custom-color]");
  await colorInput.evaluate((input) => {
    input.value = "#2357d9";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.blur();
  });
  state = await textState();
  assert.equal(
    state.parts[0].authored.customColor,
    0x2357d9,
    "inspector recolor did not update the authored component",
  );
  await assertCanonicalVisualProductState(page, "battery recolor");
  await page.click("#undo-tool");
  assert.equal(
    (await textState()).parts[0].authored.customColor,
    null,
    "recolor undo did not restore the catalog finish",
  );
  await page.click("#redo-tool");
  assert.equal(
    (await textState()).parts[0].authored.customColor,
    0x2357d9,
    "recolor redo did not restore the authored color",
  );
  await assertCanonicalVisualProductState(page, "battery recolor redo");
  const capacity = page.locator('[data-prop="capacityWh"]');
  assert.equal(
    await capacity.count(),
    1,
    "newly placed batteries do not expose their current capacity",
  );
  await capacity.evaluate((input) => {
    input.value = "0";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(
    await page.locator(".inspector .status").textContent(),
    "● 0% CHARGE",
    "zero-capacity battery produced invalid charge telemetry",
  );
  await capacity.evaluate((input) => input.blur());
  await page.keyboard.press("Delete");
  await page.waitForTimeout(100);
  assert.equal(
    (await textState()).parts.length,
    0,
    "battery inspector check did not restore the empty plate",
  );
  await page.click('.part-card[data-type="builtin-subassembly-0"]');
  await page.mouse.click(640, 430);
  await page.waitForTimeout(250);
  state = await textState();
  assert.equal(state.parts.length, 9, "rigid axle preset lost ordinary parts");
  assert.equal(
    state.connections.length,
    10,
    "rigid axle preset lost its authored topology",
  );
  assert.equal(
    state.parts.find((part) => part.type === "spring")?.settings.mechanism
      .stiffnessNPerM,
    9_000,
    "strict tuned spring data was replaced by a catalog default during placement",
  );
  assert.equal(
    (await readBrowserStorageRoot(page, "subassemblyLibrary", [])).length,
    1,
    "built-in mechanisms polluted the local authored library",
  );
  await page.keyboard.press("Shift+Delete");
  assert.equal(
    (await textState()).parts.length,
    0,
    "clearing the built-in suspension did not restore an empty plate",
  );
  await page.click('.part-card[data-type="subassembly-0"]');
  await page.mouse.click(640, 430);
  await page.waitForTimeout(250);
  state = await textState();
  assert.equal(state.parts.length, 9, "placing a subassembly lost parts");
  assert.equal(
    state.connections.length,
    14,
    "placing a subassembly lost its internal graph",
  );
  assertExplicitConnections(state, "instantiated subassembly");
  assert.equal(
    state.selectedParts.length,
    9,
    "placed subassembly was not retained as the active selection",
  );
  await assertCanonicalVisualProductState(page, "subassembly reuse");
  assert.equal(
    new Set(state.parts.map((part) => part.id)).size,
    9,
    "placed subassembly did not receive fresh unique IDs",
  );

  await page.click("#close-inspect");
  await page.mouse.move(320, 110);
  await page.mouse.down();
  await page.mouse.move(960, 610, { steps: 12 });
  assert.equal(
    await page.locator(".selection-marquee").isVisible(),
    true,
    "marquee does not provide visible drag feedback",
  );
  assert.equal(
    await page.locator(".selection-marquee span").textContent(),
    "ENCLOSED",
    "left-to-right marquee does not communicate enclosure semantics",
  );
  await page.screenshot({ path: "artifacts/editor-marquee.png" });
  await page.mouse.up();
  await page.waitForTimeout(150);
  state = await textState();
  assert.equal(
    state.selectedParts.length,
    9,
    "marquee did not select the complete visible assembly",
  );
  await page.click("#close-inspect");
  await page.mouse.move(960, 610);
  await page.mouse.down();
  await page.mouse.move(320, 110, { steps: 12 });
  assert.equal(
    await page.locator(".selection-marquee span").textContent(),
    "TOUCHING",
    "right-to-left marquee does not communicate crossing semantics",
  );
  assert.equal(
    await page
      .locator(".selection-marquee")
      .evaluate((element) => element.classList.contains("crossing")),
    true,
    "crossing marquee does not use its distinct dashed presentation",
  );
  await page.mouse.up();
  assert.equal(
    (await textState()).selectedParts.length,
    9,
    "crossing marquee did not select touched components",
  );

  await page.locator('[data-align-axis="1"]').click();
  state = await textState();
  const alignedY = state.parts.map((part) => part.position[1]);
  assert.ok(
    alignedY.every((value) => Math.abs(value - alignedY[0]) < 1e-6),
    "primary Y alignment did not update every selected component",
  );
  await page.click("#undo-tool");
  await assertCanonicalVisualProductState(page, "arrangement undo");

  const pivotHandlerBound = await page
    .locator('[data-pivot-axis="0"]')
    .evaluate((input) => {
      input.value = "10";
      const bound = typeof input.onchange === "function";
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return bound;
    });
  assert.equal(
    pivotHandlerBound,
    true,
    "numeric transform input lost its bound editor action",
  );
  state = await textState();
  const meanX =
    state.parts.reduce((sum, part) => sum + part.authored.positionM[0], 0) /
    state.parts.length;
  assert.ok(
    Math.abs(meanX - 10) < 1e-6,
    `numeric transform did not position the group pivot exactly: ${meanX}`,
  );
  await page.click("#undo-tool");

  await page.locator('[data-distribute-axis="0"]').click();
  state = await textState();
  const distributedX = state.parts
      .map((part) => part.position[0])
      .sort((a, b) => a - b),
    spacing = distributedX[1] - distributedX[0];
  assert.ok(
    distributedX
      .slice(2)
      .every(
        (value, index) =>
          Math.abs(value - distributedX[index + 1] - spacing) < 0.03,
      ),
    "distribution did not create equal center spacing",
  );
  await page.click("#undo-tool");

  await page.click("#tools-btn");
  await page.click("#engineering-btn");
  assert.equal(
    await page.locator(".engineering-panel").isVisible(),
    true,
    "engineering tools are not discoverable from Tools",
  );
  assert.equal(
    await page
      .locator(".catalog")
      .evaluate((element) => getComputedStyle(element).visibility),
    "hidden",
    "engineering drawer adds clutter instead of yielding the catalog space",
  );
  await page.click('[data-engineering-overlay="cob"]');
  await page.click('[data-engineering-overlay="interference"]');
  state = await textState();
  assert.equal(state.engineering.open, true, "analysis read model is closed");
  assert.equal(
    state.engineering.modes.cob,
    true,
    "center-of-buoyancy overlay did not activate",
  );
  assert.ok(
    state.engineering.analysis.totalMass > 0 &&
      state.engineering.analysis.displacedVolumeM3 > 0,
    "engineering overlay has no physical mass/displacement analysis",
  );
  assert.ok(
    Number.isInteger(state.engineering.analysis.interferences.length),
    "interference overlay did not produce a deterministic clash count",
  );
  await page.screenshot({ path: "artifacts/editor-engineering-gearbox.png" });

  await page.click("#close-engineering");
  await page.click("#demos-btn");
  await page.click('[data-demo="mission"]');
  await page.click("#close-remote");
  await page.click("#tools-btn");
  await page.click("#engineering-btn");
  state = await textState();
  assert.ok(
    state.engineering.analysis.thrust.forceN > 0,
    "thrust-axis overlay did not derive force from ordinary thruster parts",
  );
  assert.ok(
    state.engineering.analysis.thrust.engines.length > 0,
    "thrust overlay does not expose contributing engines",
  );
  assert.ok(
    Math.abs(state.engineering.analysis.thrust.direction[1]) > 0.9,
    "missile thrust line does not follow component orientation",
  );
  await page.screenshot({ path: "artifacts/editor-engineering-thrust.png" });

  await page.setViewportSize({ width: 860, height: 720 });
  await page.waitForTimeout(250);
  const compact = await page.locator(".engineering-panel").evaluate((panel) => {
    const bounds = panel.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      catalogCollapsed: document
        .querySelector(".catalog")
        .classList.contains("panel-collapsed"),
      inspectorCollapsed: document
        .querySelector(".inspector")
        .classList.contains("panel-collapsed"),
    };
  });
  assert.ok(
    compact.left >= 0 &&
      compact.right <= 860 &&
      compact.top >= 0 &&
      compact.bottom <= 720,
    "engineering drawer escapes the laptop viewport",
  );
  assert.equal(
    compact.inspectorCollapsed,
    true,
    "engineering drawer competes with the inspector on a narrow screen",
  );
  await page.screenshot({ path: "artifacts/editor-engineering-compact.png" });

  assertNoErrors(errors, "editor tools browser regression");
  console.log(
    `editor tools passed (${library[0].asset.parts.length} reusable parts, ${state.engineering.analysis.thrust.forceN.toFixed(0)} N thrust)`,
  );
} finally {
  await closeBrowser(browser);
}
