import { placeCatalogPart } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
const evidence = createBrowserEvidence(),
  out = browserArtifactPath('artifacts/assemblies-browser', process.argv[3]);
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
  page = await context.newPage();
page.setDefaultTimeout(6000);
const observed = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function snapshot(label) {
  const frame = await observed(),
    rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const [i, part] of frame.metadata.blueprint.parts.entries()) {
    const mesh = rendered.find((p) => p.id === part.id);
    evidence.assert('deepEqual', [mesh.position, frame.physics[i].position]);
    evidence.assert('deepEqual', [mesh.rotation, frame.physics[i].rotation]);
  }
  await page.screenshot({ path: `${out}/${label}.png` });
  writeFileSync(
    `${out}/${label}.json`,
    JSON.stringify({ frame, rendered, text: await page.locator('body').ariaSnapshot() }, null, 2),
  );
  return frame.metadata.blueprint;
}
try {
  await context.tracing.start({ screenshots: true, snapshots: true });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.render_game_to_text);
  const emptyMachine = (await observed()).metadata.blueprint;
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const browserDialog = page.locator('.assembly-browser');
  evidence.assert('equal', [
    await browserDialog.getByRole('button', { name: 'Spring strut', exact: true }).count(),
    1,
  ]);
  await browserDialog.getByRole('button', { name: 'Spring strut', exact: true }).click();
  evidence.assert('equal', [
    await browserDialog.getByText('Saved item actions', { exact: true }).count(),
    0,
  ]);
  await browserDialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, emptyMachine]);
  const strutPlacement = page.getByRole('region', { name: 'Assembly placement', exact: true });
  await strutPlacement.getByRole('button', { name: 'Cancel placement', exact: true }).click();
  await browserDialog
    .getByRole('combobox', { name: 'Assembly collection', exact: true })
    .selectOption('saved');
  evidence.assert('equal', [
    await browserDialog.getByText('No saved assemblies yet.', { exact: true }).isVisible(),
    true,
  ]);
  await browserDialog
    .getByRole('combobox', { name: 'Assembly collection', exact: true })
    .selectOption('builtin');
  await browserDialog.getByRole('button', { name: 'Spring strut', exact: true }).click();
  await browserDialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
  await strutPlacement.getByRole('button', { name: 'Place', exact: true }).click();
  const strut = await snapshot('builtin-strut');
  evidence.assert('equal', [strut.parts.length, 4]);
  evidence.assert('equal', [strut.assemblies[0].name, 'Spring strut']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, emptyMachine]);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  await browserDialog
    .getByRole('combobox', { name: 'Assembly collection', exact: true })
    .selectOption('all');
  await browserDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await placeCatalogPart(page, 'poweredMotor');
  await placeCatalogPart(page, 'gripWheel');
  await page.getByRole('button', { name: '⊙ Wheel axle Available', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Attach to Powered Motor · shaft Moves Powered Motor',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Create assembly…', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include Powered Motor', exact: true }).check();
  await page.getByRole('textbox', { name: 'Assembly name', exact: true }).fill('Drive module');
  await page.getByText('Named connection points', { exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Expose Powered Motor · power (power)', exact: true })
    .fill('Power');
  await page.getByRole('button', { name: 'Create and save assembly', exact: true }).click();
  const original = await snapshot('created');
  evidence.assert('equal', [original.assemblies.length, 1]);
  evidence.assert('equal', [original.parts.length, 2]);
  evidence.assert('equal', [original.connections.length, 1]);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search assemblies' }).fill('missing');
  evidence.assert('equal', [await page.locator('.assembly-card').count(), 0]);
  await page.getByRole('searchbox', { name: 'Search assemblies' }).fill('drive');
  const libraryDialog = page.getByRole('dialog', { name: 'Assemblies', exact: true });
  await libraryDialog.getByRole('button', { name: 'Drive module', exact: true }).click();
  await libraryDialog.locator('.assembly-thumbnail img').first().waitFor({ state: 'visible' });
  evidence.assert('ok', [
    await libraryDialog
      .locator('.assembly-thumbnail img')
      .first()
      .evaluate((img) => img.complete && img.naturalWidth > 0),
  ]);
  await libraryDialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
  evidence.assert('equal', [await libraryDialog.isVisible(), false]);
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, original]);
  await snapshot('placement-form');
  await page
    .getByRole('region', { name: 'Assembly placement', exact: true })
    .getByRole('button', { name: 'Place', exact: true })
    .click();
  const copies = await snapshot('inserted');
  evidence.assert('equal', [copies.parts.length, 4]);
  evidence.assert('equal', [copies.connections.length, 2]);
  evidence.assert('equal', [copies.assemblies.length, 2]);
  evidence.assert('deepEqual', [copies.assemblies[0], original.assemblies[0]]);
  await placeCatalogPart(page, 'powerCell');
  if (!(await page.locator('.machine-picker').evaluate((node) => node.open)))
    await page.locator('.machine-picker > summary').click();
  await page.getByRole('button', { name: 'Select assembly Drive module-2', exact: true }).click();
  const instance = page.locator('.assembly-instance');
  await instance
    .getByRole('combobox', { name: 'Connect Drive module-2 Power to', exact: true })
    .selectOption({ label: 'Power Cell · power (power)' });
  await instance.getByRole('button', { name: 'Connect Power', exact: true }).click();
  const wired = await snapshot('named-port-connected');
  evidence.assert('equal', [wired.connections.length, 3]);
  const alias = wired.assemblies[1].ports[0].endpoint;
  const cell = wired.parts.find((part) => part.type === 'powerCell');
  evidence.assert('equal', [
    wired.connections.some(
      (edge) =>
        edge.kind === 'power' &&
        [edge.a, edge.b].some((endpoint) => endpoint.part === cell.id) &&
        [edge.a, edge.b].some((endpoint) => endpoint.part === alias.part),
    ),
    true,
  ]);
  evidence.assert('equal', [
    wired.connections.some(
      (e) =>
        e.kind === 'power' &&
        [e.a, e.b].some((p) => p.part === alias.part && p.port === alias.port),
    ),
    true,
  ]);
  await instance.getByRole('button', { name: 'Rotate Drive module-2 90°', exact: true }).click();
  const rotated = await snapshot('rotated');
  evidence.assert('deepEqual', [rotated.connections, wired.connections]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, wired]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, rotated]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/machine.json`);
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  evidence.assert('equal', [
    await libraryDialog.getByRole('button', { name: 'Drive module', exact: true }).count(),
    1,
  ]);
  await libraryDialog.getByRole('button', { name: 'Close', exact: true }).click();
  // Load the UI-authored save through its actual file input; the library is not needed to resolve it.
  await page.locator('input[type=file]').first().setInputFiles(`${out}/machine.json`);
  await page.waitForFunction(
    (expected) =>
      JSON.stringify(window.workshopProbe.observe().frames[0].metadata.blueprint) ===
      JSON.stringify(expected),
    rotated,
  );
  const loaded = await snapshot('loaded');
  evidence.assert('deepEqual', [loaded, rotated]);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  await libraryDialog.getByRole('button', { name: 'Drive module', exact: true }).click();
  await libraryDialog.getByText('Saved item actions', { exact: true }).click();
  await libraryDialog
    .getByRole('button', { name: 'Remove saved Drive module', exact: true })
    .click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, rotated]);
  await libraryDialog.getByRole('button', { name: 'Remove saved item', exact: true }).click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, rotated]);
  await libraryDialog
    .getByRole('combobox', { name: 'Assembly collection', exact: true })
    .selectOption('saved');
  evidence.assert('equal', [await page.locator('.assembly-card').count(), 0]);
  await libraryDialog
    .getByRole('combobox', { name: 'Assembly collection', exact: true })
    .selectOption('builtin');
  evidence.assert('equal', [
    await libraryDialog.getByRole('button', { name: 'Spring strut', exact: true }).count(),
    1,
  ]);
  await page.setViewportSize({ width: 640, height: 360 });
  await snapshot('builtin-browser-compact');
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, ok: true, errors: evidence.errors }, null, 2),
  );
  console.log('assemblies browser passed');
} catch (error) {
  await evidence.captureFailure(error);
  await snapshot('failure').catch(() => {});
  throw error;
} finally {
  await context.tracing.stop({ path: `${out}/trace.zip` }).catch(() => {});
  await browser.close();
}
