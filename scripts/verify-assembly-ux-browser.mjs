import { createBrowserEvidence } from './browser-evidence.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
const evidence = createBrowserEvidence(),
  out = 'artifacts/assembly-ux-browser';
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  results = [];
const rover = JSON.parse(
  readFileSync(new URL('../test/fixtures/reusable-rover.json', import.meta.url)),
);
async function attempt(name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
    page = await context.newPage();
  page.setDefaultTimeout(1800);
  await context.tracing.start({ screenshots: true, snapshots: true });
  const observed = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const load = async (bp) => {
    await page
      .locator('input[type=file]')
      .first()
      .setInputFiles({
        name: 'machine.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(bp)),
      });
    await page.waitForFunction(
      (id) => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === id,
      bp.id,
    );
  };
  try {
    await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
    await page.waitForFunction(() => window.render_game_to_text);
    await run(page, load, observed);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
  } finally {
    await page.screenshot({ path: `${out}/${name}.png` });
    await context.tracing.stop({ path: `${out}/${name}.zip` });
    await context.close();
  }
}
try {
  await attempt('offset-mount', async (p, load, observed) => {
    const bp = structuredClone(rover);
    bp.id = 'offset';
    bp.parts = bp.parts.slice(0, 7);
    bp.assemblies = bp.assemblies.slice(0, 2);
    bp.connections = bp.connections.filter((e) =>
      ['connection-1', 'connection-2', 'assembly-link-1', 'connection-3', 'connection-4'].includes(
        e.id,
      ),
    );
    for (const part of bp.parts)
      if (['part-5', 'part-6', 'part-7'].includes(part.id)) part.position[0] += 2;
    await load(bp);
    await p.locator('.assembly-library > summary').click();
    const instance = p.locator('.assembly-instance').nth(1);
    await instance.locator('summary').first().click();
    await instance
      .getByRole('combobox', { name: 'Connect Rover corner-2 Chassis mount to', exact: true })
      .selectOption({ label: 'Chassis · Right (mount)' });
    await instance.getByRole('button', { name: 'Connect Chassis mount', exact: true }).click();
    const surface = p.getByRole('region', { name: 'Surface placement' });
    await surface.waitFor({ state: 'visible' });
    evidence.assert('deepEqual', [(await observed()).metadata.blueprint, bp]);
    await surface.getByText('Precise position', { exact: true }).click();
    await surface
      .getByRole('spinbutton', { name: 'Across surface (mm)', exact: true })
      .fill('-120');
    await surface
      .getByRole('spinbutton', { name: 'Across surface (mm)', exact: true })
      .press('Tab');
    await surface.getByRole('spinbutton', { name: 'Turn (degrees)', exact: true }).fill('0');
    await surface.getByRole('spinbutton', { name: 'Turn (degrees)', exact: true }).press('Tab');
    await surface.getByRole('button', { name: 'Attach', exact: true }).click();
    const next = (await observed()).metadata.blueprint;
    evidence.assert('equal', [next.connections.length, bp.connections.length + 1]);
    evidence.assert('equal', [next.connections.filter((e) => e.kind === 'shaft').length, 2]);
    await p.getByRole('button', { name: 'Undo', exact: true }).click();
    evidence.assert('deepEqual', [(await observed()).metadata.blueprint, bp]);
  });
  await attempt('shaft-housing-mount', async (p, load) => {
    const bp = structuredClone(rover);
    bp.id = 'shaft';
    bp.connections = bp.connections.filter((e) => e.id !== 'surface-1');
    await load(bp);
    await p.locator('.assembly-library > summary').click();
    const g = p.locator('.assembly-instance').nth(1);
    await g.locator('summary').first().click();
    await g.getByRole('button', { name: 'Inspect Powered Motor-2', exact: true }).click();
    evidence.assert('equal', [
      await p.getByRole('button', { name: 'Snap to surface', exact: true }).count(),
      1,
    ]);
  });
  await attempt('decimal-strength', async (p, load, observed) => {
    await load(rover);
    await p.locator('.assembly-library > summary').click();
    const g = p.locator('.assembly-instance').first();
    await g.locator('summary').first().click();
    await g.getByRole('button', { name: 'Inspect Command Receiver', exact: true }).click();
    await p.locator('.receiver-controls > summary').click();
    await p.getByText('Edit keys & mixing', { exact: true }).click();
    const strength = p.getByRole('spinbutton', { name: 'drive output strength', exact: true });
    await strength.fill('0.25');
    await strength.press('Tab');
    evidence.assert('equal', [
      (await observed()).metadata.blueprint.parts.find((p) => p.id === 'part-3').controlBinding
        .drive.gain,
      0.25,
    ]);
  });
  await attempt('edit-interface', async (p, load, observed) => {
    await load(rover);
    await p.locator('.assembly-library > summary').click();
    const g = p.locator('.assembly-instance').first();
    await g.locator('summary').first().click();
    await g.getByRole('button', { name: 'Edit Rover corner', exact: true }).click();
    const field = p.getByRole('textbox', {
      name: 'Expose Powered Motor · power (power)',
      exact: true,
    });
    evidence.assert('equal', [await field.inputValue(), 'Power']);
    await field.fill('Supply');
    await p.getByRole('button', { name: 'Apply assembly changes', exact: true }).click();
    const next = (await observed()).metadata.blueprint;
    evidence.assert('deepEqual', [next.parts, rover.parts]);
    evidence.assert('deepEqual', [next.connections, rover.connections]);
    evidence.assert('equal', [next.assemblies[0].ports[0].name, 'Supply']);
  });
  await attempt('saved-revisions', async (p, load) => {
    await load(rover);
    await p.locator('.assembly-library > summary').click();
    const g = p.locator('.assembly-instance').first();
    await g.locator('summary').first().click();
    await g.getByRole('button', { name: 'Save to library', exact: true }).click();
    await g.getByRole('button', { name: 'Save to library', exact: true }).click();
    await p.getByRole('button', { name: 'Saved assemblies', exact: true }).click();
    evidence.assert('equal', [
      await p.getByRole('button', { name: 'Place Rover corner-2', exact: true }).count(),
      1,
    ]);
    await p
      .locator('.assembly-card')
      .first()
      .getByText('Inspect saved parts', { exact: true })
      .click();
    evidence.assert('match', [await p.locator('.assembly-card').first().textContent(), /gain.*1/i]);
  });
  await attempt('named-targets-and-layout', async (p, load) => {
    await load(rover);
    await p.locator('.assembly-library > summary').click();
    const g = p.locator('.assembly-instance').first();
    await g.locator('summary').first().click();
    evidence.assert('match', [
      await g
        .getByRole('combobox', { name: 'Connect Rover corner Power to', exact: true })
        .textContent(),
      /Rover corner-2 · Power/,
    ]);
    await p.getByRole('button', { name: 'Saved assemblies', exact: true }).click();
    evidence.assert('equal', [await g.isVisible(), false]);
  });
  await attempt('sidebar-layout', async (p, load) => {
    await load(rover);
    await p.locator('.assembly-library > summary').click();
    await p.locator('.assembly-instance').first().locator('summary').first().click();
    await p.getByRole('button', { name: 'Saved assemblies', exact: true }).click();
    evidence.assert('equal', [await p.locator('.assembly-instance').first().isVisible(), false]);
  });
  await attempt('hinge-check', async (p, load) => {
    const bp = createEmptyBlueprint('hinge', 'Articulation');
    bp.parts.push(createPart('poweredHinge', 'hinge', [0, 1, 0]));
    await load(bp);
    await p.getByRole('button', { name: 'Check machine', exact: true }).click();
    const text = await p.getByRole('dialog', { name: 'Check machine' }).textContent();
    evidence.assert('doesNotMatch', [text, /Add a motor, a power cell and a driven wheel/]);
    evidence.assert('match', [text, /hinge/i]);
  });
  await attempt('failure-layout', async (p) => {
    await p.getByRole('button', { name: 'Powered Motor', exact: true }).click();
    await p.locator('[data-command=run]').click();
    await p.locator('.machine-health').waitFor({ state: 'visible', timeout: 6000 });
    const health = await p.locator('.machine-health').boundingBox(),
      follow = await p.getByRole('checkbox', { name: 'Follow motion' }).locator('..').boundingBox();
    evidence.assert('ok', [
      health.y >= follow.y + follow.height || health.y + health.height <= follow.y,
    ]);
  });
  evidence.assertUnchanged();
  writeFileSync(`${out}/result.json`, JSON.stringify({ ...evidence.identity, results }, null, 2));
  evidence.assert('deepEqual', [results.filter((r) => !r.ok), []]);
  console.log('assembly UX browser passed');
} finally {
  await browser.close();
}
