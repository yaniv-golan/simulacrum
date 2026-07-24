import fs from "node:fs/promises";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

await fs.mkdir("artifacts", { recursive: true });
const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1280, height: 800 },
});
const textState = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));

async function openLibrary(category) {
  const expand = page.locator(
    '.panel-collapse[aria-label="Expand component library"]',
  );
  if (await expand.isVisible()) await expand.click();
  await page.click(`[data-cat="${category}"]`);
}

async function place(type, position) {
  await openLibrary(type === "plate" ? "structure" : "motion");
  await page.locator(`.part-card[data-type="${type}"]`).focus();
  await page.keyboard.press("Enter");
  await page.fill("#placement-x", String(position[0]));
  await page.fill("#placement-y", String(position[1]));
  await page.fill("#placement-z", String(position[2]));
  await page.click("#place-pending");
  return (await textState()).selectedPart;
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#sandbox-start");
  await page.keyboard.press("Shift+Delete");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 0,
  );

  await openLibrary("motion");
  await page.locator('.part-card[data-type="rope"]').focus();
  await page.keyboard.press("Enter");
  let state = await textState();
  assert.ok(
    state.pendingPlacement.position[1] >= 2.14,
    "a free Rope placement started through the build plate",
  );
  await page.click("#cancel-placement");

  const leftId = await place("plate", [-2, 2, 0]),
    rightId = await place("plate", [2, 2, 0]);
  assert.notEqual(leftId, rightId);
  await page.locator("canvas").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).selectedParts.length === 2,
  );
  const expandInspector = page.locator(
    '.panel-collapse[aria-label="Expand inspector"]',
  );
  if (await expandInspector.isVisible()) await expandInspector.click();
  await page.locator("#connect-with-rope").waitFor();
  assert.match(
    await page.locator("#connect-with-rope-title").textContent(),
    /CONNECT WITH ROPE/,
  );
  await page.fill("#two-ended-extra-slack", "0.5");
  await page.click("#connect-with-rope");

  state = await textState();
  const rope = state.parts.find((part) => part.type === "rope");
  assert.ok(
    rope,
    `visible two-part workflow did not create Rope: ${JSON.stringify({ parts: state.parts, connections: state.connections, presentation: state.presentation })}`,
  );
  assert.equal(state.parts.length, 3);
  assert.equal(state.connections.length, 2);
  assert.equal(state.flexibleLines[0].lengthM, 4.5);
  assert.deepEqual(
    state.flexibleLines[0].boundaries.map((boundary) => boundary.state),
    ["attached", "attached"],
  );
  assert.match(
    await page.locator("#property-list").textContent(),
    /NYLON-ROPE/,
  );
  assert.equal(await page.locator('[data-prop="lengthM"]').count(), 1);

  await page.click("#run-btn");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === true,
  );
  await page.evaluate(() => window.advanceTime(500));
  await page.waitForFunction(() => {
    const line = JSON.parse(window.render_game_to_text()).flexibleLines[0];
    return line?.solvedCenterline?.nodeCount > 2;
  });
  state = await textState();
  assert.equal(state.flexibleLines[0].validity, "unsupported-envelope");
  assert.deepEqual(state.flexibleLines[0].unsupportedEffects, [
    "aerodynamic-drag",
  ]);
  assert.equal(state.flexibleLines[0].solvedCenterline.nodeCount, 19);
  assert.ok(Number.isFinite(state.flexibleLines[0].failureMargin));
  assert.match(
    await page.locator("#property-list").textContent(),
    /COMPLETED PHYSICS TICK/,
  );
  await page.screenshot({
    path: "artifacts/rope-authoring-laptop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.screenshot({
    path: "artifacts/rope-authoring-wide.png",
    fullPage: true,
  });

  await page.click("#run-btn");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === false,
  );
  assert.equal((await textState()).selectedPart, rope.id);
  await page.locator("canvas").focus();
  await page.keyboard.press("Alt+Shift+A");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).connections.length === 1,
  );
  state = await textState();
  assert.deepEqual(
    state.flexibleLines[0].boundaries.map((boundary) => boundary.state),
    ["free", "attached"],
  );
  await page.keyboard.press("ControlOrMeta+Z");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).connections.length === 2,
  );
  assertNoErrors(errors, "Rope visible authoring journey");
  console.log(
    "Rope browser authoring passed (blank plate, atomic rigging, run telemetry, detach/undo, laptop/wide screenshots)",
  );
} finally {
  await closeBrowser(browser);
}
