import { finalRollingIntervals } from './starter-motion.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './build-fingerprint.mjs';
const browserEvidence = createBrowserEvidence();

const source = sourceIdentity(),
  build = appFingerprint(),
  errors = browserEvidence.errors,
  samples = [];
const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

let last;
const frame = () => page.evaluate(() => window.workshopProbe.observe().frames[0]);
mkdirSync('artifacts/starter-browser', { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  browserEvidence.assert('equal', [
    await page.locator('meta[name=build-id]').getAttribute('content'),
    build,
  ]);
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) {
    await page.locator('[data-command=guide-step]').click();
    await page.waitForFunction((n) => {
      const m = window.workshopProbe.observe().frames[0].metadata;
      return m.blueprint.parts.length + m.blueprint.connections.length === n;
    }, i + 1);
  }
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  const rows = await page.locator('.part-list-item').evaluateAll((items) =>
    items.map((item) => {
      const range = document.createRange();
      range.selectNodeContents(item);
      const text = range.getBoundingClientRect(),
        box = item.getBoundingClientRect();
      return { name: item.textContent, fits: text.top >= box.top && text.bottom <= box.bottom };
    }),
  );
  browserEvidence.assert('ok', [
    rows.every((row) => row.fits),
    `selection rows clipped: ${JSON.stringify(rows)}`,
  ]);
  const built = await frame();
  browserEvidence.assert('equal', [built.metadata.blueprint.parts.length, 8]);
  browserEvidence.assert('equal', [built.metadata.blueprint.connections.length, 8]);
  browserEvidence.assert('ok', [built.metadata.connections.every((c) => c.reasonCode === 'OK')]);
  // A single visible edit is one undo operation, then redo restores it.
  await page.locator('[data-command=undo]').click();
  browserEvidence.assert('equal', [(await frame()).metadata.blueprint.connections.length, 7]);
  await page.locator('[data-command=redo]').click();
  browserEvidence.assert('deepEqual', [
    (await frame()).metadata.blueprint,
    built.metadata.blueprint,
  ]);
  await page.locator('[data-command=run]').click();
  for (const tick of [1200, ...Array.from({ length: 11 }, (_, i) => 2400 + i * 120)]) {
    await page.waitForFunction((t) => window.workshopProbe.observe().cursor.tick >= t, tick, {
      timeout: 45000,
    });
    samples.push(await frame());
  }
  await page.locator('[data-command=pause]').click();
  last = await frame();
  const start = built.physics[0].position;
  const travel = Math.hypot(
    last.physics[0].position[0] - start[0],
    last.physics[0].position[2] - start[2],
  );
  browserEvidence.assert('ok', [travel > 2, `sustained travel ${travel}`]);
  browserEvidence.assert('ok', [samples.every((f) => f.status === 'ready')]);
  // A rolling machine can circle back near its earlier position. Measure each
  // final-second interval, not a chord across the loop or a later Pause frame.
  const finalIntervals = finalRollingIntervals(samples.slice(1));
  const moving = finalIntervals.reduce((sum, distance) => sum + distance, 0);
  const centers = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
  browserEvidence.assert('ok', [
    centers.every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && Math.abs(p.z) < 1),
    'follow keeps machine in view',
  ]);
  await page.screenshot({ path: 'artifacts/starter-browser/sustained.png' });
  await page.locator('[data-command=build]').click();
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list [data-part-id="guide-motor"]').click();
  const resetCenters = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
  browserEvidence.assert('ok', [
    resetCenters.every((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1),
    'Build reframes machine',
  ]);
  await page.locator('.placement-settings summary').click();
  const before = (await frame()).metadata.blueprint;
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).fill('0.2');
  await page.getByRole('spinbutton', { name: 'Position Y', exact: true }).press('Tab');
  await page.waitForFunction(
    () =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((p) => p.id === 'guide-motor').position[1] === 0.2,
  );
  const moved = (await frame()).metadata;
  browserEvidence.assert('ok', [
    moved.connections.every((c) => c.reasonCode === 'OK'),
    'moving group preserves joints',
  ]);
  await page.keyboard.press('ControlOrMeta+z');
  browserEvidence.assert('deepEqual', [(await frame()).metadata.blueprint, before]);
  const wire = before.connections.find((c) => c.kind === 'power');
  await page.locator('.port-button[data-port-id=power]').click();
  await page.locator(`[data-disconnect-id="${wire.id}"]`).click();
  browserEvidence.assert('equal', [(await frame()).metadata.blueprint.connections.length, 7]);
  await page.locator('[data-command=undo]').click();
  browserEvidence.assert('deepEqual', [(await frame()).metadata.blueprint, before]);
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assert('deepEqual', [sourceIdentity(), source]);
  browserEvidence.assert('equal', [appFingerprint(), build]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    'artifacts/starter-browser/qualification.json',
    JSON.stringify(
      {
        ...browserEvidence.identity,
        source,
        build,
        browser: browser.version(),
        errors,
        built,
        samples,
        last,
        travel,
        finalTenSecondsSampledTravel: moving,
        finalIntervals,
        checks: [
          'guided ordinary authoring',
          'undo redo',
          'thirty second production-clock travel',
          'connected group transform',
          'keyboard undo',
          'disconnect repair',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `starter browser passed: ${travel.toFixed(3)}m net travel; ${moving.toFixed(3)}m final interval`,
  );
} catch (error) {
  await browserEvidence.captureFailure(error);

  await page.screenshot({ path: 'artifacts/starter-browser/failed.png' }).catch(() => {});
  writeFileSync(
    'artifacts/starter-browser/failure.json',
    JSON.stringify({ source, build, errors, samples, last, message: error.message }, null, 2),
  );
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
