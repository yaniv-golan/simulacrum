import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
    defaultTimeoutMs: 60_000,
  }),
  textState = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text())),
  partPosition = async (id) =>
    (await textState()).parts.find((part) => part.id === id).position;

async function beginRenderedAxisDrag(axis) {
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).transformGizmo.handleTargets,
  );
  const target = (await textState()).transformGizmo.handleTargets.axes[axis];
  assert.equal(target.hittable, true, `${axis} handle is not hittable`);
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.waitForFunction((expected) => {
    const gizmo = JSON.parse(window.render_game_to_text()).transformGizmo;
    return gizmo.active && gizmo.axis === expected;
  }, axis.toUpperCase());
  await page.mouse.move(target.x + target.dx * 48, target.y + target.dy * 48, {
    steps: 8,
  });
  await page.waitForFunction((index) => {
    const gizmo = JSON.parse(window.render_game_to_text()).transformGizmo;
    return gizmo.phase === "changed" && Math.abs(gizmo.delta[index]) >= 0.25;
  }, { x: 0, y: 1, z: 2 }[axis]);
  return target;
}

async function undoTo(expected, id) {
  await page.click("#undo-tool");
  await page.waitForFunction(
    ({ id, expected }) => {
      const part = JSON.parse(window.render_game_to_text()).parts.find(
        (candidate) => candidate.id === id,
      );
      return JSON.stringify(part.position) === JSON.stringify(expected);
    },
    { id, expected },
  );
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.querySelector("#sandbox-start").disabled,
  );
  await page.click("#sandbox-start");
  await page.locator(".welcome").waitFor({ state: "hidden" });
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Shift+Delete");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 0,
  );
  const catalog = page.locator(".catalog");
  if (
    await catalog.evaluate((element) =>
      element.classList.contains("panel-collapsed"),
    )
  )
    await page.click(
      '.catalog .panel-collapse[aria-label="Expand component library"]',
    );
  await page.click('.part-card[data-type="beam"]');
  await page.click("#place-pending");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 1,
  );
  await page.click("#move-tool");

  let state = await textState(),
    partId = state.selectedPart,
    baseline = await partPosition(partId);
  await beginRenderedAxisDrag("x");
  assert.match(
    await page.locator(".gizmo-drag-readout").textContent(),
    /X · EAST \/ WEST.*Δ/s,
  );
  await page.mouse.up();
  assert.equal((await textState()).transformGizmo.active, false);
  assert.notDeepEqual(await partPosition(partId), baseline);
  await undoTo(baseline, partId);

  const cancelTarget = await beginRenderedAxisDrag("y");
  await page.evaluate(() =>
    window.dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }),
    ),
  );
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).transformGizmo.active,
  );
  const canceledPosition = await partPosition(partId);
  await page.mouse.move(
    cancelTarget.x + cancelTarget.dx * 96,
    cancelTarget.y + cancelTarget.dy * 96,
  );
  assert.deepEqual(await partPosition(partId), canceledPosition);
  await page.mouse.up();
  await undoTo(baseline, partId);

  await beginRenderedAxisDrag("z");
  const interruptedPosition = await partPosition(partId);
  await page.evaluate(() => document.querySelector("#run-btn").click());
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  assert.equal(
    (await textState()).transformGizmo.active,
    false,
    "simulation start left a live transform operation",
  );
  await page.mouse.up();
  await page.evaluate(() => document.querySelector("#run-btn").click());
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).running,
  );
  assert.deepEqual(await partPosition(partId), interruptedPosition);

  await page.click("#move-tool");
  baseline = await partPosition(partId);
  await beginRenderedAxisDrag("x");
  const toolCommitPosition = await partPosition(partId);
  await page.evaluate(() => document.querySelector("#rotate-tool").click());
  await page.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text());
    return current.tool === "rotate" && !current.transformGizmo.active;
  });
  await page.mouse.move(780, 500);
  assert.deepEqual(await partPosition(partId), toolCommitPosition);
  await page.mouse.up();
  await undoTo(baseline, partId);

  await page.click("#move-tool");
  await beginRenderedAxisDrag("y");
  const selectionCommitPosition = await partPosition(partId);
  await page.evaluate(() => document.querySelector("#close-inspect").click());
  await page.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text());
    return current.selectedPart === null && !current.transformGizmo.active;
  });
  await page.mouse.move(700, 320);
  assert.deepEqual(await partPosition(partId), selectionCommitPosition);
  await page.mouse.up();

  state = await textState();
  assert.equal(state.transformGizmo.active, false);
  assertNoErrors(errors, "transform gizmo lifecycle browser");
  console.log("transform gizmo lifecycle browser verification passed");
} finally {
  await closeBrowser(browser);
}
