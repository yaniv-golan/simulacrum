import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
const evidence = createBrowserEvidence(),
  out = process.argv[3] ?? 'artifacts/assemblies-browser';
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
  await page.getByRole('button', { name: 'Powered Motor', exact: true }).click();
  await page.getByRole('button', { name: 'Grip Wheel', exact: true }).click();
  await page.getByRole('button', { name: '⊙ Wheel axle Available', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Attach to Powered Motor · shaft Moves Powered Motor',
      exact: true,
    })
    .click();
  await page.locator('.assembly-library > summary').click();
  await page.getByRole('button', { name: 'Create assembly…', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include Powered Motor', exact: true }).check();
  await page.getByRole('textbox', { name: 'Assembly name', exact: true }).fill('Drive module');
  await page
    .getByRole('textbox', { name: 'Expose Powered Motor · power (power)', exact: true })
    .fill('Power');
  await page.getByRole('button', { name: 'Create and save assembly', exact: true }).click();
  const original = await snapshot('created');
  evidence.assert('equal', [original.assemblies.length, 1]);
  evidence.assert('equal', [original.parts.length, 2]);
  evidence.assert('equal', [original.connections.length, 1]);
  evidence.assert('equal', [await page.locator('.assembly-card svg polygon').count(), 2]);
  await page.getByRole('button', { name: 'Saved assemblies', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search my assemblies' }).fill('missing');
  evidence.assert('equal', [await page.locator('.assembly-card').count(), 0]);
  await page.getByRole('searchbox', { name: 'Search my assemblies' }).fill('drive');
  await page.getByRole('button', { name: 'Place Drive module', exact: true }).click();
  await snapshot('placement-form');
  await page.getByRole('button', { name: 'Insert assembly', exact: true }).click();
  const copies = await snapshot('inserted');
  evidence.assert('equal', [copies.parts.length, 4]);
  evidence.assert('equal', [copies.connections.length, 2]);
  evidence.assert('equal', [copies.assemblies.length, 2]);
  evidence.assert('deepEqual', [copies.assemblies[0], original.assemblies[0]]);
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await page.getByRole('button', { name: 'In this machine', exact: true }).click();
  const instance = page.locator('.assembly-instance').nth(1);
  await instance.locator('summary').click();
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
  await page.locator('.assembly-library > summary').click();
  await page.getByRole('button', { name: 'Saved assemblies', exact: true }).click();
  evidence.assert('equal', [
    await page.getByRole('button', { name: 'Place Drive module', exact: true }).count(),
    1,
  ]);
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
  await page.getByRole('button', { name: 'Remove saved Drive module', exact: true }).click();
  evidence.assert('deepEqual', [(await observed()).metadata.blueprint, rotated]);
  evidence.assert('equal', [await page.locator('.assembly-card').count(), 0]);
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
