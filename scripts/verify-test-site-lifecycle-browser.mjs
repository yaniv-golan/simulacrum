import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { componentDefaults } from "../src/model/component-resolver.js";
import { createSharePackage } from "../src/model/share-packages.js";

const largeParts = Array.from({ length: 129 }, (_, index) => ({
    id: index + 1,
    type: "beam",
    pos: [
      (index % 12) * 1.1 - 6,
      0.5 + Math.floor(index / 72),
      Math.floor(index / 12) * 1.1 - 5,
    ],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    config: componentDefaults("beam"),
  })),
  largeBlueprint = {
    format: "simulacrum-blueprint",
    version: 1,
    name: "Test Reserve lifecycle LOD fixture",
    parts: largeParts,
    connections: [],
    remoteProfiles: {},
    defaultRemoteProfile: null,
  },
  largePackage = await createSharePackage({
    kind: "blueprint",
    asset: largeBlueprint,
    metadata: {
      title: largeBlueprint.name,
      description: "Bounded large-assembly lifecycle fixture",
    },
  }),
  { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1280, height: 800 },
    defaultTimeoutMs: 60_000,
  }),
  click = (selector) => page.locator(selector).dispatchEvent("click"),
  state = () => page.evaluate(() => JSON.parse(window.render_game_to_text())),
  resources = () => page.evaluate(() => window.simulacrum_performance()),
  walkCamera = (key, code, count) =>
    page.evaluate(
      ({ key, code, count }) => {
        for (let index = 0; index < count; index++)
          window.dispatchEvent(
            new KeyboardEvent("keydown", { key, code, shiftKey: true }),
          );
      },
      { key, code, count },
    ),
  walkCameraBatched = async (key, code) => {
    for (let batch = 0; batch < 10; batch++) {
      await walkCamera(key, code, 260);
      await page.waitForTimeout(75);
    }
  };

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await click("#sandbox-start");
await page.waitForFunction(
  () =>
    typeof window.simulacrum_performance === "function" &&
    JSON.parse(window.render_game_to_text()).environment.earth.activeChunks ===
      49,
);

async function loadCart() {
  await click("#demos-btn");
  await click('[data-demo="cart"]');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length >= 8,
  );
}

async function runRetryStop() {
  await click("#test-reserve-btn");
  await click('[data-test-route="surface-sampler"]');
  await click('[data-test-pad="surface-lanes"]');
  await click("#close-test-reserve");
  await click("#run-btn");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === true,
  );
  await page.evaluate(() => window.advanceTime(500));
  await click("#test-reserve-btn");
  await click("#test-reserve-retry");
  await page.waitForFunction(
    () =>
      document.querySelector("#test-reserve-status")?.textContent ===
      "RESTORED · SAME BUILD, PLACEMENT, SITE AND ROUTE",
  );
  await click("#close-test-reserve");
  await click("#run-btn");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === false,
  );
}

async function traverseLodAndRebase() {
  await click("#view-top");
  for (let index = 0; index < 20; index++) await click("#zoom-out");
  await page.waitForTimeout(300);
  const farLod = await state();
  assert.ok(
    farLod.camera.distance >= 180,
    `reserve LOD zoom reached only ${farLod.camera.distance} m`,
  );
  assert.equal(farLod.environment.testSite.presentationLod.level, "far");
  await click("#view-home");
  await page.waitForTimeout(300);

  await walkCameraBatched("w", "KeyW");
  await page.waitForTimeout(1_500);
  const far = await state();
  assert.notDeepEqual(far.environment.earth.globalOffsetM, {
    east: 0,
    north: 0,
  });
  await walkCameraBatched("s", "KeyS");
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).environment.earth
        .activeChunks === 49,
  );
  await page.waitForTimeout(600);
  return {
    farOffset: far.environment.earth.globalOffsetM,
    returned: (await state()).environment.earth,
  };
}

async function loadLargeAssembly() {
  await click("#tools-btn");
  await click("#blueprint-btn");
  await page.waitForFunction(
    () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
  );
  await page.locator("#share-paste").fill(JSON.stringify(largePackage));
  await click("#import-shared-text");
  await page
    .locator(`.exchange-item[data-fingerprint="${largePackage.fingerprint}"]`)
    .locator("[data-load-share]")
    .click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 129,
  );
  const snapshot = await state();
  assert.deepEqual(snapshot.environment.testSite.presentationLod, {
    level: "performance",
    grassBladesVisible: 0,
    fixtureVisualsVisible: true,
    surfaceRegionsVisible: true,
  });
}

async function exerciseLifecycle() {
  await loadCart();
  await runRetryStop();
  const earth = await traverseLodAndRebase();
  await loadLargeAssembly();
  await loadCart();
  await click("#view-home");
  await page.waitForTimeout(500);
  return { earth, resources: await resources() };
}

await exerciseLifecycle();
const baseline = await resources(),
  samples = [];
for (let cycle = 0; cycle < 2; cycle++) samples.push(await exerciseLifecycle());

console.log(
  JSON.stringify({
    baseline: baseline.renderer,
    samples: samples.map((sample) => ({
      farOffset: sample.earth.farOffset,
      returnedOffset: sample.earth.returned.globalOffsetM,
      activeChunks: sample.earth.returned.activeChunks,
      renderer: sample.resources.renderer,
    })),
  }),
);
await conclude(browser, () => {
  assertNoErrors(errors, "test-site lifecycle browser check");
  for (const sample of samples) {
    assert.equal(sample.earth.returned.activeChunks, 49);
    assert.notDeepEqual(sample.earth.farOffset, { east: 0, north: 0 });
    for (const key of ["geometries", "textures", "programs"])
      assert.ok(
        sample.resources.renderer[key] <= baseline.renderer[key] + 2,
        `renderer ${key} grew after a combined reserve lifecycle`,
      );
    assert.equal(sample.resources.heatBindings, 0);
    assert.equal(sample.resources.controllers, 0);
    assert.equal(sample.resources.reducedComponentShadows, false);
  }
  console.log(
    `test-site lifecycle passed (${samples.length} measured run/retry/rebase/LOD cycles)`,
  );
});
