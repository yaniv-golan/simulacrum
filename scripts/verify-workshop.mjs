import { createBrowserEvidence } from './browser-evidence.mjs';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { appFingerprint } from './build-fingerprint.mjs';
import { sourceIdentity } from './source-identity.mjs';
const browserEvidence = createBrowserEvidence();

const source = sourceIdentity(),
  build = appFingerprint(),
  errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('requestfailed', (r) => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  const served = await page.locator('meta[name=build-id]').getAttribute('content');
  assert.equal(served, build, 'served build must match source');
  assert.equal(
    await page.locator('[data-part-type="logicController"]').count(),
    0,
    'a controller with no player execution surface must not be offered as usable',
  );
  for (const type of ['powerCell', 'poweredMotor', 'gripWheel']) {
    await page.locator(`[data-part-type="${type}"]`).click();
    await page.waitForFunction(
      (n) => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === n,
      ['powerCell', 'poweredMotor', 'gripWheel'].indexOf(type) + 1,
    );
    assert.equal(
      await page.locator('.part-list .selected').textContent(),
      { powerCell: 'Power Cell', poweredMotor: 'Powered Motor', gripWheel: 'Grip Wheel' }[type],
    );
  }
  const bp = await page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
  const id = (type) => bp.parts.find((p) => p.type === type).id;
  async function connect(a, portA, b, portB) {
    if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
      await page.locator('.machine-picker > summary').click();
    await page.locator(`.part-list [data-part-id="${a}"]`).click();
    await page.locator(`.port-button[data-part-id="${a}"][data-port-id="${portA}"]`).click();
    await page.locator(`[data-target-part-id="${b}"][data-target-port-id="${portB}"]`).click();
  }
  await connect(id('powerCell'), 'power', id('poweredMotor'), 'power');
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.connections.length === 1,
  );
  assert.equal(
    await page
      .locator(`.port-button[data-part-id="${id('powerCell')}"][data-port-id="power"]`)
      .getAttribute('data-connection-count'),
    '1',
    'fanout ports still show their connections',
  );
  assert.deepEqual(
    await page.evaluate(() =>
      window.workshopProbe.observe().frames[0].metadata.blueprint.parts.map((p) => p.position),
    ),
    bp.parts.map((p) => p.position),
    'wiring must not snap parts',
  );
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.part-list .selected').count(), 0);
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator(`.part-list [data-part-id="${id('powerCell')}"]`).click();
  await page.locator('[data-command="clear-selection"]').click();
  assert.equal(await page.locator('.part-list .selected').count(), 0);
  await connect(id('poweredMotor'), 'shaft', id('gripWheel'), 'axle');
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.connections.length === 2,
  );
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => window.workshopProbe.observe().cursor.tick >= 120);
  await page.locator('[data-command=pause]').click();
  const state = await page.evaluate(() => ({
    observation: window.workshopProbe.observe(),
    transforms: window.workshopProbe.readRenderedTransforms(),
    text: JSON.parse(window.render_game_to_text()),
    metrics: window.workshopProbe.metrics(),
  }));
  mkdirSync('artifacts/browser-workshop', { recursive: true });
  await page.screenshot({ path: 'artifacts/browser-workshop/workshop.png' });
  browserEvidence.assertUnchanged();
  writeFileSync(
    'artifacts/browser-workshop/attempt.json',
    JSON.stringify(
      { source, build, served, browser: browser.version(), errors, ...state },
      null,
      2,
    ) + '\n',
  );
  assert.equal(state.observation.frames[0].status, 'ready');
  assert.equal(state.observation.frames[0].metadata.mode, 'paused');
  assert.ok(state.observation.frames[0].power.cells[0].energyJ < 36000);
  assert.ok(
    Math.abs(
      state.observation.frames[0].physics[bp.parts.findIndex((p) => p.type === 'gripWheel')]
        .angularVelocity[0],
    ) > 0.01,
  );
  for (const [i, p] of bp.parts.entries()) {
    const rendered = state.transforms.find((t) => t.id === p.id);
    assert.deepEqual(rendered.position, state.observation.frames[0].physics[i].position);
    assert.deepEqual(rendered.rotation, state.observation.frames[0].physics[i].rotation);
  }
  assert.deepEqual(state.text, state.observation.frames[0]);
  assert.deepEqual(errors, []);
  // Keyboard control must travel through a placed receiver and its signal wire.
  await page.locator('[data-command=build]').click();
  await page.locator('.more-parts summary').click();
  await page.locator('[data-part-type=commandReceiver]').click();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 4,
  );
  const receiver = await page.evaluate(
    () =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((p) => p.type === 'commandReceiver').id,
  );
  await connect(receiver, 'signal', id('poweredMotor'), 'signal');
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.connections.length === 3,
  );
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => window.workshopProbe.observe().cursor.tick >= 2);
  assert.equal(
    await page.evaluate(() => window.workshopProbe.observe().frames[0].power.motors[0].torque),
    0,
  );
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].power.motors[0].torque > 0,
  );
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].power.motors[0].torque === 0,
  );
  await page.locator('[data-command=pause]').click();
  const saved = await page.evaluate(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint,
  );
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs('artifacts/browser-workshop/saved-machine.json');
  await page.locator('[data-command=new]').click();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 0,
  );
  await page
    .locator('input[type=file]')
    .setInputFiles('artifacts/browser-workshop/saved-machine.json');
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 4,
  );
  assert.deepEqual(
    await page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint),
    saved,
  );
  writeFileSync('artifacts/browser-workshop/future-save.json', JSON.stringify({ version: 999 }));
  await page
    .locator('input[type=file]')
    .setInputFiles('artifacts/browser-workshop/future-save.json');
  await page.waitForFunction(() =>
    document.querySelector('.status-message').textContent.includes('newer'),
  );
  assert.deepEqual(
    await page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint),
    saved,
  );
  // Rejected file diagnostics retain an authored name and field path, while the
  // current machine and private invalid value stay out of the displayed result.
  const invalidSave = structuredClone(saved),
    invalidMotorIndex = invalidSave.parts.findIndex((part) => part.type === 'poweredMotor');
  invalidSave.parts[invalidMotorIndex].name = 'Left drive';
  invalidSave.parts[invalidMotorIndex].parameters.defaultDuty = 'private invalid value';
  writeFileSync('artifacts/browser-workshop/invalid-field.json', JSON.stringify(invalidSave));
  await page
    .locator('input[type=file]')
    .setInputFiles('artifacts/browser-workshop/invalid-field.json');
  const invalidPath = `/parts/${invalidMotorIndex}/parameters/defaultDuty`;
  await page.waitForFunction(
    (path) => document.querySelector('.status-message').textContent.includes(path),
    invalidPath,
  );
  const invalidMessage = await page.locator('.status-message').innerText();
  assert.match(invalidMessage, /Left drive/);
  assert.match(invalidMessage, /Drive setting/);
  assert.doesNotMatch(invalidMessage, /private invalid value/);
  assert.deepEqual(
    await page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint),
    saved,
  );
  // Explicit wrong-input control: a hidden synthetic Run cannot become a
  // successful timed sample or disappear from the first-tick attempt ledger.
  const beforeNegative = await page.evaluate(() => window.workshopProbe.metrics().length);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.querySelector('[data-command=run]').click();
  });
  await page.waitForFunction((n) => window.workshopProbe.metrics().length >= n + 2, beforeNegative);
  const negative = await page.evaluate(
    (n) => window.workshopProbe.metrics().slice(n),
    beforeNegative,
  );
  assert.equal(negative.find((m) => m.kind === 'run-first-tick').outcome, 'cancelled');
  assert.equal(negative.find((m) => m.kind === 'run-first-tick').cause, 'hidden');
  assert.ok(negative.every((m) => m.timestampSource === 'callback' && m.durationMs === null));
  await page.evaluate(() => {
    delete document.hidden;
  });
  writeFileSync(
    'artifacts/browser-workshop/instrumentation-negative.json',
    JSON.stringify(negative, null, 2) + '\n',
  );
  assert.deepEqual(errors, []);
  assert.equal(appFingerprint(), build);

  mkdirSync('artifacts/browser-workshop', { recursive: true });
  await page.screenshot({ path: 'artifacts/browser-workshop/workshop.png' });
  browserEvidence.assertUnchanged();
  writeFileSync(
    'artifacts/browser-workshop/smoke.json',
    JSON.stringify(
      { source, build, served, browser: browser.version(), errors, ...state },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify({ build, tick: state.observation.cursor.tick, errors, metrics: state.metrics }),
  );
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
