import { createBrowserEvidence } from './browser-evidence.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const browserEvidence = createBrowserEvidence();

const out = 'artifacts/snap-intent';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = [];
page.setDefaultTimeout(6000);
page.on('pageerror', (e) => errors.push(e.message));
page.on('requestfailed', (r) => errors.push(r.url()));
const read = () => page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
async function select(id) {
  if (!(await page.locator('.machine-picker').evaluate((e) => e.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator(`.part-list [data-part-id="${id}"]`).click();
}
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.locator('.more-parts > summary').click();
  await page.locator('[data-part-type=chassis]').click();
  await page.locator('[data-part-type=commandReceiver]').click();
  await page.locator('[data-part-type=powerCell]').click();
  const before = await read(),
    receiver = before.parts.find((p) => p.type === 'commandReceiver'),
    chassis = before.parts.find((p) => p.type === 'chassis');
  assert.ok(receiver && chassis);
  await select(receiver.id);
  assert.equal(await page.locator('.port-button[data-port-id=mount]').count(), 0);
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  const panel = page.locator('.surface-placement');
  await panel
    .getByRole('combobox', { name: 'Target surface', exact: true })
    .selectOption({ label: `${chassis.name} · Top` });
  assert.equal(
    await panel.getByRole('button', { name: 'Attach', exact: true }).isEnabled(),
    true,
    'ordinary chassis top accepts receiver bottom',
  );
  assert.match(await panel.getByRole('status').innerText(), /Command Receiver.*Chassis/);
  assert.deepEqual(await read(), before, 'preview must not mutate blueprint');
  await page.screenshot({ path: `${out}/loose-part-preview.png` });
  await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false);
  assert.deepEqual(await read(), before, 'cancel must not mutate blueprint');
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await panel
    .getByRole('combobox', { name: 'Target surface', exact: true })
    .selectOption({ label: `${chassis.name} · Top` });
  await panel.locator('.surface-precise > summary').click();
  await panel.getByRole('spinbutton', { name: 'Along surface (mm)', exact: true }).fill('10000');
  assert.equal(
    await panel.getByRole('button', { name: 'Attach', exact: true }).isEnabled(),
    false,
    'out-of-bounds wrong placement must not be attachable',
  );
  assert.match(await panel.getByRole('status').innerText(), /beyond this surface/);
  assert.deepEqual(await read(), before, 'invalid preview must not mutate blueprint');
  await panel.getByRole('spinbutton', { name: 'Along surface (mm)', exact: true }).fill('0');
  assert.equal(
    await panel.getByRole('button', { name: 'Attach', exact: true }).isEnabled(),
    true,
    'returning to a valid position restores attachment',
  );
  await panel.getByRole('button', { name: 'Attach', exact: true }).click();
  const after = await read();
  for (const part of before.parts)
    if (part.id !== receiver.id)
      assert.deepEqual(
        after.parts.find((p) => p.id === part.id),
        part,
        'target and all other machine parts stay in place',
      );
  assert.notDeepEqual(after.parts.find((p) => p.id === receiver.id).position, receiver.position);
  assert.equal(after.connections.length, before.connections.length + 1);
  const edge = after.connections.find((c) => !before.connections.some((old) => old.id === c.id));
  assert.equal(edge.kind, 'fixed');
  assert.equal(edge.a.part, chassis.id);
  assert.equal(edge.b.part, receiver.id);
  assert.ok(edge.a.surface && edge.b.surface, 'mount is authored through surface endpoints');
  assert.equal(edge.a.port, undefined);
  assert.equal(edge.b.port, undefined);
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  await panel.getByRole('button', { name: 'Rotate on surface +90°', exact: true }).click();
  assert.deepEqual(await read(), after, 'adjustment remains preview until apply');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual(await read(), after, 'adjust cancel preserves committed mount');
  await page.locator('[data-command=undo]').click();
  assert.deepEqual(await read(), before, 'undo restores exact pre-mount blueprint');
  assert.deepEqual(errors, []);
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        checks: [
          'surface preview is read only',
          'cancel clears preview',
          'out-of-bounds placement rejected and valid placement recovers',
          'selected part moves while target and others stay fixed',
          'surface endpoints only',
          'adjust cancel preserves mount',
          'undo restores exact blueprint',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('snap intent passed');
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
