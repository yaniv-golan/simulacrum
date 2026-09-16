import assert from 'node:assert/strict';
import { browseAllParts, placeCatalogPartByName, openTools } from './catalog-browser-actions.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { liveWait } from './browser-idle.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/rope-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
  page = await context.newPage();
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  assert.equal((await read()).metadata.blueprint.parts.length, 0);
  await browseAllParts(page);
  await page.getByRole('button', { name: 'Rope', exact: true }).focus();
  assert.equal(await page.locator('.catalog-summary strong').innerText(), 'Rope');
  assert.equal(await page.locator('.catalog-summary button').isVisible(), false);
  await page.locator('[data-part-type="powerCell"]').focus();
  assert.equal(await page.locator('.catalog-summary strong').innerText(), 'Power Cell');
  assert.equal(await page.locator('.catalog-summary button').isVisible(), true);

  const requestRope = async () => {
    await browseAllParts(page);
    await page.getByRole('searchbox', { name: 'Search all parts' }).fill('rope');
    await page.getByRole('button', { name: 'Rope', exact: true }).click();
  };
  const place = async (name, position) => {
    await placeCatalogPartByName(page, name);
    await page.getByText('Position & rotation', { exact: true }).click();
    for (let i = 0; i < 3; i++) {
      const field = page.getByRole('spinbutton', {
        name: `Position ${['X', 'Y', 'Z'][i]}`,
        exact: true,
      });
      await field.fill(String(position[i]));
      await field.press('Tab');
    }
    const f = await read();
    assert.deepEqual(f.metadata.blueprint.parts.at(-1).position, position);
  };
  await place('Beam', [-0.9, 0.32, 0]);
  await place('Power Cell', [-0.9, 0.05, 0]);
  await place('Power Cell', [-0.9, 0.15, 0]);
  await place('Power Cell', [-0.9, 0.25, 0]);
  await place('Spacer block', [-0.7, 0.055, 0]);
  assert.equal(await page.locator('.rope-controls').count(), 0);
  await requestRope();
  await page.getByRole('combobox', { name: 'End A surface', exact: true }).selectOption('top');
  await page.getByRole('combobox', { name: 'End B surface', exact: true }).selectOption('right');
  await page.getByRole('spinbutton', { name: 'Rope length (m)', exact: true }).fill('.28');
  await page.getByRole('button', { name: 'Attach rope', exact: true }).click();
  assert.equal((await read()).metadata.blueprint.connections.length, 1);
  await page.getByRole('spinbutton', { name: 'Rope length (m)', exact: true }).first().fill('.27');
  await page.getByRole('button', { name: 'Apply rope changes', exact: true }).click();
  assert.equal((await read()).metadata.blueprint.connections[0].rope.restLength, 0.27);
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  const agreement = async () => {
    const f = await read(),
      rendered = await page.evaluate(() => window.workshopProbe.readRenderedRopeEndpoints()),
      nodes = f.metadata.connections.find((c) => c.rope).rope.nodes;
    assert.equal(rendered.length, nodes.length - 1);
    rendered.forEach((r, i) => {
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(r.a[k] - f.physics[nodes[i]].position[k]) < 1e-9);
        assert.ok(Math.abs(r.b[k] - f.physics[nodes[i + 1]].position[k]) < 1e-9);
      }
    });
    return f;
  };
  const initial = await agreement();
  await page.screenshot({ path: `${out}/build.png` });
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 240);
  await page.locator('[data-command=pause]').click();
  const running = await agreement();
  assert.notEqual(running.status, 'failed');
  assert.ok(running.ropes.some((r) => r.appliedTension > 0));
  await page.screenshot({ path: `${out}/run.png` });
  await page.locator('[data-command=build]').click();
  assert.equal((await read()).tick, 0);
  // Reject an impossible edit, preserving the machine and making repair accessible.
  const before = (await read()).metadata.blueprint;
  await page.getByRole('spinbutton', { name: 'Rope length (m)', exact: true }).first().fill('.01');
  await page.getByRole('button', { name: 'Apply rope changes', exact: true }).click();
  assert.deepEqual((await read()).metadata.blueprint, before);
  await page.getByRole('spinbutton', { name: 'Rope length (m)', exact: true }).first().fill('.27');
  await page.getByRole('button', { name: 'Apply rope changes', exact: true }).click();
  assert.equal(await page.locator('.rope-editor [role=status]').first().innerText(), '');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${out}/compact.png` });
  // A second ordinary authored rig starts with near-limit tensile preload. It is supported
  // like the first (beam and block each on a cell stack) so the repair assertion measures the
  // rope, not a free-falling rig hitting the floor at tick ~54.
  await openTools(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  for (const x of [0, 0.4725])
    for (const y of [0.05, 0.15, 0.25]) await place('Power Cell', [x, y, 0]);
  await place('Beam', [0, 0.32, 0]);
  await place('Spacer block', [0.4725, 0.315, 0]);
  await requestRope();
  // End A defaults to the selected block; end B defaults to the first other part, here a
  // cell whose faces do not include 'right', so name the beam explicitly.
  await page
    .getByRole('combobox', { name: 'Rope end B', exact: true })
    .selectOption({ label: 'Beam' });
  await page.getByRole('combobox', { name: 'End A surface', exact: true }).selectOption('top');
  await page.getByRole('combobox', { name: 'End B surface', exact: true }).selectOption('right');
  await page.getByRole('spinbutton', { name: 'Rope length (m)', exact: true }).fill('.25');
  await page.getByRole('button', { name: 'Attach rope', exact: true }).click();
  await page.locator('[data-command=run]').click();
  await liveWait(
    page,
    () => JSON.parse(window.render_game_to_text()).status === 'failed',
    undefined,
    {
      label: 'near-limit 0.25 m rope fails',
    },
  );
  assert.equal((await read()).failure.reasonCode, 'ROPE_MOTION_LIMIT');
  await page.screenshot({ path: `${out}/failure.png` });
  await page.getByRole('button', { name: 'Return to Build', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Rope length (m)', exact: true }).first().fill('.30');
  await page.getByRole('button', { name: 'Apply rope changes', exact: true }).click();
  await page.locator('[data-command=run]').click();
  // The repaired rope must hold for the same horizon the first rig ran, driven by the
  // deterministic clock rather than a pause click racing the simulation.
  await page.evaluate(() => window.advanceTime(2000));
  await liveWait(page, () => JSON.parse(window.render_game_to_text()).tick >= 240, undefined, {
    label: 'repaired rope reaches tick 240',
  });
  const repaired = await read();
  assert.ok(repaired.tick >= 240, `repaired rig paused at tick ${repaired.tick}`);
  assert.notEqual(repaired.status, 'failed');
  assert.ok(
    repaired.ropes.some((r) => r.appliedTension > 0),
    'repaired rope carries load',
  );
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, initial, running, errors: evidence.errors }, null, 2),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
