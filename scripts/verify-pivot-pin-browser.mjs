import { browserArtifactPath } from './browser-artifacts.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence, uploadWorkshopFile } from './browser-evidence.mjs';
import { liveWait } from './browser-idle.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';
import { rotateVector } from '../src/model/transforms.mjs';
// Pivot pin: a pinned link swings in Run with rendered/simulated agreement, the inspector
// names the pin, a parallelogram closes through the surface-mount UI only when coincident,
// a joint angle sensor binds to the pivot, and the machine survives save/reload.
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/pivot-pin-browser');
mkdirSync(out, { recursive: true });
const mount = (bp, spec) => proposeSurfaceMount(bp, spec).blueprint;
function pinnedPair() {
  // Beam A stands on its end so the pin axis is horizontal and beam B hangs as a pendulum.
  let bp = createEmptyBlueprint('pinned', 'Pinned');
  bp.parts = [
    createPart('chassis', 'base', [0, 0.02, 0]),
    createPart('beam', 'beamA', [0, 1, 0]),
    createPart('pivotPin', 'pin', [0, 2, 0]),
    createPart('beam', 'beamB', [0, 3, 0]),
    createPart('jointAngleSensor', 'sensor', [0.5, 0.2, 0.2]),
    createPart('powerCell', 'cell', [-0.5, 0.2, 0.2]),
  ];
  const step = (spec) => (bp = mount(bp, spec));
  step({
    part: 'beamA',
    sourceRegion: 'left',
    targetPart: 'base',
    targetRegion: 'top',
    u: 0,
    v: 0,
    twist: 0,
    id: 'ground',
  });
  // Head under beam B first, then the pin's foot onto the standing beam moves beam B with it.
  step({
    part: 'pin',
    sourceRegion: 'top',
    targetPart: 'beamB',
    targetRegion: 'bottom',
    u: 0.1,
    v: 0,
    twist: 0,
    id: 'head',
  });
  step({
    part: 'pin',
    sourceRegion: 'bottom',
    targetPart: 'beamA',
    targetRegion: 'top',
    u: 0.19,
    v: 0,
    twist: 0,
    id: 'foot',
  });
  bp.connections.push({
    id: 'pw',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'sensor', port: 'power' },
  });
  return bp;
}
function openParallelogram() {
  let bp = createEmptyBlueprint('four-bar', 'Four-bar');
  bp.parts = [
    createPart('chassis', 'ground', [0, 0.02, 0]),
    createPart('poweredHinge', 'hingeA', [2, 1, 0]),
    createPart('poweredHinge', 'hingeB', [3, 1, 0]),
    createPart('shaftMount', 'mountA', [4, 1, 0]),
    createPart('shaftMount', 'mountB', [5, 1, 0]),
    createPart('beam', 'crank', [6, 1, 0]),
    createPart('beam', 'rocker', [7, 1, 0]),
    createPart('pivotPin', 'pinA', [8, 1, 0]),
    createPart('pivotPin', 'pinB', [9, 1, 0]),
    createPart('beam', 'coupler', [10, 1, 0]),
  ];
  const p = (id) => bp.parts.find((x) => x.id === id);
  p('crank').parameters.length = 0.2;
  p('rocker').parameters.length = 0.2;
  p('coupler').parameters.length = 0.8;
  p('hingeB').parameters.lowerLimit = -3;
  p('hingeB').parameters.upperLimit = 3;
  bp = mount(bp, {
    part: 'hingeA',
    sourceRegion: 'bottom',
    targetPart: 'ground',
    targetRegion: 'top',
    u: 0,
    v: -0.17,
    twist: 0,
    id: 'hA',
  });
  bp = mount(bp, {
    part: 'hingeB',
    sourceRegion: 'bottom',
    targetPart: 'ground',
    targetRegion: 'top',
    u: 0,
    v: 0.17,
    twist: 0,
    id: 'hB',
  });
  bp = mount(bp, {
    part: 'mountA',
    sourceRegion: 'right',
    targetPart: 'crank',
    targetRegion: 'bottom',
    u: -0.08,
    v: 0,
    twist: 0,
    id: 'mA',
  });
  bp = mount(bp, {
    part: 'mountB',
    sourceRegion: 'right',
    targetPart: 'rocker',
    targetRegion: 'bottom',
    u: -0.08,
    v: 0,
    twist: 0,
    id: 'mB',
  });
  for (const [id, a, b] of [
    ['sA', { part: 'hingeA', port: 'shaft' }, { part: 'mountA', port: 'shaft' }],
    ['sB', { part: 'hingeB', port: 'shaft' }, { part: 'mountB', port: 'shaft' }],
  ]) {
    bp = snapConnection(bp, a, b);
    bp.connections.push({ id, kind: 'shaft', a, b });
  }
  bp = mount(bp, {
    part: 'pinA',
    sourceRegion: 'bottom',
    targetPart: 'crank',
    targetRegion: 'top',
    u: 0.08,
    v: 0,
    twist: 0,
    id: 'fA',
  });
  bp = mount(bp, {
    part: 'pinB',
    sourceRegion: 'bottom',
    targetPart: 'rocker',
    targetRegion: 'top',
    u: 0.08,
    v: 0,
    twist: 0,
    id: 'fB',
  });
  bp = mount(bp, {
    part: 'coupler',
    sourceRegion: 'bottom',
    targetPart: 'pinA',
    targetRegion: 'top',
    u: 0,
    v: 0,
    twist: 0,
    id: 'cA',
  });
  return bp;
}
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const frame = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function select(id) {
  if (!(await page.locator('.machine-picker').evaluate((e) => e.open)))
    await page.locator('.machine-picker > summary').click();
  await page.locator(`.part-list [data-part-id="${id}"]`).click();
}
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => !!window.workshopProbe);
  writeFileSync(`${out}/pinned.json`, JSON.stringify(pinnedPair()));
  await uploadWorkshopFile(page, `${out}/pinned.json`);
  await select('pin');
  await liveWait(page, () => /Pinned/.test(document.body.innerText), undefined, {
    label: 'inspector names the pin',
  });
  assert.doesNotMatch(
    await page.locator('.inspector').innerText(),
    /Unattached/,
    'a pinned pin is not unattached',
  );
  await page.screenshot({ path: `${out}/build.png` });
  // Bind the joint angle sensor to the pivot edge through the ordinary sensor inspector.
  await select('sensor');
  await page.getByLabel('Measured axle connection').selectOption('head');
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === 'sensor',
      ).jointBinding === 'head',
    undefined,
    { label: 'sensor binds to the pivot' },
  );
  // Run: beam B swings about the pin; rendered and simulated transforms agree.
  const before = await frame();
  await page.locator('[data-command=run]').click();
  await page.evaluate(() => window.advanceTime(1500));
  await liveWait(page, () => JSON.parse(window.render_game_to_text()).tick >= 180, undefined, {
    label: 'run reaches tick 180',
  });
  const after = await frame();
  const index = after.metadata.blueprint.parts.findIndex((p) => p.id === 'beamB');
  const yaw = (f) => {
    const a = rotateVector(f.physics[index].rotation, [1, 0, 0]);
    return Math.atan2(a[2], a[0]);
  };
  assert.ok(Math.abs(yaw(after) - yaw(before)) > 0.05, 'the pinned link swung');
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  const beamB = rendered.find((r) => r.id === 'beamB');
  for (let k = 0; k < 3; k++)
    assert.ok(
      Math.abs(beamB.position[k] - after.physics[index].position[k]) < 1e-6,
      'rendered position matches simulated',
    );
  const reading = after.power.sensors.find((s) => s.kind === 'jointAngle');
  assert.equal(reading.channels.angle.status, 'valid', 'joint angle reads on a pivot');
  await page.screenshot({ path: `${out}/swing.png` });
  await page.locator('[data-command=pause]').click();
  await page.locator('[data-command=build]').click();
  // Undo the sensor binding through ordinary history.
  await page.locator('[data-command=undo]').click();
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.find(
        (p) => p.id === 'sensor',
      ).jointBinding === undefined,
    undefined,
    { label: 'undo removes the binding' },
  );
  await page.locator('[data-command=redo]').click();
  // Close a parallelogram through the surface-mount UI: pin B's head onto the coupler.
  writeFileSync(`${out}/open.json`, JSON.stringify(openParallelogram()));
  await uploadWorkshopFile(page, `${out}/open.json`);
  await select('pinB');
  const openState = await frame();
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page.locator('.surface-precise summary').click();
  await page.getByLabel('Mounting face').selectOption('top');
  await page.getByLabel('Target surface').selectOption(JSON.stringify(['coupler', 'bottom']));
  await page.getByLabel('Along surface (mm)').fill('342');
  await liveWait(
    page,
    () =>
      /does not fit|loop|already/i.test(
        document.querySelector('.surface-placement [role=status]')?.textContent ?? '',
      ),
    undefined,
    {
      label: 'off-by-2 mm closure explains itself',
    },
  );
  assert.equal(
    await page.locator('[data-command=apply-surface]').isDisabled(),
    true,
    'a non-coincident loop cannot be applied',
  );
  await page.screenshot({ path: `${out}/closure-refused.png` });
  await page.getByLabel('Along surface (mm)').fill('340');
  await liveWait(
    page,
    () => !document.querySelector('[data-command=apply-surface]')?.disabled,
    undefined,
    { label: 'coincident closure is applicable' },
  );
  await page.locator('[data-command=apply-surface]').click();
  await liveWait(
    page,
    () =>
      JSON.parse(window.render_game_to_text()).metadata.blueprint.connections.some(
        (c) => c.kind === 'pivot' && c.a.part === 'coupler',
      ),
    undefined,
    { label: 'closure recorded as a pivot' },
  );
  const closed = await frame();
  assert.deepEqual(
    closed.metadata.blueprint.parts,
    openState.metadata.blueprint.parts,
    'closure moved nothing',
  );
  assert.ok(
    closed.metadata.connections.every((c) => c.reasonCode === 'OK'),
    JSON.stringify(closed.metadata.connections),
  );
  await page.screenshot({ path: `${out}/closed.png` });
  // Save and reload keeps every pivot.
  const saved = await page.evaluate(() =>
    JSON.stringify(window.workshopProbe.observe().frames[0].metadata.blueprint),
  );
  writeFileSync(`${out}/closed.json`, saved);
  await uploadWorkshopFile(page, `${out}/closed.json`);
  const reloaded = await frame();
  assert.equal(reloaded.metadata.blueprint.connections.filter((c) => c.kind === 'pivot').length, 2);
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
