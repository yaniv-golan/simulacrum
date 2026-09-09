import { createBrowserEvidence } from './browser-evidence.mjs';
import { createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { createSpringStrut } from '../src/model/fixtures/spring-playground.mjs';
import { insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence(),
  out = 'artifacts/spring-performance';
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  const load = async (count) => {
    await page.locator('input[type=file]').setInputFiles(fixtures.get(count));
    await page.waitForFunction((count) => {
      const receipt = window.workshopProbe.readLastCommandResult();
      return (
        receipt?.input.type === 'load' &&
        receipt.input.save.parts.length === count * 4 &&
        (count === 32
          ? receipt.result.ok === false
          : receipt.result.ok && JSON.parse(window.render_game_to_text()).springs.length === count)
      );
    }, count);
  };
  const stableState = () =>
    page.evaluate(() => {
      const { metadata, physics, energy, springs } = JSON.parse(window.render_game_to_text());
      return { metadata, physics, energy, springs, cursor: window.workshopProbe.observe().cursor };
    });
  const samples = [];
  for (const count of [0, 1, 8, 32]) {
    const beforeLoad = await stableState();
    await load(count);
    const loaded = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (count === 32) {
      evidence.assert('equal', [loaded.springs.length, 8]);
      const result = await page.evaluate(() => window.workshopProbe.readLastCommandResult());
      evidence.assert('equal', [result.result.ok, false]);
      evidence.assert('equal', [result.input.type, 'load']);
      evidence.assert('equal', [result.input.save.parts.length, 128]);
      evidence.assert('deepEqual', [await stableState(), beforeLoad]);
      samples.push({
        count,
        rejected: true,
        result: await page.evaluate(() => window.workshopProbe.readLastCommandResult()),
      });
      continue;
    }
    evidence.assert('equal', [loaded.springs.length, count]);
    await page.locator('[data-command=run]').click();
    const cadence = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const samples = [];
          let previous = performance.now();
          function tick(now) {
            samples.push(now - previous);
            previous = now;
            if (samples.length === 90) resolve(samples);
            else requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }),
    );
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const rendering = await page.evaluate(
      () => window.workshopProbe.readInteractionState().rendering,
    );
    const frame = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    evidence.assert('equal', [frame.status, 'ready'], { frame });
    samples.push({ count, cadenceMs: cadence, rendering, tick: frame.tick });
    await page.locator('[data-command=build]').click();
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).metadata.mode === 'build',
    );
  }
  await load(0);
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
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        samples,
        resources,
        heap: { before, after },
        errors: evidence.errors,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
