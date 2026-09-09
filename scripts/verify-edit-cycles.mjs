import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './build-fingerprint.mjs';
const browserEvidence = createBrowserEvidence();

const out = 'artifacts/edit-cycles';
mkdirSync(out, { recursive: true });
const source = sourceIdentity(),
  build = appFingerprint(),
  errors = browserEvidence.errors,
  samples = [];
const browser = await browserEvidence.launch({ profile: 'ui', ...{} });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const startedAt = performance.now();

const observe = () =>
  page.evaluate(() => ({
    frame: window.workshopProbe.observe().frames[0],
    transforms: window.workshopProbe.readRenderedTransforms(),
  }));
function agree(state) {
  for (const [i, part] of state.frame.metadata.blueprint.parts.entries()) {
    const rendered = state.transforms.find((t) => t.id === part.id);
    browserEvidence.assert(
      'deepEqual',
      [rendered.position, state.frame.physics[i].position, `${part.id} position`],
      { frame: state.frame },
    );
    browserEvidence.assert(
      'deepEqual',
      [rendered.rotation, state.frame.physics[i].rotation, `${part.id} rotation`],
      { frame: state.frame },
    );
  }
}
let served;
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  served = await page.locator('meta[name=build-id]').getAttribute('content');
  browserEvidence.assert('equal', [served, build]);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) {
    await page.locator('[data-command=guide-step]').click();
    await page.waitForFunction((n) => {
      const b = window.workshopProbe.observe().frames[0].metadata.blueprint;
      return b.parts.length + b.connections.length === n;
    }, i + 1);
  }
  const initial = await observe();
  agree(initial);
  const wrong = structuredClone(initial);
  wrong.transforms[0].position[0] += 0.01;
  browserEvidence.assert('throws', [
    () => agree(wrong),
    /position/,
    'comparison must reject a wrong rendered transform',
  ]);
  writeFileSync(
    `${out}/negative-control.json`,
    JSON.stringify({ rejected: true, perturbation: 'rendered x +0.01m' }, null, 2),
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  for (let cycle = 1; cycle <= 12; cycle++) {
    console.log(`cycle ${cycle} start ${Math.round(performance.now() - startedAt)}ms`);
    const before = (await observe()).frame.metadata.blueprint;
    await page.locator('[data-command=run]').click();
    await page.waitForFunction(() => {
      const state = window.workshopProbe.observe();
      return state.cursor.tick >= 120 || state.frames[0].status === 'failed';
    });
    browserEvidence.assert('equal', [
      (await observe()).frame.status,
      'ready',
      `cycle ${cycle} failed before 120 ticks`,
    ]);
    await page.locator('[data-command=pause]').click();
    const paused = await observe();
    agree(paused);
    browserEvidence.assert('deepEqual', [
      paused.frame.metadata.blueprint,
      before,
      'running preserves authored blueprint',
    ]);
    await page.locator('[data-command=build]').click();
    const reset = await observe();
    agree(reset);
    browserEvidence.assert('deepEqual', [
      reset.frame.metadata.blueprint,
      before,
      'Build preserves authored blueprint',
    ]);
    for (const [i, part] of before.parts.entries())
      browserEvidence.assert(
        'deepEqual',
        [
          reset.frame.physics[i].position,
          part.position.map(Math.fround),
          'Build resets authored position at physics float32 precision',
        ],
        { frame: reset.frame },
      );
    if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator('.part-list [data-part-id="guide-motor"]').click();
    const drive = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
    await drive.fill(cycle % 2 ? '0.3' : '0.5');
    await drive.press('Tab');
    await page.waitForFunction(
      (value) =>
        window.workshopProbe
          .observe()
          .frames[0].metadata.blueprint.parts.find((p) => p.id === 'guide-motor').parameters
          .defaultDuty === value,
      cycle % 2 ? 0.3 : 0.5,
    );
    const edited = (await observe()).frame.metadata.blueprint;
    browserEvidence.assert('notDeepEqual', [edited, before]);
    await page.locator('[data-command=undo]').click();
    browserEvidence.assert('deepEqual', [(await observe()).frame.metadata.blueprint, before]);
    await page.locator('[data-command=redo]').click();
    browserEvidence.assert('deepEqual', [(await observe()).frame.metadata.blueprint, edited]);
    if (cycle === 6) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await (await pending).saveAs(`${out}/saved-machine.json`);
      await page.locator('[data-command=new]').click();
      await page.waitForFunction(
        () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 0,
      );
      await page.locator('input[type=file]').setInputFiles(`${out}/saved-machine.json`);
      await page.waitForFunction(
        () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 8,
      );
      browserEvidence.assert('deepEqual', [
        (await observe()).frame.metadata.blueprint,
        edited,
        'download and reload preserve authored blueprint',
      ]);
    }
    const state = await observe();
    agree(state);
    const counters = await cdp.send('Memory.getDOMCounters');
    const metrics = Object.fromEntries(
      (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
    );
    samples.push({
      cycle,
      tick: paused.frame.tick ?? null,
      cursor: await page.evaluate(() => window.workshopProbe.observe().cursor),
      counters,
      liveDomNodes: await page.locator('*').count(),
      jsHeapUsedSize: metrics.JSHeapUsedSize,
      jsHeapTotalSize: metrics.JSHeapTotalSize,
      paused,
      state,
    });
    browserEvidence.assertUnchanged();
    writeFileSync(
      `${out}/progress.json`,
      JSON.stringify(
        { ...browserEvidence.identity, source, build, served, errors, samples },
        null,
        2,
      ),
    );
  }
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assert('equal', [
    appFingerprint(),
    build,
    'application source unchanged during probe',
  ]);
  await page.screenshot({ path: `${out}/completed.png` });
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        source,
        finalSource: sourceIdentity(),
        build,
        served,
        browser: browser.version(),
        errors,
        samples,
        scope:
          '12 cycles; raw heap and DOM counters, no leak threshold or forced GC; first 2 cycles warmup; source must remain unchanged',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      samples.map(({ cycle, counters, liveDomNodes, jsHeapUsedSize }) => ({
        cycle,
        counters,
        liveDomNodes,
        jsHeapUsedSize,
      })),
      null,
      2,
    ),
  );
} catch (error) {
  await browserEvidence.captureFailure(error);

  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify(
      {
        source,
        build,
        served,
        errors,
        samples,
        current: await observe().catch(() => null),
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
