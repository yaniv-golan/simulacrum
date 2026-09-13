import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { createSpringStrut } from '../src/model/fixtures/spring-playground.mjs';
import { insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  SPRING_PERFORMANCE,
  measureSpringSimulation,
  evaluateSpringSimulation,
  evaluateSpringBrowser,
  springBenchmarkEnvironment,
} from './measure-springs.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/spring-performance');
mkdirSync(out, { recursive: true });
let browser;
const fixtures = new Map();
for (const count of [0, 1, 8, 32]) {
  let b = createEmptyBlueprint('benchmark', 'Springs');
  for (let i = 0; i < count; i++)
    b = insertAssembly(
      b,
      createSpringStrut(),
      [(i % 8) * 0.6, 0.02, Math.floor(i / 8) * 0.6],
      [0, 0, 0, 1],
    ).blueprint;
  const file = `${out}/${count}.json`;
  writeFileSync(file, JSON.stringify(b));
  fixtures.set(count, file);
}
const report = {
  ...evidence.identity,
  environment: springBenchmarkEnvironment(),
  policy: SPRING_PERFORMANCE,
  status: 'failed',
  trials: [],
  idle: [],
};
try {
  report.simulation = await measureSpringSimulation();
  report.simulationAcceptance = evaluateSpringSimulation(report.simulation);
  // Keep pure simulation measurements independent of browser startup and idle work.
  browser = await evidence.launch({
    profile: 'performance',
    // Headless macOS otherwise selects SwiftShader. Measure the native graphics backend.
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  const load = async (count) => {
    const receipt = await evidence.loadAndWait(page, fixtures.get(count), { ok: count !== 32 });
    if (count !== 32)
      await page.waitForFunction(
        (count) => JSON.parse(window.render_game_to_text()).springs.length === count,
        count,
      );
    return receipt;
  };
  const stableState = () =>
    page.evaluate(() => {
      const { metadata, physics, energy, springs } = JSON.parse(window.render_game_to_text());
      return { metadata, physics, energy, springs, cursor: window.workshopProbe.observe().cursor };
    });
  const collect = async (running) =>
    page.evaluate(
      async ({ policy, running }) => {
        const waitFrames = (n) =>
          new Promise((resolve) => {
            let left = n;
            const tick = () => (--left ? requestAnimationFrame(tick) : resolve());
            requestAnimationFrame(tick);
          });
        await waitFrames(policy.warmupFrames);
        const read = () => JSON.parse(window.render_game_to_text());
        const startTick = read().tick,
          startRendering = window.workshopProbe.readInteractionState().rendering.frames;
        const visible = !document.hidden,
          cadenceMs = [];
        let startTime, previous;
        await new Promise((resolve) => {
          const tick = (now) => {
            if (previous !== undefined) cadenceMs.push(now - previous);
            else startTime = now;
            previous = now;
            if (cadenceMs.length === policy.sampleFrames) resolve();
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
        const endTick = read().tick,
          rendering = window.workshopProbe.readInteractionState().rendering;
        const frames = rendering.frames - startRendering;
        return {
          warmupFrames: policy.warmupFrames,
          cadenceMs,
          elapsedMs: previous - startTime,
          startTick,
          endTick,
          visible: visible && !document.hidden,
          renderCostsMs: running ? rendering.costsMs.slice(-frames) : [],
          viewRenderMs: running ? rendering.viewRenderMs.slice(-frames) : [],
          completedDraw: rendering.completedDraw,
          renderedFrames: frames,
          quality: rendering.quality,
        };
      },
      { policy: SPRING_PERFORMANCE, running },
    );
  await load(0);
  report.browserEnvironment = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2'),
      debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio,
      viewport: [innerWidth, innerHeight],
      renderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
    };
  });
  report.idle.push(await collect(false));
  for (let trial = 0; trial < SPRING_PERFORMANCE.repetitions; trial++)
    for (const count of trial % 2 ? [8, 1, 0] : [0, 1, 8]) {
      await load(count);
      await page.locator('[data-command=run]').click();
      const sample = await collect(true);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      const frame = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      evidence.assert('equal', [frame.status, 'ready'], { frame });
      report.trials.push({ trial, count, ...sample });
      await page.locator('[data-command=build]').click();
      await page.waitForFunction(
        () => JSON.parse(window.render_game_to_text()).metadata.mode === 'build',
      );
    }
  await load(8);
  const rejection = await evidence.assertRejectedEdit({
    snapshot: stableState,
    action: () => load(32),
  });
  evidence.assert('equal', [rejection.input.save.parts.length, 128]);
  // Repeat the identical rejection to prove a previous receipt cannot satisfy this attempt.
  const repeated = await evidence.assertRejectedEdit({
    snapshot: stableState,
    action: () => load(32),
  });
  evidence.assert('ok', [repeated.sequence > rejection.sequence]);
  report.rejection = rejection;
  await load(0);
  report.idle.push(await collect(false));
  const client = await page.context().newCDPSession(page);
  await client.send('HeapProfiler.collectGarbage');
  const before = await client.send('Runtime.getHeapUsage');
  const resources = [];
  for (let i = 0; i < 8; i++) {
    await load(8);
    await load(0);
    await page.waitForTimeout(50);
    resources.push(
      await page.evaluate(() => window.workshopProbe.readInteractionState().rendering),
    );
  }
  await client.send('HeapProfiler.collectGarbage');
  const after = await client.send('Runtime.getHeapUsage');
  evidence.assert('equal', [resources.at(-1).geometries, resources[0].geometries]);
  evidence.assert('equal', [resources.at(-1).textures, resources[0].textures]);
  evidence.assert('ok', [
    after.usedSize - before.usedSize < 4 * 1024 * 1024,
    'retained heap growth after warmup/replacement must remain bounded',
  ]);
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  report.resources = resources;
  report.heap = { before, after };
  report.browserAcceptance = evaluateSpringBrowser(report.trials, report.idle);
  report.status = 'passed';
} catch (error) {
  report.failure = error.message;
  await evidence.captureFailure(error);
  throw error;
} finally {
  report.errors = evidence.errors;
  writeFileSync(`${out}/result.json`, JSON.stringify(report, null, 2));
  await browser?.close();
}
