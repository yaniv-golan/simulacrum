import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { installWebGLResourceTracker } from "./lib/webgl-resource-tracker.mjs";

const durationMs = Number(
    process.env.SIMULACRUM_SOAK_DURATION_MS || 30 * 60_000,
  ),
  sampleIntervalMs = Number(
    process.env.SIMULACRUM_SOAK_SAMPLE_INTERVAL_MS || 60_000,
  );
assert.ok(
  Number.isFinite(durationMs) && durationMs >= 1_000,
  "soak duration must be at least one second",
);
assert.ok(
  Number.isFinite(sampleIntervalMs) && sampleIntervalMs >= 1_000,
  "soak sample interval must be at least one second",
);

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1024, height: 720 },
  defaultTimeoutMs: 60_000,
  launchOptions: { args: ["--js-flags=--expose-gc"] },
});
const devtools = await page.context().newCDPSession(page);
await devtools.send("HeapProfiler.enable");
await installWebGLResourceTracker(page);
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.click("#sandbox-start");
await page.locator(".welcome").waitFor({ state: "detached" });
await page.waitForFunction(
  () =>
    typeof window.advanceTime === "function" &&
    typeof window.simulacrum_performance === "function",
);

const demoOrder = ["gearbox", "drone", "humanoid", "mission", "cart"],
  samples = [];
let startedAt, deadline, nextSampleAt;
let cycles = 0,
  maxCycleDurationMs = 0;

async function bounded(operation, label, timeoutMs = 180_000) {
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAndRunDemo(name) {
  // Dispatch through the application's own handlers so a pinned model remote
  // cannot make a long unattended soak fail merely by overlapping the menu.
  await page.locator("#demos-btn").dispatchEvent("click");
  await page.locator(`[data-demo="${name}"]`).dispatchEvent("click");
  await page
    .locator('[data-mode="test"]')
    .evaluate((element) => element.click());
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === true,
  );
  await page.evaluate(
    (seconds) => window.advanceTime(seconds),
    name === "mission" ? 12 : 2,
  );
  const running = await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  if (running)
    await page.locator("#run-btn").evaluate((element) => element.click());
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running === false,
  );
  const resources = await page.evaluate(() => window.simulacrum_performance());
  assert.equal(
    resources.controllers,
    0,
    `${name} controller runtimes survived stop`,
  );
  assert.equal(
    resources.heatBindings,
    0,
    `${name} heat bindings survived stop`,
  );
}

async function captureSample() {
  await devtools.send("HeapProfiler.collectGarbage");
  const heap = await devtools.send("Runtime.getHeapUsage"),
    sample = await page.evaluate(() => ({
      elapsedMs: performance.now(),
      ...window.simulacrum_performance(),
      webgl: structuredClone(window.__simulacrumWebGLMetrics),
      storageProtocol: Object.keys(localStorage)
        .filter(
          (key) =>
            key.startsWith("simulacrum.v1.storage.manifest.") ||
            key.startsWith("simulacrum.v1.storage.generation."),
        )
        .reduce(
          (summary, key) => ({
            records: summary.records + 1,
            bytes:
              summary.bytes +
              key.length * 2 +
              (localStorage.getItem(key)?.length || 0) * 2,
          }),
          { records: 0, bytes: 0 },
        ),
    }));
  sample.heapBytes = heap.usedSize;
  samples.push(sample);
  console.log(
    `release soak ${Math.round((Date.now() - startedAt) / 1000)}s: ${cycles} cycles, ${sample.parts} parts, ${sample.heapBytes ?? "unknown"} heap bytes, ${sample.storageProtocol.records} storage records`,
  );
}

// Two complete warm-up cycles keep one-time shader, font, and module work out
// of the retained-resource comparison.
for (let warmup = 0; warmup < 2; warmup++)
  for (const demo of demoOrder) await loadAndRunDemo(demo);
startedAt = Date.now();
deadline = startedAt + durationMs;
await captureSample();
nextSampleAt = Date.now() + sampleIntervalMs;

while (Date.now() < deadline) {
  const cycleStartedAt = Date.now();
  await bounded(
    async () => {
      for (const demo of demoOrder) {
        await loadAndRunDemo(demo);
        if (Date.now() >= deadline) break;
      }
    },
    `release soak cycle ${cycles + 1}`,
  );
  cycles++;
  maxCycleDurationMs = Math.max(
    maxCycleDurationMs,
    Date.now() - cycleStartedAt,
  );
  if (Date.now() >= nextSampleAt) {
    await captureSample();
    nextSampleAt = Date.now() + sampleIntervalMs;
  }
}
// The deadline may interrupt a cycle on any demo. Return to the same reference
// blueprint used by the warm-up before comparing retained renderer resources.
await loadAndRunDemo(demoOrder.at(-1));
await captureSample();

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

console.log(
  JSON.stringify(
    {
      requestedDurationMs: durationMs,
      actualDurationMs: Date.now() - startedAt,
      cycles,
      maxCycleDurationMs,
      samples,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  const first = samples[0],
    last = samples.at(-1),
    heapSamples = samples
      .map((sample) => sample.heapBytes)
      .filter(Number.isFinite),
    settlingSampleCount = Math.min(5, Math.floor(heapSamples.length / 4)),
    settledHeapSamples = heapSamples.slice(settlingSampleCount),
    windowSize = Math.max(
      1,
      Math.min(5, Math.floor(settledHeapSamples.length / 2)),
    );
  assert.ok(
    cycles > 0,
    "release soak did not complete a load/start/stop cycle",
  );
  assert.ok(
    maxCycleDurationMs <= 180_000,
    `a release soak cycle stalled for ${maxCycleDurationMs} ms`,
  );
  assert.ok(
    Date.now() - startedAt >= durationMs,
    "release soak ended before its requested duration",
  );
  assert.equal(last.controllers, 0, "controller runtimes survived the soak");
  assert.equal(last.heatBindings, 0, "heat bindings survived the soak");
  assert.ok(
    samples.every((sample) => sample.storageProtocol.records <= 42),
    `storage generations grew beyond current/previous recovery bounds (${last.storageProtocol.records})`,
  );
  for (const key of ["geometries", "textures", "programs"])
    assert.ok(
      last.renderer[key] <= first.renderer[key] + 2,
      `renderer ${key} grew during the release soak`,
    );
  for (const key of ["buffers", "textures", "programs"])
    assert.ok(
      last.webgl[key] <= first.webgl[key] + 2,
      `raw WebGL ${key} grew during the release soak`,
    );
  if (settledHeapSamples.length >= 2) {
    const initialSettledMedian = median(
        settledHeapSamples.slice(0, windowSize),
      ),
      finalSettledMedian = median(settledHeapSamples.slice(-windowSize));
    assert.ok(
      finalSettledMedian <= initialSettledMedian + 4_000_000,
      `retained heap grew by more than 4 MB after the JIT/module settling window (${finalSettledMedian} vs ${initialSettledMedian})`,
    );
  }
  assertNoErrors(errors, "30-minute release soak");
});
