import { browserArtifactPath } from './browser-artifacts.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { createBallDrop } from '../src/model/fixtures/ball-drop.mjs';
import { createSpringLauncher } from '../src/model/fixtures/spring-launcher.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/ball-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'focus' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => !!window.workshopProbe);
  const bp = createEmptyBlueprint('ball-edit', 'Ball edit');
  bp.parts.push(createPart('ball', 'ball', [0, 0.3, 0]));
  writeFileSync(`${out}/ball.json`, JSON.stringify(bp));
  await evidence.loadAndWait(page, `${out}/ball.json`);
  await evidence.clickPart(page, 'ball');
  await page.getByRole('spinbutton', { name: 'Ball diameter (mm)', exact: true }).fill('120');
  await page.getByRole('spinbutton', { name: 'Ball diameter (mm)', exact: true }).press('Tab');
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts[0].parameters.diameter ===
      0.12,
  );
  await page.getByText('Engineering details', { exact: true }).click();
  await page.getByText('Contact settings', { exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Bounciness source', exact: true })
    .selectOption('custom');
  await page.getByRole('spinbutton', { name: 'Bounciness', exact: true }).fill('0.73');
  await page.getByRole('spinbutton', { name: 'Bounciness', exact: true }).press('Tab');
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts[0].authoredContact?.body
        ?.restitution === 0.73,
  );
  await page.getByRole('combobox', { name: 'Material', exact: true }).selectOption('steel');
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts[0].authoredMaterial.body ===
      'steel',
  );
  assert.equal(
    await page.getByRole('spinbutton', { name: 'Bounciness', exact: true }).inputValue(),
    '0.73',
  );
  await page
    .getByRole('combobox', { name: 'Bounciness source', exact: true })
    .selectOption('default');
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).metadata.blueprint.parts[0].authoredContact,
  );
  const shape = await page.evaluate(() =>
    window.workshopProbe.readRenderedShapes().find((s) => s.id === 'ball'),
  );
  for (const diameter of shape.size)
    assert.ok(Math.abs(diameter - 0.12) < 1e-7, 'rendered radius matches authored sphere');
  await page.screenshot({ path: `${out}/settings.png` });
  writeFileSync(`${out}/launcher.json`, JSON.stringify(createSpringLauncher()));
  await evidence.loadAndWait(page, `${out}/launcher.json`);
  await evidence.clickPart(page, 'projectile');
  await page.getByRole('checkbox', { name: 'Follow motion', exact: true }).uncheck();
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(2000));
  await page.keyboard.down('l');
  await page.evaluate(() => window.advanceTime(1000));
  await page.keyboard.up('l');
  await page.screenshot({ path: `${out}/launched.png` });
  const before = await page.evaluate(() => ({
    cursor: window.workshopProbe.observe().cursor,
    frame: JSON.parse(window.render_game_to_text()),
    ui: window.workshopProbe.readInteractionState(),
  }));
  await page.keyboard.down('l');
  const retryStarted = performance.now();
  await page.locator('[data-command=retry]').click();
  await page.waitForFunction(
    (epoch) =>
      window.workshopProbe.observe().cursor.epoch > epoch &&
      JSON.parse(window.render_game_to_text()).metadata.mode === 'run',
    before.cursor.epoch,
  );
  const retryMs = performance.now() - retryStarted;
  // Auto-repeat of the key held through reset must not open the fresh gate.
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyL', key: 'l', repeat: true, bubbles: true }),
    ),
  );
  await page.evaluate(() => window.advanceTime(200));
  const releaseDuty = await page.evaluate(() => {
    const f = JSON.parse(window.render_game_to_text());
    const i = f.metadata.blueprint.parts.findIndex((p) => p.id === 'release');
    return f.power.sources.find((s) => s.node === i)?.duty ?? 0;
  });
  assert.equal(releaseDuty, 0, 'retry requires a fresh release-key press');
  await page.keyboard.up('l');
  await page.locator('[data-command=pause]').click();
  const after = await page.evaluate(() => ({
    frame: JSON.parse(window.render_game_to_text()),
    ui: window.workshopProbe.readInteractionState(),
  }));
  assert.deepEqual(after.frame.metadata.blueprint, before.frame.metadata.blueprint);
  assert.deepEqual(after.ui.camera, before.ui.camera);
  assert.equal(after.ui.selected, before.ui.selected);
  assert.deepEqual(after.frame.metadata.editing, before.frame.metadata.editing);
  await page.screenshot({ path: `${out}/retry.png` });
  await page.setViewportSize({ width: 900, height: 650 });
  await page.screenshot({ path: `${out}/narrow.png` });
  const sound = page.getByRole('button', { name: 'Sound off', exact: true });
  await sound.click();
  await page.getByRole('button', { name: 'Sound on', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Sound on', exact: true }).click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  await page.locator('[data-command=build]').click();
  writeFileSync(`${out}/drop.json`, JSON.stringify(createBallDrop()));
  await evidence.loadAndWait(page, `${out}/drop.json`);
  await page.evaluate(() => {
    window.impactVoiceStarts = 0;
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.impactVoiceStarts++;
      return original.apply(this, args);
    };
  });
  await sound.click();
  await page.getByRole('button', { name: 'Sound on', exact: true }).waitFor();
  await page.locator('[data-command=run]').click();
  // Drive the sound phases in frame-sized batches, as animation frames do for a player.
  // The audio engine voices only impacts within 0.1 s of a batch's newest tick and skips
  // a batch after a >100 ms wall-clock gap, so one 500 ms jump would voice nothing.
  // 1000/60 ms is exactly two ticks; totals stay 60, 120 and 180 ticks.
  const advanceFrames = (count) =>
    page.evaluate((n) => {
      for (let i = 0; i < n; i++) window.advanceTime(1000 / 60);
    }, count);
  await advanceFrames(30);
  const rolling = await page.evaluate(() => {
    const frame = JSON.parse(window.render_game_to_text());
    return {
      body: frame.physics[frame.metadata.blueprint.parts.findIndex((p) => p.id === 'ball')],
      mesh: window.workshopProbe.readRenderedTransforms().find((s) => s.id === 'ball'),
      shape: window.workshopProbe.readRenderedShapes().find((s) => s.id === 'ball'),
    };
  });
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(rolling.body.position[i] - rolling.mesh.position[i]) < 1e-7);
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(rolling.body.rotation[i] - rolling.mesh.rotation[i]) < 1e-7);
  }
  // q and -q represent the same orientation after matrix decomposition.
  assert.ok(
    Math.abs(
      Math.abs(
        rolling.body.rotation.reduce((dot, v, i) => dot + v * rolling.shape.markRotation[i], 0),
      ) - 1,
    ) < 1e-7,
  );
  assert.ok(Math.abs(rolling.body.rotation[3]) < 0.999, 'rotation marking follows actual rolling');
  assert.equal(rolling.shape.markVisible, true);
  await advanceFrames(60);
  await page.locator('[data-command=pause]').click();
  const voices = await page.evaluate(() => window.impactVoiceStarts);
  assert.ok(voices > 0, 'completed impacts must produce sound when enabled');
  await page.getByRole('button', { name: 'Sound on', exact: true }).click();
  await page.locator('[data-command=retry]').click();
  await advanceFrames(90);
  await page.locator('[data-command=pause]').click();
  assert.equal(
    await page.evaluate(() => window.impactVoiceStarts),
    voices,
    'muted retry stays silent',
  );
  const drop = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal(drop.metadata.blueprint.parts.find((p) => p.id === 'ball').type, 'ball');
  await page.screenshot({ path: `${out}/drop.png` });
  await page.locator('[data-command=build]').click();
  await evidence.loadAndWait(page, `${out}/ball.json`);
  await evidence.clickPart(page, 'ball');
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(0));
  // Apply bounded test-only frame pressure to the real adaptive owner. This is
  // a visual check, not a real-time performance measurement.
  await page.evaluate(
    (budgetMs) =>
      new Promise((resolve, reject) => {
        const deadline = performance.now() + budgetMs;
        function pressure() {
          if (window.workshopProbe.readInteractionState().rendering.quality.level === 5)
            return resolve();
          if (performance.now() > deadline)
            return reject(Error('minimum quality was not exercised'));
          window.advanceTime(0);
          const end = performance.now() + 40;
          while (performance.now() < end) {}
          requestAnimationFrame(pressure);
        }
        requestAnimationFrame(pressure);
      }),
    evidence.waitBudget(45000),
  );
  assert.equal(
    await page.evaluate(
      () => window.workshopProbe.readRenderedShapes().find((s) => s.id === 'ball').markVisible,
    ),
    true,
  );
  await page.screenshot({ path: `${out}/minimum-quality.png` });
  await page.locator('[data-command=pause]').click();
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, retryMs, errors: evidence.errors }),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
