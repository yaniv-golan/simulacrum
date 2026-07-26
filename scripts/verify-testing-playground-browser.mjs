import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { writeFile } from "node:fs/promises";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";

const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
    defaultTimeoutMs: 180_000,
  }),
  click = (selector) => page.locator(selector).dispatchEvent("click"),
  setSolarTime = async (time) => {
    await page.locator("#time-of-day").evaluate((control, value) => {
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }, time);
    await page.waitForTimeout(180);
  },
  advanceRendered = async (durationMs, sliceMs = 80) => {
    for (let elapsedMs = 0; elapsedMs < durationMs; elapsedMs += sliceMs) {
      await page.evaluate(
        (stepMs) => window.advanceTime(stepMs),
        Math.min(sliceMs, durationMs - elapsedMs),
      );
      await page.waitForTimeout(16);
    }
  },
  surfaceLanePad = WORKSHOP_TEST_SITE.stagingPads.find(
    ({ id }) => id === "surface-lanes",
  );
assert.ok(surfaceLanePad, "canonical surface-lanes staging pad is missing");
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page
  .waitForFunction(() => !document.querySelector("#sandbox-start")?.disabled)
  .catch((error) => {
    throw new Error(
      `sandbox bootstrap did not complete: ${errors.join("\n") || error.message}`,
    );
  });
await click("#sandbox-start");
await page.waitForFunction(() => Boolean(window.render_game_to_text));

const initial = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await page.waitForTimeout(250);
const reservePerformance = await page.evaluate(() =>
  window.simulacrum_performance(),
);
await click("#demos-btn");
await click('[data-demo="cart"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).parts.length >= 8,
);

await click("#view-top");
const canvas = page.locator("#stage canvas"),
  bounds = await canvas.boundingBox();
assert.ok(bounds, "workshop stage did not render");
let activeCapturePreset = null;
const captureCanvas = async (path) => {
  const data = await page.evaluate((presetId) => {
    window.simulacrum_environment_capture(presetId);
    return document
      .querySelector("#stage canvas")
      .toDataURL("image/png")
      .replace(/^data:image\/png;base64,/u, "");
  }, activeCapturePreset);
  await writeFile(path, Buffer.from(data, "base64"));
};
const captureEnvironment = async (presetId, path) => {
  activeCapturePreset = presetId;
  const capture = await page.evaluate(
    (id) => window.simulacrum_environment_capture(id),
    presetId,
  );
  await page.waitForTimeout(180);
  const state = await page.evaluate(() =>
      JSON.parse(window.render_game_to_text()),
    ),
    performance = await page.evaluate(() => window.simulacrum_performance());
  await captureCanvas(path);
  await writeFile(
    path.replace(/\.png$/u, ".json"),
    `${JSON.stringify(
      {
        presetId,
        viewport: { width: 1440, height: 900 },
        siteFingerprint:
          state.testingPlayground.currentRunIdentity?.testSiteFingerprint ||
          null,
        capture,
        renderer: performance.renderer,
      },
      null,
      2,
    )}\n`,
  );
  return state;
};
await click("#test-reserve-btn");
assert.equal(
  await page.locator("#test-reserve-btn").getAttribute("aria-expanded"),
  "true",
);
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "close-test-reserve",
);
await page.keyboard.press("Escape");
assert.equal(await page.locator(".test-reserve-browser").isVisible(), false);
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "test-reserve-btn",
);
await click("#test-reserve-btn");
const reservePanelVisible = await page
    .locator(".test-reserve-browser")
    .isVisible(),
  reserveMapCount = await page.locator("#test-reserve-map svg").count(),
  reservePadCount = await page.locator("[data-test-pad]").count(),
  reserveRouteCount = await page.locator("[data-test-route]").count(),
  reserveLegendCount = await page.locator(".test-reserve-legend span").count();
await click('[data-test-route="hill-and-home"]');
await click("#test-reserve-free");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === true,
);
const freeStarted = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === false,
);
await click("#test-reserve-btn");
await click('[data-test-route="hill-and-home"]');
await click('[data-test-pad="surface-lanes"]');
const deployed = await page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text()),
    average = (axisIndex) =>
      state.parts.reduce((sum, part) => sum + part.position[axisIndex], 0) /
      state.parts.length;
  return {
    testGround: state.testingPlayground,
    averageX: average(0),
    averageZ: average(2),
    status: document.querySelector("#test-reserve-status").textContent,
  };
});
await click("#close-test-reserve");
await page.waitForTimeout(250);
const surfaceGround = await captureEnvironment(
  "surface-ground",
  "artifacts/testing-playground-surface-detail.png",
);
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === true,
);
const started = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await page.evaluate(() => window.advanceTime(500));
await page.keyboard.down("w");
await advanceRendered(800);
await page.keyboard.up("w");
await page.keyboard.down(" ");
await advanceRendered(350);
await page.keyboard.up(" ");
await page.evaluate(() => window.simulacrum_environment_capture("rover-chase"));
await page.waitForTimeout(180);
const effectsBeforeRetry = await page.evaluate(
    () =>
      JSON.parse(window.render_game_to_text()).testingPlayground.contactEffects,
  ),
  mobilityAfterDrive = await page.evaluate(
    () =>
      JSON.parse(window.render_game_to_text()).architecture.session.systems
        .mobility,
  );
