import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;

mkdirSync(browserArtifactPath('artifacts/recording-browser'), { recursive: true });
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  const first = await page.locator('[data-command=guide-step]').boundingBox();
  for (let i = 0; i < 16; i++) {
    const box = await page.locator('[data-command=guide-step]').boundingBox();
    browserEvidence.assert('equal', [box.y, first.y, 'guide action must not move between steps']);
    await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
    await page.waitForFunction((n) => {
      const b = window.workshopProbe.observe().frames[0].metadata.blueprint;
      return b.parts.length + b.connections.length === n;
    }, i + 1);
  }
  browserEvidence.assert('equal', [
    await page.evaluate(() => localStorage.getItem('simulacrum.interaction-recording.v1')),
    null,
  ]);
  await page.locator('.recording-panel summary').click();
  await page.locator('[data-command=record-session]').click();
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator('.part-list-item').first().click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('e');
  await page.keyboard.press('Escape');
  await page.locator('[data-command=record-session]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-command=export-session]').click();
  const file = await download;
  const capture = JSON.parse(readFileSync(await file.path(), 'utf8'));
  browserEvidence.assert('equal', [capture.status, 'stopped']);
  browserEvidence.assert('equal', [capture.terminationReason, 'user-stop']);
  browserEvidence.assert('ok', [capture.initialContext.checkpoint]);
  browserEvidence.assert('ok', [
    capture.events.some((e) => e.kind === 'input' && e.data.key === 'ArrowRight'),
  ]);
  browserEvidence.assert('ok', [
    capture.events.some((e) => e.kind === 'command-result' && e.data.result.ok),
  ]);
  browserEvidence.assert('ok', [capture.events.some((e) => e.kind === 'tool')]);
  browserEvidence.assert('ok', [capture.events.some((e) => e.kind === 'selection')]);
  browserEvidence.assert('equal', [
    capture.build,
    await page.locator('meta[name=build-id]').getAttribute('content'),
  ]);
  browserEvidence.assert('ok', [
    capture.events.every((e, i) => e.seq === i + 1 && e.context.cursor),
  ]);
  await page.screenshot({ path: browserArtifactPath('artifacts/recording-browser/recording.png') });
  await browserEvidence.reload(page);
  await page.waitForFunction(() => window.workshopProbe);
  await page.locator('.recording-panel summary').click();
  const second = page.waitForEvent('download');
  await page.locator('[data-command=export-session]').click();
  browserEvidence.assert('deepEqual', [
    JSON.parse(readFileSync(await (await second).path(), 'utf8')),
    capture,
  ]);
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    browserArtifactPath('artifacts/recording-browser/result.json'),
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: capture.build,
        events: capture.events.length,
        errors,
        checks: [
          'stationary guide action across all steps',
          'opt-in only',
          'keys and command results',
          'selection and tools',
          'checkpoint and cursor',
          'export survives reload',
        ],
      },
      null,
      2,
    ),
  );
  console.log('guide and local recording browser passed');
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
