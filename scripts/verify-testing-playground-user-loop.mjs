import { assert, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, baseUrl } = await createBrowserTest({
    viewport: { width: 1024, height: 720 },
  }),
  state = () => page.evaluate(() => JSON.parse(window.render_game_to_text())),
  click = (selector) => page.locator(selector).dispatchEvent("click"),
  panelInsideViewport = async () => {
    const bounds = await page.locator(".test-reserve-browser").boundingBox(),
      viewport = page.viewportSize();
    assert.ok(
      bounds && viewport,
      "reserve panel did not produce layout bounds",
    );
    assert.ok(bounds.x >= 0 && bounds.y >= 0);
    assert.ok(bounds.x + bounds.width <= viewport.width + 1);
    assert.ok(bounds.y + bounds.height <= viewport.height + 1);
    return bounds;
  };

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
);
await click("#sandbox-start");
await page.waitForFunction(() => Boolean(window.render_game_to_text));
await page.keyboard.press("Shift+Delete");
assert.equal(
  (await state()).parts.length,
  0,
  "blank build did not start empty",
);

await click('.tabs [data-cat="all"]');
await click('.part-card[data-type="beam"]');
await page.fill("#placement-x", "0");
await page.fill("#placement-y", "1");
await page.fill("#placement-z", "0");
await click("#place-pending");
let snapshot = await state();
assert.equal(
  snapshot.parts.length,
  1,
  "visible build controls did not add a part",
);
const authoredPartId = snapshot.parts[0].id;

await page
  .locator('.panel-collapse[aria-label="Expand component library"]')
  .click();
await click('.part-card[data-type="beam"]');
await page.fill("#placement-x", "100");
await page.fill("#placement-y", "1");
await page.fill("#placement-z", "0");
await click("#place-pending");
snapshot = await state();
const oversizePartId = snapshot.parts.find(
    ({ id }) => id !== authoredPartId,
  ).id,
  oversizePositions = snapshot.parts.map(({ position }) => position);

await click("#test-reserve-btn");
const laptopPanel = await panelInsideViewport();
assert.ok(
  await page
    .locator("#test-reserve-routes")
    .evaluate((element) => element.scrollHeight > element.clientHeight),
  "laptop route list did not remain locally scrollable",
);
await click('[data-test-pad="surface-lanes"]');
assert.match(
  await page.locator("#test-reserve-status").textContent(),
  /DOES NOT FIT/,
);
assert.deepEqual(
  (await state()).parts.map(({ position }) => position),
  oversizePositions,
  "rejected oversize deployment changed authored positions",
);
await click("#close-test-reserve");
await click(`[data-outliner-part="${oversizePartId}"]`);
await click("#delete-part");
assert.equal((await state()).parts.length, 1);
await click("#test-reserve-btn");
await click('[data-test-route="surface-sampler"]');
await click('[data-test-pad="surface-lanes"]');
snapshot = await state();
assert.equal(snapshot.testingPlayground.selectedPadId, "surface-lanes");
assert.equal(snapshot.testingPlayground.activeRouteId, "surface-sampler");
assert.match(
  await page.locator("#test-reserve-status").textContent(),
  /DEPLOYED/,
);
await click("#close-test-reserve");
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === true,
);
await click("#test-reserve-btn");
assert.equal(await page.locator("[data-test-pad]").first().isDisabled(), true);
assert.equal(
  await page.locator("[data-test-route]").first().isDisabled(),
  true,
);
assert.match(
  await page.locator("#test-reserve-status").textContent(),
  /RUNNING/,
);
const runningPosition = (await state()).parts[0].position;
await page.locator('[data-test-pad="runway"]').dispatchEvent("click");
assert.deepEqual(
  (await state()).parts[0].position,
  runningPosition,
  "disabled live-run deployment moved the assembly",
);

await page.evaluate(() => window.advanceTime(1500));
const beforeRetry = await state();
const componentTelemetry =
  beforeRetry.architecture.session.systems.testSite.components[0];
assert.equal(componentTelemetry.inside, true);
assert.equal(componentTelemetry.districtId, "surface-lanes");
assert.equal(componentTelemetry.materialKey, "dry-asphalt");
await click("#test-reserve-retry");
await page.waitForFunction(
  () =>
    document.querySelector("#test-reserve-status")?.textContent ===
    "RESTORED · SAME BUILD, PLACEMENT, SITE AND ROUTE",
);
const afterRetry = await state();
assert.deepEqual(
  afterRetry.testingPlayground.currentRunIdentity,
  beforeRetry.testingPlayground.currentRunIdentity,
  "retry changed the run identity",
);
assert.equal(afterRetry.parts.length, 1, "retry changed the authored build");

await click("#close-test-reserve");
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === false,
);
await page.setViewportSize({ width: 1920, height: 1080 });
await click("#test-reserve-btn");
const widePanel = await panelInsideViewport();
assert.ok(widePanel.width >= laptopPanel.width - 1);
await click("#close-test-reserve");
assert.equal(await page.locator(".test-reserve-browser").isVisible(), false);

await click(`[data-outliner-part="${authoredPartId}"]`);
await click("#duplicate-part");
snapshot = await state();
assert.equal(
  snapshot.parts.length,
  2,
  "post-test visible edit did not modify build",
);
assert.equal(snapshot.running, false);

console.log(
  "testing playground blank-build loop passed (build, deploy, test, diagnose, retry, responsive UI, modify)",
);
await conclude(browser, () => {});