await click("#test-reserve-btn");
assert.equal(await page.locator("#test-reserve-retry").isEnabled(), true);
await click("#test-reserve-retry");
await page.waitForFunction(
  () =>
    document.querySelector("#test-reserve-status")?.textContent ===
    "RESTORED · SAME BUILD, PLACEMENT, SITE AND ROUTE",
);
const retried = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click("#close-test-reserve");
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === false,
);
const effectsAfterRetryStop = await page.evaluate(
  () =>
    JSON.parse(window.render_game_to_text()).testingPlayground.contactEffects,
);
if (await page.locator(".failure-lab").isVisible())
  await click("#close-failure-lab");
await click("#test-reserve-btn");
await click("#test-reserve-free");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === true,
);
await page.evaluate(() => window.advanceTime(500));
const freeSettled = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === false,
);
if (await page.locator(".drive-hud").isVisible())
  await click("#close-controller");
if (await page.locator(".remote-console").isVisible())
  await click("#close-remote");
if (
  !(await page
    .locator(".shell")
    .evaluate((element) => element.classList.contains("focus-workspace")))
) {
  await click("#tools-btn");
  await click("#workspace-focus");
}
await setSolarTime(12);
await captureEnvironment(
  "rover-chase",
  "artifacts/testing-playground-chase-noon.png",
);
await setSolarTime(6.5);
await captureCanvas("artifacts/testing-playground-chase-low-sun.png");
await setSolarTime(0);
await captureCanvas("artifacts/testing-playground-chase-night.png");
await setSolarTime(12);
if (
  !(await page
    .locator(".shell")
    .evaluate((element) => element.classList.contains("focus-workspace")))
) {
  await click("#tools-btn");
  await click("#workspace-focus");
}
await setSolarTime(12);
const overview = await captureEnvironment(
  "reference-overview",
  "artifacts/testing-playground-overview.png",
);
await setSolarTime(6.5);
const lowSun = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await captureCanvas("artifacts/testing-playground-overview-low-sun.png");
await setSolarTime(0);
const night = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await captureCanvas("artifacts/testing-playground-overview-night.png");
await setSolarTime(12);
const terrainGround = await captureEnvironment(
  "terrain-ground",
  "artifacts/testing-playground-terrain-ground.png",
);
await click("#test-reserve-btn");
await click('[data-test-pad="runway"]');
await click("#close-test-reserve");
await click("#close-inspect");
await captureEnvironment(
  "airfield-chase",
  "artifacts/testing-playground-airfield-chase.png",
);
await setSolarTime(6.5);
await captureCanvas("artifacts/testing-playground-airfield-low-sun.png");
await setSolarTime(0);
await captureCanvas("artifacts/testing-playground-airfield-night.png");
await setSolarTime(12);
await click("#test-reserve-btn");
await click('[data-test-pad="water"]');
await click("#close-test-reserve");
await click("#close-inspect");
await captureEnvironment(
  "water-ground",
  "artifacts/testing-playground-water-chase.png",
);
await setSolarTime(6.5);
await captureCanvas("artifacts/testing-playground-water-low-sun.png");
await setSolarTime(0);
await captureCanvas("artifacts/testing-playground-water-night.png");

