import { mkdirSync, writeFileSync } from 'node:fs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './app-fingerprint.mjs';

const evidence = createBrowserEvidence(),
  provisional = process.argv.includes('--provisional');
const out = process.argv[3] ?? 'artifacts/mirror-browser';
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'focus', ...{ headless: false } });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage(),
  errors = evidence.errors,
  samples = [];
page.setDefaultTimeout(6000);

const frame = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function snapshot(label) {
  const observed = await frame();
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (const [i, part] of observed.metadata.blueprint.parts.entries()) {
    const transform = rendered.find((transform) => transform.id === part.id);
    evidence.assert('deepEqual', [transform.position, observed.physics[i].position]);
    evidence.assert('deepEqual', [transform.rotation, observed.physics[i].rotation]);
  }
  samples.push({
    label,
    frame: observed,
    rendered,
    text: await page.locator('body').ariaSnapshot(),
  });
  await page.screenshot({ path: `${out}/${label}.png` });
  writeFileSync(
    `${out}/progress.json`,
    JSON.stringify({ ...evidence.identity, provisional, errors, samples }, null, 2),
  );
  return observed.metadata.blueprint;
}
async function selectWheel() {
  if (!(await page.locator('.machine-picker').evaluate((element) => element.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: /^Grip Wheel$/ })
    .click();
}
async function startMirror() {
  await page.getByRole('button', { name: 'Mirror parts…', exact: true }).click();
}
try {
  await context.tracing.start({ screenshots: true, snapshots: true });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.render_game_to_text);
  // Build the source side through ordinary palette, surface and socket controls.
  await page.locator('.more-parts > summary').click();
  await page.getByRole('button', { name: 'Chassis', exact: true }).click();
  await page.getByRole('button', { name: 'Powered Motor', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Mounting face', exact: true })
    .selectOption({ label: 'Left' });
  await page
    .getByRole('combobox', { name: 'Target surface', exact: true })
    .selectOption({ label: 'Chassis · Right' });
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.getByRole('button', { name: 'Grip Wheel', exact: true }).click();
  await page.getByRole('button', { name: '⊙ Wheel axle Available', exact: true }).click();
  await page
    .getByRole('button', { name: 'Attach to Powered Motor · shaft Moves Grip Wheel', exact: true })
    .click();
  // A named one-part group must not narrow ordinary mechanical movement or mirroring.
  await page.locator('.assembly-library > summary').click();
  await page.getByRole('button', { name: 'Create assembly…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Assembly name', exact: true }).fill('Wheel module');
  await page.getByRole('button', { name: 'Create and save assembly', exact: true }).click();
  const original = await snapshot('built-source');
  evidence.assert('equal', [original.assemblies[0].ids.length, 1]);
  evidence.assert('equal', [
    await page.getByText('Moves 3 parts together', { exact: true }).isVisible(),
    true,
  ]);
  await page.locator('.assembly-library > summary').click();
  await page.keyboard.press('PageUp');
  const moved = await snapshot('connected-parts-moved');
  for (const part of original.parts) {
    const after = moved.parts.find((candidate) => candidate.id === part.id);
    evidence.assert('ok', [Math.abs(after.position[1] - part.position[1] - 0.025) < 1e-9]);
    evidence.assert('deepEqual', [after.rotation, part.rotation]);
  }
  evidence.assert('deepEqual', [moved.assemblies, original.assemblies]);
  evidence.assert('deepEqual', [moved.connections, original.connections]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await frame()).metadata.blueprint, original]);
  evidence.assert('equal', [original.parts.length, 3]);
  evidence.assert('equal', [original.connections.length, 2]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await (await download).saveAs(`${out}/ui-built-source.json`);
  await startMirror();
  evidence.assert('equal', [
    await page.getByRole('region', { name: 'Mirror parts', exact: true }).isVisible(),
    true,
  ]);
  evidence.assert('equal', [
    await page.getByRole('combobox', { name: 'Mirror plane', exact: true }).inputValue(),
    'x',
  ]);
  evidence.assert('equal', [
    await page.getByRole('checkbox', { name: 'Mirror Chassis', exact: true }).isDisabled(),
    true,
  ]);
  evidence.assert('equal', [
    await page.getByRole('checkbox', { name: 'Mirror Powered Motor', exact: true }).isChecked(),
    true,
  ]);
  evidence.assert('equal', [
    await page.getByRole('checkbox', { name: 'Mirror Grip Wheel', exact: true }).isChecked(),
    true,
  ]);
  evidence.assert('deepEqual', [
    await snapshot('preview'),
    original,
    'preview cannot mutate authored state',
  ]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  evidence.assert('equal', [await page.locator('.assembly-mirror').count(), 0]);
  evidence.assert('deepEqual', [await snapshot('cancelled'), original]);
  await startMirror();
  await page.getByRole('combobox', { name: 'Mirror plane', exact: true }).selectOption('z');
  evidence.assert('equal', [
    await page.getByRole('button', { name: 'Create mirrored copy', exact: true }).isDisabled(),
    true,
  ]);
  const refusal = await page.locator('.mirror-status').innerText();
  evidence.assert('match', [refusal, /overlap/i]);
  evidence.assert('doesNotMatch', [refusal, /Part \d+/, 'refusal names the actual mirrored copy']);
  evidence.assert('deepEqual', [await snapshot('wrong-plane-refused'), original]);
  await page.keyboard.press('Escape');
  evidence.assert('equal', [await page.locator('.assembly-mirror').count(), 0]);
  evidence.assert('deepEqual', [await snapshot('escape-cancelled'), original]);
  await startMirror();
  await page.getByRole('button', { name: 'Create mirrored copy', exact: true }).click();
  const copied = await snapshot('created');
  evidence.assert('equal', [copied.parts.length, 5]);
  evidence.assert('equal', [copied.connections.length, 4]);
  evidence.assert('ok', [
    (await frame()).metadata.connections.every((connection) => connection.reasonCode === 'OK'),
  ]);
  for (const part of original.parts)
    evidence.assert('deepEqual', [
      copied.parts.find((candidate) => candidate.id === part.id),
      part,
    ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  evidence.assert('deepEqual', [(await frame()).metadata.blueprint, original]);
  await selectWheel();
  await startMirror();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  await (await chooser).setFiles(`${out}/ui-built-source.json`);
  await page.waitForFunction(() => !document.querySelector('.assembly-mirror'));
  evidence.assert('deepEqual', [
    await snapshot('identical-load-cleared'),
    original,
    'loading identical data clears the old preview',
  ]);
  // A receiver mounted to a motor's left side cannot reflect to its shaft side.
  // Author the same unsupported geometry as the model counterexample through the UI.
  await page.reload();
  await page.waitForFunction(() => window.render_game_to_text);
  await page.getByRole('button', { name: 'Powered Motor', exact: true }).click();
  await page.locator('.more-parts > summary').click();
  await page.getByRole('button', { name: 'Command Receiver', exact: true }).click();
  await page.getByRole('button', { name: 'Snap to surface', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Mounting face', exact: true })
    .selectOption({ label: 'Bottom' });
  await page
    .getByRole('combobox', { name: 'Target surface', exact: true })
    .selectOption({ label: 'Powered Motor · Left' });
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  const unsupported = await snapshot('unsupported-source');
  await startMirror();
  evidence.assert('equal', [
    await page.locator('.mirror-status').textContent(),
    'These parts cannot be mirrored with their current shapes or connections.',
  ]);
  evidence.assert('equal', [
    await page.getByRole('button', { name: 'Create mirrored copy', exact: true }).isDisabled(),
    true,
  ]);
  evidence.assert('deepEqual', [await snapshot('unrepresentable-message'), unsupported]);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  evidence.assert('deepEqual', [(await frame()).metadata.blueprint, unsupported]);
  evidence.assert('deepEqual', [errors, []]);
  if (!provisional) evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        provisional,
        finalIdentity: { build: appFingerprint(), source: sourceIdentity() },
        errors,
        samples,
      },
      null,
      2,
    ),
  );
  console.log(`mirror browser passed${provisional ? ' (provisional source)' : ''}`);
} catch (error) {
  await evidence.captureFailure(error);

  await snapshot('failure').catch(() => {});
  writeFileSync(
    `${out}/failure.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        provisional,
        errors,
        samples,
        message: error.message,
        stack: error.stack,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.tracing.stop({ path: `${out}/trace.zip` }).catch(() => {});
  await browser.close();
}
