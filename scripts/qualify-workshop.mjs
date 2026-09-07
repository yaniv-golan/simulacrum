import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, platform, arch, release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { appFingerprint } from './app-fingerprint.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { BUILD_ENVIRONMENT } from '../src/model/environment.mjs';
const viewport = { width: 1440, height: 900 };
const expectedKinds = { place: 3, connect: 2, run: 1, 'run-first-tick': 1 };
export function evaluateF2(cycles, { build } = {}) {
  if (!Array.isArray(cycles) || cycles.length !== 10 || typeof build !== 'string' || !build)
    throw Error('F2 requires ten complete cycles and a build identity');
  const durations = [],
    machines = new Set();
  for (const [index, cycle] of cycles.entries()) {
    if (
      cycle.cycle !== index + 1 ||
      typeof cycle.machine !== 'string' ||
      !cycle.machine ||
      machines.has(cycle.machine) ||
      !Array.isArray(cycle.metrics) ||
      cycle.metrics.length !== 7
    )
      throw Error(`incomplete F2 cycle ${index + 1}`);
    machines.add(cycle.machine);
    const counts = {};
    for (const metric of cycle.metrics) {
      if (
        !Object.hasOwn(expectedKinds, metric.kind) ||
        metric.machine !== cycle.machine ||
        metric.buildId !== build ||
        metric.timestampSource !== 'input-event' ||
        metric.eventType !== 'click' ||
        !Number.isFinite(metric.inputTime) ||
        metric.inputTime < 0 ||
        !Number.isFinite(metric.completedAt) ||
        !Number.isFinite(metric.durationMs) ||
        metric.durationMs < 0 ||
        metric.completedAt < metric.inputTime ||
        metric.superseded === true ||
        metric.outcome === 'cancelled'
      )
        throw Error(`invalid F2 sample in cycle ${index + 1}`);
      if (metric.kind === 'run-first-tick') {
        if (
          metric.outcome !== 'completed' ||
          metric.startTick !== 0 ||
          !Number.isSafeInteger(metric.tick) ||
          metric.tick <= 0
        )
          throw Error(`incomplete first tick in cycle ${index + 1}`);
      } else if (metric.superseded !== false)
        throw Error(`unverified reflecting frame in cycle ${index + 1}`);
      const elapsed = metric.completedAt - metric.inputTime;
      if (Math.abs(metric.durationMs - elapsed) > 1)
        throw Error(`F2 duration disagrees with measured elapsed time in cycle ${index + 1}`);
      counts[metric.kind] = (counts[metric.kind] ?? 0) + 1;
      durations.push(Math.max(metric.durationMs, elapsed));
    }
    if (Object.entries(expectedKinds).some(([kind, count]) => counts[kind] !== count))
      throw Error(`wrong F2 command coverage in cycle ${index + 1}`);
    if (
      cycle.metrics
        .slice(0, 5)
        .map((metric) => metric.kind)
        .join(',') !== 'place,place,place,connect,connect'
    )
      throw Error(`wrong F2 operation order in cycle ${index + 1}`);
  }
  durations.sort((a, b) => a - b);
  const p95Ms = durations[Math.ceil(durations.length * 0.95) - 1],
    maxMs = durations.at(-1);
  if (maxMs > 500) throw Error(`F2 stall ${maxMs.toFixed(3)} ms exceeds 500 ms`);
  if (p95Ms >= 2000) throw Error(`F2 p95 ${p95Ms.toFixed(3)} ms must be below 2000 ms`);
  return {
    passed: true,
    cycles: 10,
    samples: durations.length,
    p95Ms,
    maxMs,
    percentile: 'nearest rank',
    thresholds: { p95ExclusiveMs: 2000, maxInclusiveMs: 500 },
  };
}
export async function qualifyWorkshop(
  url = 'http://127.0.0.1:4173/',
  { createEvidence = createBrowserEvidence } = {},
) {
  const evidence = createEvidence();
  const source = sourceIdentity(),
    build = appFingerprint(),
    errors = evidence.errors,
    cycles = [];
  const browser = await evidence.launch({ profile: 'performance', ...{ headless: true } }),
    page = await browser.newPage({ viewport });
  const report = {
    version: 1,
    bar: 'F2',
    sourceIdentity: source,
    appFingerprint: build,
    recordedAt: new Date().toISOString(),
    protocol: {
      version: 1,
      scene: 'default workshop ground',
      environment: BUILD_ENVIRONMENT,
      machine: 'Power Cell + Powered Motor + Grip Wheel, power and shaft connections',
      cycles: 10,
      viewport,
      commandsPerCycle: expectedKinds,
      clock: 'production requestAnimationFrame; no synthetic advancement',
    },
    runtime: { node: process.version, browser: browser.version() },
    hardware: {
      platform: platform(),
      architecture: arch(),
      osRelease: release(),
      cpu: cpus()[0]?.model,
      logicalProcessors: cpus().length,
      memoryBytes: totalmem(),
    },
    cycles,
    errors,
  };

  mkdirSync('artifacts/m3b', { recursive: true });
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.workshopProbe);
    report.servedBuild = await page.locator('meta[name=build-id]').getAttribute('content');
    evidence.assert('equal', [
      report.servedBuild,
      build,
      'served build does not match current app fingerprint',
    ]);
    report.runtime.browserDevice = await page.evaluate(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl2'),
        extension = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null,
        pixelRatio: devicePixelRatio,
        webglVendor: gl?.getParameter(extension ? extension.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
        webglRenderer: gl?.getParameter(
          extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
        ),
      };
    });
    const metricCount = () => page.evaluate(() => window.workshopProbe.metrics().length);
    async function measuredClick(locator, increment = 1) {
      const before = await metricCount();
      await locator.click();
      await page.waitForFunction(
        (expected) => window.workshopProbe.metrics().length >= expected,
        before + increment,
      );
    }
    async function connect(a, portA, b, portB) {
      if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
        await page.locator('.machine-picker > summary').click();
      await page.locator(`.part-list [data-part-id="${a}"]`).click();
      await page.locator(`.port-button[data-part-id="${a}"][data-port-id="${portA}"]`).click();
      await measuredClick(
        page.locator(`[data-target-part-id="${b}"][data-target-port-id="${portB}"]`),
      );
    }
    for (let cycle = 1; cycle <= 10; cycle++) {
      const previousMachine = await page.evaluate(
        () => window.workshopProbe.observe().frames[0].metadata.blueprint.id,
      );
      await page.locator('[data-command=new]').click();
      await page.waitForFunction((previous) => {
        const f = window.workshopProbe.observe().frames[0];
        return (
          f.metadata.blueprint.id !== previous &&
          f.tick === 0 &&
          f.metadata.mode === 'build' &&
          f.metadata.blueprint.parts.length === 0
        );
      }, previousMachine);
      const start = await metricCount();
      for (const type of ['powerCell', 'poweredMotor', 'gripWheel'])
        await measuredClick(page.locator(`[data-part-type="${type}"]`));
      let blueprint = await page.evaluate(
        () => window.workshopProbe.observe().frames[0].metadata.blueprint,
      );
      const id = (type) => blueprint.parts.find((part) => part.type === type).id;
      await connect(id('powerCell'), 'power', id('poweredMotor'), 'power');
      await connect(id('poweredMotor'), 'shaft', id('gripWheel'), 'axle');
      blueprint = await page.evaluate(
        () => window.workshopProbe.observe().frames[0].metadata.blueprint,
      );
      await measuredClick(page.locator('[data-command=run]'), 2);
      await page.locator('[data-command=pause]').click();
      await page.waitForFunction(
        () => window.workshopProbe.observe().frames[0].metadata.mode === 'paused',
      );
      const state = await page.evaluate(
        (start) => ({
          frame: window.workshopProbe.observe().frames[0],
          metrics: window.workshopProbe.metrics().slice(start),
          transforms: window.workshopProbe.readRenderedTransforms(),
          text: JSON.parse(window.render_game_to_text()),
        }),
        start,
      );
      cycles.push({
        cycle,
        machine: blueprint.id,
        blueprint,
        metrics: state.metrics,
        final: state.frame,
      });
      evidence.assert('equal', [state.frame.status, 'ready', `cycle ${cycle} simulation failed`]);
      evidence.assert('deepEqual', [state.frame, state.text]);
      for (const [index, part] of blueprint.parts.entries()) {
        const rendered = state.transforms.find((value) => value.id === part.id);
        evidence.assert('deepEqual', [rendered.position, state.frame.physics[index].position], {
          frame: state.frame,
        });
        evidence.assert('deepEqual', [rendered.rotation, state.frame.physics[index].rotation], {
          frame: state.frame,
        });
      }
    }
    report.result = evaluateF2(cycles, { build });
    evidence.assert('deepEqual', [errors, [], 'browser errors during F2']);
    evidence.assert('deepEqual', [
      sourceIdentity(),
      source,
      'source changed during F2 qualification',
    ]);
    evidence.assert('equal', [appFingerprint(), build]);
    report.metrics = await page.evaluate(() => window.workshopProbe.metrics());
    await page.screenshot({ path: 'artifacts/m3b/f2.png' });
    writeFileSync('artifacts/m3b/f2.json', JSON.stringify(report, null, 2) + '\n');
    return report;
  } catch (error) {
    await evidence.captureFailure(error);
    report.failure = error.message;
    report.metrics = await page
      .evaluate(() => window.workshopProbe?.metrics() ?? [])
      .catch(() => []);
    await page.screenshot({ path: 'artifacts/m3b/f2-failed.png' }).catch(() => {});
    writeFileSync('artifacts/m3b/f2-attempt.json', JSON.stringify(report, null, 2) + '\n');
    throw error;
  } finally {
    await browser.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await qualifyWorkshop(process.argv[2]);
    console.log(
      `F2 passed: ${report.result.samples} samples, p95 ${report.result.p95Ms.toFixed(2)} ms, maximum ${report.result.maxMs.toFixed(2)} ms`,
    );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
  }
}