console.log(
  `testing playground browser sampled ${overview.environment.testSite.districts.length} districts at ${overview.camera.distance} m`,
);
await conclude(browser, () => {
  assertNoErrors(errors, "testing playground browser");
  assert.equal(initial.environment.testSite.id, "workshop-test-reserve");
  assert.deepEqual(initial.environment.testSite.footprintM, {
    width: 480,
    depth: 360,
  });
  assert.equal(initial.environment.testSite.districts.length, 9);
  assert.equal(initial.environment.testSite.surfaceRegionCount, 22);
  assert.equal(initial.environment.testSite.heightFeatureCount, 11);
  assert.equal(initial.environment.testSite.fluidRegionCount, 2);
  assert.equal(initial.environment.testSite.clearVolumeCount, 4);
  assert.deepEqual(initial.environment.testSite.presentationLod, {
    level: "near",
    grassBladesVisible: 3600,
    shrubsVisible: 220,
    fixtureVisualsVisible: true,
    surfaceRegionsVisible: true,
    surfaces: {
      level: "near",
      shouldersVisible: true,
      markingsVisible: true,
      wearVisible: true,
      navigationLightsVisible: true,
    },
    water: {
      level: "near",
      poolsVisible: 2,
      wetBanksVisible: true,
      edgeGlintsVisible: true,
    },
  });
  assert.ok(reservePerformance.renderer.calls <= 220);
  assert.ok(reservePerformance.renderer.triangles <= 300_000);
  assert.ok(reservePerformance.renderer.geometries <= 110);
  assert.ok(reservePerformance.renderer.textures <= 12);
  assert.ok(reservePerformance.renderer.programs <= 32);
  assert.equal(reservePerformance.reducedComponentShadows, false);
  assert.equal(surfaceGround.camera.presetId, "surface-ground");
  assert.equal(terrainGround.camera.presetId, "terrain-ground");
  assert.equal(reservePanelVisible, true);
  assert.equal(reserveMapCount, 1);
  assert.equal(reservePadCount, 5);
  assert.equal(reserveRouteCount, 10);
  assert.equal(reserveLegendCount, 9);
  assert.equal(freeStarted.testingPlayground.activeRouteId, null);
  assert.equal(
    freeStarted.architecture.session.systems.testCourse,
    null,
    "free testing inherited the previously armed guided trial",
  );
  assert.equal(deployed.testGround.selectedPadId, "surface-lanes");
  assert.equal(deployed.testGround.activeRouteId, "hill-and-home");
  assert.ok(Math.abs(deployed.averageX - surfaceLanePad.pose.positionM[0]) < 1);
  assert.ok(Math.abs(deployed.averageZ - surfaceLanePad.pose.positionM[2]) < 1);
  assert.match(deployed.status, /DEPLOYED/);
  assert.equal(started.architecture.fixedStepHz, 120);
  assert.ok(started.architecture.session, "run session did not start");
  assert.equal(
    started.architecture.session.systems.testSite.siteId,
    "workshop-test-reserve",
  );
  assert.equal(
    started.architecture.session.systems.testSite.components[0].districtId,
    "surface-lanes",
  );
  assert.equal(
    started.architecture.session.systems.testCourse.routeId,
    "hill-and-home",
  );
  assert.equal(
    started.architecture.session.systems.testCourse.nextGateId,
    "terrain-entry",
  );
  assert.deepEqual(
    retried.testingPlayground.currentRunIdentity,
    started.testingPlayground.currentRunIdentity,
  );
  assert.ok(
    effectsBeforeRetry.visibleMarks + effectsBeforeRetry.visibleParticles > 0,
    `physical drive/brake telemetry did not produce any bounded contact effects: ${JSON.stringify(mobilityAfterDrive)}`,
  );
  assert.deepEqual(effectsAfterRetryStop, {
    capacity: { marks: 192, particles: 96 },
    visibleMarks: 0,
    visibleParticles: 0,
  });
  assert.equal(
    freeSettled.architecture.session.systems.structures.health,
    100,
    "canonical rover suffered structural damage after a pad deployment and passive settle",
  );
  assert.deepEqual(
    freeSettled.architecture.session.systems.structures.newlyFailed,
    [],
  );
  assert.equal(
    freeSettled.failureAnalysis.report.eventCount,
    0,
    "canonical rover emitted a structural failure during passive pad settling",
  );
  const startedPosition =
      started.architecture.session.systems.testSite.components[0].position,
    retriedPosition =
      retried.architecture.session.systems.testSite.components[0].position;
  assert.ok(
    Math.hypot(
      retriedPosition.x - startedPosition.x,
      retriedPosition.z - startedPosition.z,
    ) < 0.01,
    "retry changed the deployment's horizontal start position",
  );
  assert.ok(
    Math.abs(retriedPosition.y - startedPosition.y) < 0.1,
    "retry did not return to the same settling envelope",
  );
  assert.equal(retried.testingPlayground.records.attempts, 1);
  assert.equal(retried.testingPlayground.records.successes, 0);
  assert.equal(retried.testingPlayground.records.reliability, 0);
  assert.deepEqual(
    initial.environment.ponds.map(({ id }) => id),
    ["deep-pool", "shallow-ford"],
  );
  assert.ok(
    overview.camera.distance >= 180,
    `reserve overview did not zoom out: ${overview.camera.distance}`,
  );
  assert.equal(overview.camera.presetId, "reference-overview");
  assert.equal(overview.camera.fovDeg, 35);
  assert.deepEqual(overview.environment.testSite.presentationLod, {
    level: "far",
    grassBladesVisible: 0,
    shrubsVisible: 54,
    fixtureVisualsVisible: true,
    surfaceRegionsVisible: true,
    surfaces: {
      level: "far",
      shouldersVisible: true,
      markingsVisible: true,
      wearVisible: false,
      navigationLightsVisible: true,
    },
    water: {
      level: "far",
      poolsVisible: 2,
      wetBanksVisible: true,
      edgeGlintsVisible: false,
    },
  });
  assert.equal(lowSun.environment.timeOfDay, 6.5);
  assert.equal(night.environment.timeOfDay, 0);
  assert.equal(lowSun.environment.testSite.presentationLod.level, "far");
  assert.equal(night.environment.testSite.presentationLod.level, "far");
});
