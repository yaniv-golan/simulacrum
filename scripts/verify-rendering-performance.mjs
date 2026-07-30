import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { installWebGLResourceTracker } from "./lib/webgl-resource-tracker.mjs";
import { componentDefaults } from "../src/model/component-resolver.js";
import { createSharePackage } from "../src/model/share-packages.js";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1024, height: 720 },
  defaultTimeoutMs: 60_000,
  launchOptions: { args: ["--js-flags=--expose-gc"] },
});
const requestedScripts = [];
page.on("request", (request) => {
  if (request.resourceType() === "script") requestedScripts.push(request.url());
});
await installWebGLResourceTracker(page);
await page.addInitScript(() => {
  const metrics = (window.__renderingPerformanceMetrics = {
    blobs: 0,
    workers: 0,
  });
  const nativeCreateObjectURL = URL.createObjectURL.bind(URL),
    nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL),
    liveUrls = new Set();
  URL.createObjectURL = (value) => {
    const url = nativeCreateObjectURL(value);
    liveUrls.add(url);
    metrics.blobs = liveUrls.size;
    return url;
  };
  URL.revokeObjectURL = (url) => {
    liveUrls.delete(url);
    metrics.blobs = liveUrls.size;
    return nativeRevokeObjectURL(url);
  };
  const NativeWorker = globalThis.Worker;
  globalThis.Worker = class TrackedWorker extends NativeWorker {
    constructor(...args) {
      super(...args);
      metrics.workers++;
      this.__renderingPerformanceLive = true;
    }
    terminate() {
      if (this.__renderingPerformanceLive) metrics.workers--;
      this.__renderingPerformanceLive = false;
      return super.terminate();
    }
  };
});

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => typeof window.simulacrum_performance === "function",
);
await page.click("#sandbox-start");
assert.ok(
  requestedScripts.every(
    (url) =>
      !/\/node_modules\/(?:\.vite\/deps\/)?(?:typescript|wabt)(?:[/.]|$)/i.test(
        new URL(url).pathname,
      ),
  ),
  `optional controller compiler loaded during startup: ${requestedScripts.join(", ")}`,
);

async function loadDemo(name) {
  await page.locator("#demos-btn").dispatchEvent("click");
  await page.locator(`[data-demo="${name}"]`).dispatchEvent("click");
  await page.waitForTimeout(120);
}
async function exerciseMissionHeat() {
  await page.locator("#run-btn").dispatchEvent("click");
  await page.waitForFunction(
    () => window.simulacrum_performance().heatBindings > 0,
  );
  await page.evaluate(() => window.advanceTime(12));
  if (
    await page.evaluate(
      () => JSON.parse(window.render_game_to_text()).running === true,
    )
  )
    await page.locator("#run-btn").dispatchEvent("click");
  await page.waitForFunction(() => {
    const resources = window.simulacrum_performance();
    return resources.heatBindings === 0 && resources.controllers === 0;
  });
}

const demoOrder = ["gearbox", "drone", "humanoid", "mission", "cart"];
for (let warmup = 0; warmup < 2; warmup++)
  for (const demo of demoOrder) {
    await loadDemo(demo);
    if (demo === "mission") await exerciseMissionHeat();
  }

const resourceSamples = [];
for (let cycle = 0; cycle < 5; cycle++) {
  for (const demo of demoOrder) {
    await loadDemo(demo);
    if (demo === "mission") await exerciseMissionHeat();
  }
  await page.evaluate(() => globalThis.gc?.());
  resourceSamples.push(
    await page.evaluate(() => ({
      ...structuredClone(window.__renderingPerformanceMetrics),
      webgl: structuredClone(window.__simulacrumWebGLMetrics),
      app: window.simulacrum_performance(),
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    })),
  );
}
const standardPresentation = await page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  return {
    detail: state.presentation.componentDetail,
    reflectionEnvironment: state.environment.reflectionEnvironment,
  };
});

const parts = Array.from({ length: 300 }, (_, index) => ({
    id: index + 1,
    type: "beam",
    pos: [
      (index % 20) * 1.1 - 10,
      0.5 + Math.floor(index / 100),
      Math.floor(index / 20) * 1.1 - 8,
    ],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    config: componentDefaults("beam"),
  })),
  blueprint = {
    format: "simulacrum-blueprint",
    version: 1,
    name: "Rendering performance budget",
    parts,
    connections: [],
    remoteProfiles: {},
    defaultRemoteProfile: null,
  },
  sharedBlueprint = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: {
      title: blueprint.name,
      description: "Large-assembly render budget fixture",
    },
  });
