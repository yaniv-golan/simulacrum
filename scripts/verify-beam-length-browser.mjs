import { browserArtifactPath } from './browser-artifacts.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { liveWait } from './browser-idle.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { proposeSurfaceMount } from '../src/model/assembly.mjs';
// Beam length: one inspector control, live preview, obstruction and end-mount rejections,
// and a lap joint across another beam through the section-sized pad.
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/beam-length-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const readPart = (id) =>
  page.evaluate(
    (partId) =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === partId,
      ),
    id,
  );
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => !!window.workshopProbe);
  const bp = createEmptyBlueprint('beam-length', 'Beam length');
  bp.parts.push(createPart('beam', 'beam', [0, 0.3, 0]));
  bp.parts.push(createPart('beam', 'wall', [0.6, 0.3, 0]));
  writeFileSync(`${out}/beam.json`, JSON.stringify(bp));
  await evidence.loadAndWait(page, `${out}/beam.json`);
  await evidence.clickPart(page, 'beam');
  const length = page.getByRole('spinbutton', { name: 'Beam length (mm)', exact: true });
  assert.equal(await length.count(), 1, 'exactly one Length control');
  assert.equal(await page.getByRole('spinbutton', { name: /length/i }).count(), 1);
  assert.equal(await length.inputValue(), '400');
  const slider = page.getByRole('slider', { name: 'Beam length', exact: true });
  assert.equal(await slider.getAttribute('step'), '10', 'slider moves in 10 mm steps');
  await slider.fill('600');
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts[0].parameters.length ===
      0.6,
    undefined,
    { label: 'slider commits 600 mm' },
  );
  await length.fill('700');
  await length.press('Tab');
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts[0].parameters.length ===
      0.7,
    undefined,
    { label: 'number commits 700 mm' },
  );
  const shape = await page.evaluate(() =>
    window.workshopProbe.readRenderedShapes().find((s) => s.id === 'beam'),
  );
  assert.ok(Math.abs(Math.max(...shape.size) - 0.7) < 1e-6, 'rendered length matches authored');
  const mass = await page.locator('.part-mass').first().textContent();
  assert.match(mass ?? '', /^3\.02 kg/, 'inspector mass follows length × section × density');
  await page.screenshot({ path: `${out}/resized.png` });
  // Too long: the preview names the obstruction and the value is not applied.
  await length.fill('1000');
  await length.press('Tab');
  await liveWait(
    page,
    () =>
      /overlaps/.test(
        document.querySelector('.primary-setting .parameter-help')?.textContent ?? '',
      ),
    undefined,
    { label: 'obstruction copy shown' },
  );
  assert.equal((await readPart('beam')).parameters.length, 0.7);
  await length.press('Escape');
  // Lap a third beam across the resized one through the 40 mm pad.
  const resized = structuredClone(bp);
  resized.parts[0].parameters.length = 0.7;
  const crossed = proposeSurfaceMount(resized, {
    part: 'cross',
    sourceRegion: 'bottom',
    targetPart: 'beam',
    targetRegion: 'top',
    u: 0.2,
    v: 0,
    twist: Math.PI / 2,
    id: 'lap',
    insertPart: createPart('beam', 'cross', [0, 1, 0]),
  }).blueprint;
  writeFileSync(`${out}/crossed.json`, JSON.stringify(crossed));
  await evidence.loadAndWait(page, `${out}/crossed.json`);
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).metadata.connections.every(
        (c) => c.reasonCode === 'OK',
      ),
    undefined,
    { label: 'lap joint compiles OK' },
  );
  // A part on the end face blocks resizing with the player copy, atomically.
  const capped = structuredClone(crossed);
  capped.parts.push(createPart('spacerBlock', 'cap', [1, 0.3, 0]));
  const withCap = proposeSurfaceMount(capped, {
    part: 'cap',
    sourceRegion: 'left',
    targetPart: 'beam',
    targetRegion: 'right',
    u: 0,
    v: 0,
    twist: 0,
    id: 'end',
  }).blueprint;
  writeFileSync(`${out}/capped.json`, JSON.stringify(withCap));
  await evidence.loadAndWait(page, `${out}/capped.json`);
  await evidence.clickPart(page, 'beam');
  const before = await page.evaluate(() => JSON.parse(window.render_game_to_text()).metadata);
  await length.fill('500');
  await length.press('Tab');
  await liveWait(
    page,
    () =>
      /Detach/.test(
        document.querySelector('.primary-setting .parameter-help')?.textContent ?? '',
      ),
    undefined,
    { label: 'detach copy shown' },
  );
  const after = await page.evaluate(() => JSON.parse(window.render_game_to_text()).metadata);
  assert.deepEqual(after.blueprint, before.blueprint, 'rejected resize changes nothing');
  assert.deepEqual(after.editing, before.editing, 'rejected resize leaves history alone');
  await page.screenshot({ path: `${out}/end-mount-rejected.png` });
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, errors: evidence.errors }),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
