import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { startTestServer } from "./lib/test-server.mjs";
import { installWebGLResourceTracker } from "./lib/webgl-resource-tracker.mjs";
import { componentDefaults } from "../src/model/component-resolver.js";
import { createSharePackage } from "../src/model/share-packages.js";

const root = path.resolve(import.meta.dirname, "..");
const outputArgument = process.argv.find((value) =>
  value.startsWith("--output="),
);
const sourceRootArgument = process.argv.find((value) =>
  value.startsWith("--source-root="),
);
const sourceRoot = path.resolve(
  root,
  sourceRootArgument?.slice("--source-root=".length) || root,
);
const outputPath = path.resolve(
  root,
  outputArgument?.slice("--output=".length) ||
    path.join("scripts", "baselines", "release-0.1.0.json"),
);
const warmupRuns = 5;
const measuredRuns = 9;
const framesPerRun = 3;
const command = (args, cwd = sourceRoot) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
const workspaceChecksum = async (cwd, excludes = []) => {
  const hash = crypto.createHash("sha256");
  hash.update(
    command(
      [
        "diff",
        "--binary",
        "HEAD",
        "--",
        ".",
        ...excludes.map((value) => `:(exclude)${value}`),
      ],
      cwd,
    ),
  );
  const untracked = command(
    ["ls-files", "--others", "--exclude-standard", "-z"],
    cwd,
  )
    .split("\0")
    .filter(Boolean)
    .filter((value) => !excludes.includes(value))
    .sort();
  for (const relativePath of untracked) {
    hash.update(`\0${relativePath}\0`);
    hash.update(await fs.readFile(path.join(cwd, relativePath)));
  }
  return hash.digest("hex");
};
const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
};
const slope = (values) => {
  const points = values
    .map((value, index) => [index, value])
    .filter(([, value]) => Number.isFinite(value));
  if (points.length < 2) return null;
  const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
  const numerator = points.reduce(
    (sum, [x, y]) => sum + (x - meanX) * (y - meanY),
    0,
  );
  const denominator = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
  return denominator ? numerator / denominator : 0;
};
const sourceChecksumExcludes = sourceRoot === root ? [] : ["node_modules"];
const sourceIdentity = {
  commit: command(["rev-parse", "HEAD"]),
  dirtySha256: await workspaceChecksum(sourceRoot, sourceChecksumExcludes),
  checksumExcludes: sourceChecksumExcludes,
};
const harnessIdentity = {
  commit: command(["rev-parse", "HEAD"], root),
  dirtySha256: await workspaceChecksum(root, [path.relative(root, outputPath)]),
  checksumExcludes: [path.relative(root, outputPath)],
};

await fs.rm(path.join(sourceRoot, "dist"), { recursive: true, force: true });
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  {
    cwd: sourceRoot,
    stdio: "inherit",
  },
);

let server;
let browser;
let fixtureErrors;
let failure = null;
let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await browser?.close().catch(() => {});
  await server?.stop().catch(() => {});
  process.exit(130);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
