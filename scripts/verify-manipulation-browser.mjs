import { createBrowserEvidence } from './browser-evidence.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('requestfailed', (r) => errors.push(r.url()));
const out = 'artifacts/manipulation-ux';
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
  assert.match(await page.locator('.move-scope').textContent(), /connected assembly · 8 parts/);
  const read = () =>
    page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
  const before = await read();
  await page.locator('canvas').first().focus();
  await page.keyboard.press('ArrowRight');
  const moved = await read();
  const delta = moved.parts[0].position.map((v, i) => v - before.parts[0].position[i]);
  assert.ok(Math.hypot(...delta) > 0.02);
  for (let i = 0; i < moved.parts.length; i++)
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(moved.parts[i].position[axis] - before.parts[i].position[axis] - delta[axis]) <
          1e-9,
      );
  await page.locator('[data-command=undo]').click();
  assert.deepEqual(await read(), before);
  await page.locator('.port-button[data-port-id=power]').click();
  await page.getByRole('button', { name: 'Disconnect Power · Cell', exact: true }).click();
  assert.match(await page.locator('.status-message').textContent(), /Disconnected.*Undo/);
  if (
    (await page.locator('.port-button[data-port-id=power]').getAttribute('aria-expanded')) !==
    'true'
  )
    await page.locator('.port-button[data-port-id=power]').click();
  const target = page.getByRole('button', {
    name: 'Wire Cell · power (parts stay put)',
    exact: true,
  });
  await target.focus();
  assert.equal(await target.evaluate((e) => e.classList.contains('previewing')), true);
  await page.screenshot({ path: `${out}/wire-preview.png` });
  await target.click();
  assert.deepEqual((await read()).parts, before.parts);
  await page.getByRole('button', { name: 'Delete part', exact: true }).click();
  assert.equal((await read()).parts.length, 7);
  assert.match(await page.locator('.status-message').textContent(), /Deleted Motor.*Undo/);
  await page.locator('[data-command=undo]').click();
  assert.equal((await read()).parts.length, 8);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.selection-actions').isVisible(), false);
  assert.match(await page.locator('.selection-hint').textContent(), /Select a part/);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Motor$/ })
    .click();
  await page.screenshot({ path: `${out}/assembly-scope.png` });
  assert.deepEqual(errors, []);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        errors,
        checks: [
          'scope matches all eight physically moved parts',
          'undo restores poses',
          'disconnect and deletion recovery',
          'keyboard connection preview',
          'wiring does not move parts',
          'escape clears selection',
        ],
      },
      null,
      2,
    ),
  );
  console.log('manipulation browser checks passed');
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