await page.locator("#tools-btn").dispatchEvent("click");
await page.locator("#blueprint-btn").dispatchEvent("click");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);
await page.locator("#share-paste").fill(JSON.stringify(sharedBlueprint));
await page.locator("#import-shared-text").click();
await page
  .locator(`.exchange-item[data-fingerprint="${sharedBlueprint.fingerprint}"]`)
  .locator("[data-load-share]")
  .click();
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).parts.length === 300,
);
await page.evaluate(
  () =>
    new Promise((resolve) => {
      globalThis.gc?.();
      let frames = 0;
      const warm = () => {
        if (++frames >= 120) resolve();
        else requestAnimationFrame(warm);
      };
      requestAnimationFrame(warm);
    }),
);
await page.evaluate(() => (window.__simulacrumWebGLMetrics.draws = 0));
const frameSamples = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const samples = [];
      let previous = performance.now();
      const sample = (now) => {
        samples.push(now - previous);
        previous = now;
        // Five independent 60-frame windows distinguish sustained rendering
        // cost from host-scheduler bursts. The median window p95 must pass, so
        // a genuinely slow scene still fails deterministically.
        if (samples.length >= 302) resolve(samples.slice(2));
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }),
);
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const metrics = window.__simulacrumWebGLMetrics;
      metrics.drawSignatures = {};
      metrics.captureDrawSignatures = true;
      let frames = 0;
      const capture = () => {
        if (++frames >= 3) {
          metrics.captureDrawSignatures = false;
          resolve();
        } else requestAnimationFrame(capture);
      };
      requestAnimationFrame(capture);
    }),
);
const renderSample = await page.evaluate(() => ({
  draws: window.__simulacrumWebGLMetrics.draws,
  drawSignatures: structuredClone(
    window.__simulacrumWebGLMetrics.drawSignatures,
  ),
  app: window.simulacrum_performance(),
  reserveLod: JSON.parse(window.render_game_to_text()).environment.testSite
    .presentationLod,
  reflectionEnvironment: JSON.parse(window.render_game_to_text()).environment
    .reflectionEnvironment,
  renderer: (() => {
    const canvas = document.querySelector("canvas"),
      gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl"),
      extension = gl?.getExtension("WEBGL_debug_renderer_info");
    return extension
      ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : gl?.getParameter(gl.RENDERER) || "unknown";
  })(),
}));
const frameWindowP95Ms = Array.from({ length: 5 }, (_, index) =>
    [...frameSamples.slice(index * 60, (index + 1) * 60)]
      .sort((left, right) => left - right)
      .at(Math.ceil(60 * 0.95) - 1),
  ).sort((left, right) => left - right),
  p95FrameMs = frameWindowP95Ms[2],
  frameBudgetMs = 1000 / 30,
  headlessTimerAllowanceMs = 2,
  firstResources = resourceSamples[0],
  lastResources = resourceSamples.at(-1);

console.log(
  JSON.stringify(
    {
      resourceSamples,
      standardPresentation,
      renderSample,
      frameSamples,
      frameWindowP95Ms,
      p95FrameMs,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  if (
    Number.isFinite(firstResources.heapBytes) &&
    Number.isFinite(lastResources.heapBytes)
  )
    assert.ok(
      lastResources.heapBytes <= firstResources.heapBytes + 1_000_000,
      "retained heap grew after warmed load/start/stop cycles",
    );
  assert.ok(
    resourceSamples.every(
      (sample) => sample.app.heatBindings === 0 && sample.app.controllers === 0,
    ),
    "heated materials or controller runtimes survived a stopped cycle",
  );
  for (const key of ["geometries", "textures", "programs"])
    assert.ok(
      lastResources.app.renderer[key] <= firstResources.app.renderer[key] + 2,
      `renderer ${key} grew across warmed load/clear cycles`,
    );
  for (const key of ["buffers", "programs", "textures"])
    assert.ok(
      lastResources.webgl[key] <= firstResources.webgl[key] + 2,
      `raw WebGL ${key} grew across warmed load/clear cycles`,
    );
  assert.deepEqual(
    lastResources.app.shared,
    firstResources.app.shared,
    "owned or shared component resources drifted across warmed cycles",
  );
  assert.ok(
    lastResources.blobs <= firstResources.blobs,
    "Blob URLs grew across warmed cycles",
  );
  assert.ok(
    lastResources.workers <= firstResources.workers,
    "workers grew across warmed cycles",
  );
  assert.equal(renderSample.app.parts, 300);
  assert.equal(standardPresentation.reflectionEnvironment.active, true);
  assert.equal(
    Object.values(standardPresentation.detail.counts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    firstResources.app.parts,
  );
  assert.equal(standardPresentation.detail.pendingTransitions, 0);
  assert.equal(
    renderSample.app.reducedComponentShadows,
    true,
    "large assemblies did not activate complexity-based shadow LOD",
  );
  assert.deepEqual(renderSample.reserveLod, {
    level: "performance",
    grassBladesVisible: 0,
    shrubsVisible: 0,
    fixtureVisualsVisible: true,
    surfaceRegionsVisible: true,
    surfaces: {
      level: "performance",
      shouldersVisible: true,
      markingsVisible: true,
      wearVisible: false,
      navigationLightsVisible: true,
    },
    water: {
      level: "performance",
      poolsVisible: 2,
      wetBanksVisible: true,
      edgeGlintsVisible: false,
    },
  });
  assert.deepEqual(renderSample.app.componentDetail.counts, {
    hero: 0,
    standard: 0,
    performance: 300,
  });
  assert.equal(renderSample.app.componentDetail.pendingTransitions, 0);
  assert.equal(
    renderSample.reflectionEnvironment.active,
    false,
    "large-assembly mode retained the procedural reflection pass",
  );
  assert.ok(
    renderSample.draws <= 50_760 * 0.7,
    `300-part draw calls missed the 30% reduction (${renderSample.draws})`,
  );
  assert.ok(
    p95FrameMs <= frameBudgetMs + headlessTimerAllowanceMs,
    `300-part p95 frame time exceeded the 30 FPS budget plus the ${headlessTimerAllowanceMs} ms headless timer allowance on ${renderSample.renderer} (${p95FrameMs})`,
  );
  assertNoErrors(errors, "rendering performance browser check");
});