try {
  server = await startTestServer({
    root: sourceRoot,
    artifactsDir: path.join(root, "artifacts", "test-harness"),
    viteConfigPath: path.join(root, "vite.config.js"),
    mode: "preview",
  });
  process.env.TEST_BASE_URL = server.baseUrl;
  process.env.TEST_BUILD_MARKER = server.marker;
  process.env.TEST_SUITE_NAME = "release-performance-capture";
  const { createBrowserTest, seedCurrentTestStorage } =
    await import("./lib/browser-test.mjs");
  const fixture = await createBrowserTest({
    viewport: { width: 1024, height: 720 },
    defaultTimeoutMs: 60_000,
    launchOptions: { args: ["--js-flags=--expose-gc"] },
  });
  ({ browser } = fixture);
  const { page, errors, baseUrl } = fixture;
  fixtureErrors = errors;

  const installBaselineMetrics = () => {
    const metrics = (window.__simulacrumBaselineMetrics = {
      blobs: 0,
      workers: 0,
    });
    const nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    const liveUrls = new Set();
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
        this.__trackedLive = true;
      }
      terminate() {
        if (this.__trackedLive) {
          metrics.workers--;
          this.__trackedLive = false;
        }
        return super.terminate();
      }
    };
  };
  await page.context().addInitScript(installBaselineMetrics);
  await installWebGLResourceTracker(page);

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await page.click("#sandbox-start");
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
  }));
  const unsupportedBlueprint = {
    format: "simulacrum-blueprint",
    version: 0,
    name: "Release 300-part benchmark",
    parts,
    connections: [],
    remoteProfile: "cart",
  };
  const blueprint = {
    format: "simulacrum-blueprint",
    version: 1,
    name: "Release 300-part benchmark",
    parts,
    connections: [],
    remoteProfiles: {},
    defaultRemoteProfile: null,
  };
  const sharedBlueprint = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: {
      title: blueprint.name,
      description: "Release large-assembly benchmark fixture",
    },
  });
  await page.click("#tools-btn");
  await page.click("#blueprint-btn");
  if (await page.locator("#blueprint-json").count()) {
    // Some benchmark harnesses expose the JSON fixture input instead of the
    // portable share-package input. This branch belongs to the measurement
    // harness and is not a product import path.
    await page.locator("#blueprint-modal details").evaluate((element) => {
      element.open = true;
    });
    await page.fill("#blueprint-json", JSON.stringify(unsupportedBlueprint));
    await page.click("#import-machine");
  } else {
    await page.waitForFunction(
      () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
    );
    await page.fill("#share-paste", JSON.stringify(sharedBlueprint));
    await page.click("#import-shared-text");
    await page
      .locator(
        `.exchange-item[data-fingerprint="${sharedBlueprint.fingerprint}"]`,
      )
      .locator("[data-load-share]")
      .click();
  }
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length === 300,
  );
  // Measure steady-state rendering. The current renderer enables its large-
  // assembly batching and adaptive pixel ratio over several animation frames;
  // sampling immediately after import measures setup transients instead of the
  // sustained 300-part frame budget. Use the same warmup for every release
  // source so the comparison remains symmetric.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const warm = () => {
          if (++frames >= 120) resolve();
          else requestAnimationFrame(warm);
        };
        requestAnimationFrame(warm);
      }),
  );

  const frameRuns = [];
  const drawCallSamples = [];
  console.log("Baseline stage: 300-part render samples");
  for (let index = 0; index < warmupRuns + measuredRuns; index++) {
    await page.evaluate(() => (window.__simulacrumWebGLMetrics.draws = 0));
    const frameSamples = await page.evaluate(
      (frameCount) =>
        new Promise((resolve) => {
          const samples = [];
          let previous = performance.now();
          const sample = (now) => {
            samples.push(now - previous);
            previous = now;
            if (samples.length >= frameCount + 2) resolve(samples.slice(2));
            else requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
      framesPerRun,
    );
    const drawCalls = await page.evaluate(
      () => window.__simulacrumWebGLMetrics.draws,
    );
    if (index >= warmupRuns) {
      frameRuns.push(frameSamples);
      drawCallSamples.push(drawCalls);
    }
  }

  console.log("Baseline stage: fixed-step samples on reference rover");
  await page.locator("#demos-btn").dispatchEvent("click");
  await page.locator('[data-demo="cart"]').dispatchEvent("click");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).parts.length < 300,
  );
  const simulationState = () =>
    page.evaluate(() => {
      const state = JSON.parse(window.render_game_to_text());
      return { mode: state.mode, running: Boolean(state.running) };
    });
  const ensureSimulationRunning = async () => {
    let state = await simulationState();
    if (state.mode === "build") {
      await page.locator("#run-btn").dispatchEvent("click");
      await page.waitForFunction(
        () => JSON.parse(window.render_game_to_text()).mode !== "build",
      );
      state = await simulationState();
    }
    if (state.running) return;
    await page.locator("#run-btn").dispatchEvent("click");
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).running,
      null,
      { timeout: 60_000 },
    );
  };
  const stopSimulation = async () => {
    if (!(await simulationState()).running) return;
    await page.locator("#run-btn").dispatchEvent("click");
    await page.waitForFunction(
      () => !JSON.parse(window.render_game_to_text()).running,
    );
  };
  const fixedStepSamples = [];
  for (let index = 0; index < warmupRuns + measuredRuns; index++) {
    await ensureSimulationRunning();
    const sample = await page.evaluate(() => {
      const before = JSON.parse(window.render_game_to_text()).simulationTime,
        started = performance.now();
      window.advanceTime(1000);
      const after = JSON.parse(window.render_game_to_text()).simulationTime;
      return {
        elapsedMs: performance.now() - started,
        simulatedDeltaS: after - before,
      };
    });
    await stopSimulation();
    if (sample.simulatedDeltaS < 0.99)
      throw new Error(
        `fixed-step sample advanced only ${sample.simulatedDeltaS} simulated seconds`,
      );
    if (index >= warmupRuns) fixedStepSamples.push(sample.elapsedMs);
  }

  const cycles = [];
  const demos = ["gearbox", "cart", "drone", "humanoid", "mission"];
  console.log("Baseline stage: 20-cycle resource stress");
  for (let index = 0; index < 20; index++) {
    const closeRemote = page.locator("#close-remote");
    if (await closeRemote.isVisible()) await closeRemote.dispatchEvent("click");
    await page.locator("#demos-btn").dispatchEvent("click");
    await page
      .locator(`[data-demo="${demos[index % demos.length]}"]`)
      .dispatchEvent("click");
    await page.waitForTimeout(100);
    const sample = await page.evaluate(() => {
      globalThis.gc?.();
      const webgl = window.__simulacrumWebGLMetrics;
      return {
        drawCalls: webgl.draws,
        blobs: window.__simulacrumBaselineMetrics.blobs,
        workers: window.__simulacrumBaselineMetrics.workers,
        resources: {
          buffers: webgl.buffers,
          programs: webgl.programs,
          textures: webgl.textures,
        },
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    });
    cycles.push(sample);
  }

  // Startup pages share a browser process, so create them only after the
  // steady-state render, simulation, and resource measurements, then close
  // that continuously-rendering page. Leaving it alive makes startup measure
  // GPU/CPU contention from a second application instance instead of the
  // release's own cold-page readiness. Teardown cannot contaminate the earlier
  // benchmarks because every one of them is already complete.
  await page.close();
  const startupSamples = [];
  console.log("Baseline stage: startup warmups and samples");
  for (let index = 0; index < warmupRuns + measuredRuns; index++) {
    const samplePage = await browser.newPage({
      viewport: { width: 1024, height: 720 },
    });
    await samplePage.addInitScript(seedCurrentTestStorage);
    const started = performance.now();
    await samplePage.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await samplePage.waitForFunction(
      () => typeof window.render_game_to_text === "function",
    );
    const elapsed = performance.now() - started;
    if (index >= warmupRuns) startupSamples.push(elapsed);
    await samplePage.close();
  }

  const distAssets = (
    await fs.readdir(path.join(sourceRoot, "dist", "assets"))
  ).filter((name) => /\.(?:js|css|woff2)$/.test(name));
  const bundles = [];
  for (const name of distAssets) {
    const bytes = await fs.readFile(
      path.join(sourceRoot, "dist", "assets", name),
    );
    bundles.push({
      name,
      bytes: bytes.length,
      gzipBytes: gzipSync(bytes).length,
    });
  }

  const flatFrames = frameRuns.flat();
  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: sourceIdentity,
    measurementHarness: harnessIdentity,
    environment: {
      node: process.version,
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      cpus: os.cpus().map((cpu) => cpu.model),
      totalMemoryBytes: os.totalmem(),
      browser: browser.version(),
      viewport: { width: 1024, height: 720 },
      browserFlags: ["--js-flags=--expose-gc"],
      warmupRuns,
      measuredRuns,
      framesPerMeasuredRun: framesPerRun,
    },
    raw: {
      startupMs: startupSamples,
      frameMsByRun: frameRuns,
      fixedStep1000Ms: fixedStepSamples,
      drawCallsPerMeasuredRun: drawCallSamples,
      cycles,
      bundles,
    },
    summary: {
      startupMedianMs: median(startupSamples),
      frameMedianMs: median(flatFrames),
      fixedStep1000MedianMs: median(fixedStepSamples),
      drawCallsPerMeasuredRunMedian: median(drawCallSamples),
      bundleGzipBytes: bundles.reduce((sum, item) => sum + item.gzipBytes, 0),
      heapSlopeBytesPerCycle: slope(cycles.map((sample) => sample.heapBytes)),
      bufferSlopePerCycle: slope(
        cycles.map((sample) => sample.resources.buffers),
      ),
      programSlopePerCycle: slope(
        cycles.map((sample) => sample.resources.programs),
      ),
      textureSlopePerCycle: slope(
        cycles.map((sample) => sample.resources.textures),
      ),
      workerSlopePerCycle: slope(cycles.map((sample) => sample.workers)),
      blobUrlSlopePerCycle: slope(cycles.map((sample) => sample.blobs)),
    },
    errors: fixtureErrors,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `release performance capture written to ${path.relative(root, outputPath)}`,
  );
} catch (error) {
  failure = error;
} finally {
  try {
    if (browser) await browser.close();
  } catch (error) {
    failure ??= error;
  }
  try {
    if (server) await server.stop();
  } catch (error) {
    failure ??= error;
  }
}
process.off("SIGINT", shutdown);
process.off("SIGTERM", shutdown);
if (failure) throw failure;
