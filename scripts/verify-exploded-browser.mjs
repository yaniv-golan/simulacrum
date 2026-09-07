import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;
page.setDefaultTimeout(6000);

const out = 'artifacts/exploded-view';
mkdirSync(out, { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  const read = () =>
    page.evaluate(() => ({
      frame: window.workshopProbe.observe().frames[0],
      poses: window.workshopProbe.readRenderedTransforms(),
    }));
  const before = await read();
  await page.locator('.recording-panel summary').click();
  await page.locator('[data-command=record-session]').click();
  const entry = await page.evaluate(() => {
    const before = window.workshopProbe.readRenderedCenters();
    document.querySelector('[data-command=explode-view]').click();
    return { before, after: window.workshopProbe.readRenderedCenters() };
  });
  for (let i = 0; i < entry.before.length; i++)
    for (const axis of ['x', 'y'])
      browserEvidence.assert('ok', [
        Math.abs(entry.before[i][axis] - entry.after[i][axis]) < 1e-6,
        'entering exploded view must not jump the camera',
      ]);
  await page.waitForTimeout(180);
  await page.screenshot({ path: `${out}/transition-midpoint.png` });
  await page.waitForTimeout(520);
  browserEvidence.assert('equal', [await page.locator('.inspection-banner').isVisible(), true]);
  browserEvidence.assert('deepEqual', [
    (await read()).frame,
    before.frame,
    'inspection cannot alter telemetry',
  ]);
  browserEvidence.assert('notDeepEqual', [
    (await read()).poses,
    before.poses,
    'rendered read model must report displayed exploded poses',
  ]);
  await page.locator('.trace-connection').filter({ hasText: /Shaft/ }).click();
  browserEvidence.assert('match', [
    await page.locator('.trace-description').textContent(),
    /transmits rotation/,
  ]);
  await page.screenshot({ path: `${out}/shaft-trace.png` });
  await page.locator('[data-command=record-session]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-command=export-session]').click();
  const capture = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  const trace = capture.events.find((e) => e.kind === 'trace-connection');
  browserEvidence.assert('ok', [trace.context.ui.explodedView.active]);
  browserEvidence.assert('equal', [trace.context.ui.explodedView.amount, 1]);
  browserEvidence.assert('ok', [
    trace.context.ui.explodedView.displayOffsets.some((p) => p.offset.some((v) => v !== 0)),
  ]);
  browserEvidence.assert('equal', [trace.context.ui.explodedView.tracedConnection, trace.data.id]);
  await page.keyboard.press('ArrowRight');
  browserEvidence.assert('deepEqual', [
    (await read()).frame,
    before.frame,
    'inspection arrows do not edit',
  ]);
  await page.keyboard.press('Escape');
  browserEvidence.assert('equal', [await page.locator('.part-list-item.selected').count(), 0]);
  browserEvidence.assert('equal', [await page.locator('.inspection-banner').isVisible(), true]);
  const exit = await page.evaluate(() => {
    const before = window.workshopProbe.readRenderedCenters();
    document.querySelector('[data-command=explode-view]').click();
    return { before, after: window.workshopProbe.readRenderedCenters() };
  });
  for (let i = 0; i < exit.before.length; i++)
    for (const axis of ['x', 'y'])
      browserEvidence.assert('ok', [
        Math.abs(exit.before[i][axis] - exit.after[i][axis]) < 1e-6,
        'returning to assembly must not jump the camera',
      ]);
  await page.waitForTimeout(700);
  browserEvidence.assert('deepEqual', [await read(), before]);
  browserEvidence.assert('equal', [await page.locator('.inspection-banner').isVisible(), false]);
  await page.locator('[data-command=explode-view]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-command=run]').click();
  await page.waitForTimeout(250);
  browserEvidence.assert('equal', [await page.locator('.inspection-banner').isVisible(), false]);
  browserEvidence.assert('ok', [(await read()).frame.tick > 0]);
  await page.locator('[data-command=pause]').click();
  await page.locator('[data-command=build]').click();
  browserEvidence.assert('deepEqual', [
    (await read()).frame.metadata.blueprint,
    before.frame.metadata.blueprint,
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        errors,
        checks: [
          'inspection preserves telemetry and reports displayed poses',
          'shaft explanation and recorded display context',
          'inspection edit guard',
          'deselect',
          'exact assembly restore',
          'Run restores assembly before ticks',
        ],
      },
      null,
      2,
    ),
  );
  console.log('exploded-view browser checks passed');
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
