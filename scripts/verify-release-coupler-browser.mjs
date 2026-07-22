import fs from "node:fs";
import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
});
fs.mkdirSync("artifacts/release-coupler", { recursive: true });

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="mission"]');

const before = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  stageIndex = before.remote.controls.findIndex(
    (control) => control.label === "Stage",
  ),
  coupler = before.parts.find((part) => part.type === "release-coupler"),
  breakawaySelectors = page.locator("[data-breakaway-connection-index]");
assert.notEqual(stageIndex, -1, "orbital profile does not expose Stage");
assert.ok(coupler, "orbital blueprint does not contain a release coupler");
assert.equal(
  before.remote.controls[stageIndex].online,
  true,
  "stage command is offline before simulation",
);
assert.ok(
  (await breakawaySelectors.count()) > 0,
  "inspector does not expose network umbilical authoring",
);
assert.ok(
  await breakawaySelectors.evaluateAll(
    (selectors, couplerId) =>
      selectors.some((selector) => selector.value === String(couplerId)),
    coupler.id,
  ),
  "declared breakaway cable is not visibly bound to its release coupler",
);

await page.click('[data-mode="test"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page.waitForFunction(() =>
  JSON.parse(
    window.render_game_to_text(),
  ).architecture.session.systems.controllers.runtimes.some(
    (runtime) => runtime.ready,
  ),
);
const stage = page.locator(`.command-hold[data-index="${stageIndex}"]`);
await stage.dispatchEvent("pointerdown");
await page.waitForFunction(
  (couplerId) =>
    JSON.parse(
      window.render_game_to_text(),
    ).architecture.session.systems.releaseCouplers.states.some(
      (state) => state.partId === couplerId && state.released,
    ),
  coupler.id,
);
await stage.dispatchEvent("pointerup");
await page.waitForTimeout(220);
await page.evaluate(() => window.advanceTime(100));

const after = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  releaseState = after.architecture.session.systems.releaseCouplers.states.find(
    (state) => state.partId === coupler.id,
  ),
  releaseEvents = after.architecture.session.run.events.filter(
    (event) => event.mode === "commanded-release",
  ),
  failedConnections = after.architecture.session.run.connections.filter(
    (connection) => connection.failed,
  ),
  failurePanelVisible = await page.locator(".failure-lab").isVisible();

await page.screenshot({
  path: "artifacts/release-coupler/orbital-stage-released.png",
  fullPage: true,
});
await conclude(browser, () => {
  assert.equal(releaseState?.released, true, "Stage did not open the latch");
  assert.equal(
    releaseEvents.length,
    1,
    "Stage did not emit exactly one structural event",
  );
  assert.equal(
    failedConnections.length,
    3,
    "Stage did not atomically open two flanges and one declared umbilical",
  );
  assert.deepEqual(
    failedConnections.map((connection) => connection.kind).sort(),
    ["mechanical", "mechanical", "signal"],
    "Stage failed an undeclared network route",
  );
  assert.equal(
    releaseState.deliveredEnergyJ,
    0,
    "held/reset Stage continued drawing latch energy after release",
  );
  assert.equal(
    after.failureAnalysis.report.eventCount,
    0,
    "intentional staging was recorded as a physical failure",
  );
  assert.equal(
    failurePanelVisible,
    false,
    "intentional staging opened the failure post-mortem",
  );
  assertNoErrors(errors, "release coupler browser flow");
});

console.log(
  `release coupler browser passed (${failedConnections.length} declared routes opened, controller remained powered)`,
);
