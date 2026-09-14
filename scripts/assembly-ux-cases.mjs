import { uploadWorkshopFile } from './browser-evidence.mjs';
import { placeCatalogPart, openTools } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { assemblyPartition } from './assembly-scenarios.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
export async function runAssemblyCases(partition, evidence, browser) {
  if (![0, 1].includes(partition)) throw Error('Invalid assembly partition');
  let scenarioIndex = 0;
  const out = browserArtifactPath(`artifacts/assembly-ux-browser-${partition}`);
  mkdirSync(out, { recursive: true });
  const results = [];
  const rover = JSON.parse(
    readFileSync(new URL('../test/fixtures/reusable-rover.json', import.meta.url)),
  );
  async function selectAssembly(page, name) {
    if (!(await page.locator('.machine-picker').evaluate((node) => node.open)))
      await page.locator('.machine-picker > summary').click();
    await page
      .locator('.machine-picker')
      .getByRole('button', { name: `Select assembly ${name}`, exact: true })
      .click();
    return page.locator('.assembly-instance');
  }
  async function attempt(name, run) {
    if (assemblyPartition(scenarioIndex++) !== partition) return;
    const started = performance.now(),
      timings = {};
    let phase = 'setup',
      phaseStarted = started;
    const persist = () =>
      writeFileSync(
        `${out}/results.json`,
        JSON.stringify({ results, active: { name, phase, timings } }, null, 2),
      );
    persist();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
      page = await context.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const observed = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const load = async (bp) => {
      await uploadWorkshopFile(page, {
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
      // Apply the operation deadline after startup; the process deadline is unchanged.
      page.setDefaultTimeout(5000);
      timings.setupMs = performance.now() - started;
      phase = 'actions';
      phaseStarted = performance.now();
      persist();
      const actionStart = performance.now();
      await run(page, load, observed);
      timings.actionMs = performance.now() - actionStart;
      results.push({ name, ok: true, timings });
    } catch (error) {
      timings[phase === 'setup' ? 'setupMs' : 'actionMs'] = performance.now() - phaseStarted;
      results.push({ name, ok: false, phase, error: error.message, timings });
    } finally {
      phase = 'cleanup';
      persist();
      const cleanupStart = performance.now();
      for (const cleanup of [
        () => page.screenshot({ path: `${out}/${name}.png` }),
        () => context.tracing.stop({ path: `${out}/${name}.zip` }),
        () => context.close(),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          results.push({ name, ok: false, phase: 'cleanup', error: error.message });
        }
      }
      timings.cleanupMs = performance.now() - cleanupStart;
      timings.totalMs = performance.now() - started;
      persist();
    }
  }
  try {
    async function savedCorner(p, load) {
      await load(rover);
      const group = await selectAssembly(p, 'Rover corner');
      await group.getByRole('button', { name: 'Save to library', exact: true }).click();
      await openTools(p);
      await p.getByRole('button', { name: 'Assemblies', exact: true }).click();
      return p.getByRole('dialog', { name: 'Assemblies', exact: true });
    }
    async function insertedCorner(p, load) {
      const dialog = await savedCorner(p, load);
      await dialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
      await p
        .getByRole('region', { name: 'Assembly placement', exact: true })
        .getByRole('button', { name: 'Place', exact: true })
        .click();
      await p.locator('.assembly-instance').waitFor({ state: 'visible' });
    }
    await attempt('inserted-selection-shortcuts', async (p, load, observed) => {
      await insertedCorner(p, load);
      const before = (await observed()).metadata.blueprint;
      for (const key of ['Delete', 'x', 'c', 'ArrowUp', 'Alt+ArrowRight']) {
        await p.keyboard.press(key);
        await p.evaluate(() => new Promise(requestAnimationFrame));
        evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
      }
      // Explicit member inspection must still enable the ordinary part shortcut.
      await p
        .locator('.assembly-instance')
        .getByRole('button', {
          name: 'Inspect Command Receiver-5',
          exact: true,
        })
        .click();
      await p.keyboard.press('Delete');
      await p.waitForFunction(
        (count) =>
          JSON.parse(window.render_game_to_text()).metadata.blueprint.parts.length === count,
        before.parts.length - 1,
      );
      await p.getByRole('button', { name: 'Undo', exact: true }).click();
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
    });
    await attempt('repeat-build-only', async (p, load) => {
      await insertedCorner(p, load);
      const repeat = p.getByRole('button', { name: 'Place another', exact: true });
      evidence.assert('equal', [await repeat.isVisible(), true]);
      await p.locator('[data-command=run]').click();
      evidence.assert('equal', [await repeat.isVisible(), false]);
      await p.locator('[data-command=pause]').click();
      evidence.assert('equal', [await repeat.isVisible(), false]);
      await p.locator('[data-command=build]').click();
      await repeat.click();
      const placement = p.getByRole('region', { name: 'Assembly placement', exact: true });
      evidence.assert('equal', [await placement.isVisible(), true]);
      evidence.assert('equal', [
        await placement.getByRole('button', { name: 'Place', exact: true }).isEnabled(),
        true,
      ]);
      await placement.getByRole('button', { name: 'Cancel placement', exact: true }).click();
    });
    await attempt('rename-keyboard-focus', async (p, load) => {
      const dialog = await savedCorner(p, load);
      await dialog.getByText('Saved item actions', { exact: true }).click();
      await dialog
        .getByRole('textbox', { name: 'Saved name Rover corner', exact: true })
        .fill('Renamed corner');
      await dialog.getByRole('button', { name: 'Rename saved assembly', exact: true }).click();
      evidence.assert('equal', [
        await dialog
          .getByRole('button', { name: 'Place in machine', exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      ]);
      evidence.assert('equal', [
        await dialog.getByRole('heading', { name: 'Renamed corner', exact: true }).isVisible(),
        true,
      ]);
    });
    await attempt('compact-sort-navigation', async (p, load) => {
      const dialog = await savedCorner(p, load);
      await p.setViewportSize({ width: 640, height: 360 });
      await dialog
        .getByRole('combobox', { name: 'Sort assemblies', exact: true })
        .selectOption('name');
      evidence.assert('equal', [await dialog.locator('.assembly-results').isVisible(), true]);
      evidence.assert('equal', [await dialog.locator('.assembly-detail').isVisible(), false]);
      await dialog.getByRole('button', { name: 'Rover corner', exact: true }).click();
      evidence.assert('equal', [await dialog.locator('.assembly-detail').isVisible(), true]);
      await dialog.getByRole('button', { name: 'Back to results', exact: true }).click();
      evidence.assert('equal', [await dialog.locator('.assembly-results').isVisible(), true]);
    });
    await attempt('offset-mount', async (p, load, observed) => {
      const bp = structuredClone(rover);
      bp.id = 'offset';
      bp.parts = bp.parts.slice(0, 7);
      bp.assemblies = bp.assemblies.slice(0, 2);
      bp.connections = bp.connections.filter((e) =>
        [
          'connection-1',
          'connection-2',
          'assembly-link-1',
          'connection-3',
          'connection-4',
        ].includes(e.id),
      );
      for (const part of bp.parts)
        if (['part-5', 'part-6', 'part-7'].includes(part.id)) part.position[0] += 2;
      await load(bp);
      const instance = await selectAssembly(p, 'Rover corner-2');
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
      const g = await selectAssembly(p, 'Rover corner-2');
      await g.getByRole('button', { name: 'Inspect Powered Motor-2', exact: true }).click();
      evidence.assert('equal', [
        await p.getByRole('button', { name: 'Snap to surface', exact: true }).count(),
        1,
      ]);
    });
    await attempt('decimal-strength', async (p, load, observed) => {
      await load(rover);
      const g = await selectAssembly(p, 'Rover corner');
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
      const g = await selectAssembly(p, 'Rover corner');
      await g.getByRole('button', { name: 'Edit Rover corner', exact: true }).click();
      await p.getByText('Named connection points', { exact: true }).click();
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
      const g = await selectAssembly(p, 'Rover corner');
      await g.getByRole('button', { name: 'Save to library', exact: true }).click();
      await g.getByRole('button', { name: 'Save to library', exact: true }).click();
      await openTools(p);
      await p.getByRole('button', { name: 'Assemblies', exact: true }).click();
      evidence.assert('equal', [
        await p
          .getByRole('dialog', { name: 'Assemblies', exact: true })
          .getByRole('button', { name: 'Rover corner-2', exact: true })
          .count(),
        1,
      ]);
      const dialog = p.getByRole('dialog', { name: 'Assemblies', exact: true });
      await dialog.getByRole('button', { name: 'Rover corner-2', exact: true }).click();
      await dialog.getByText('Inspect saved parts', { exact: true }).click();
      evidence.assert('match', [
        await dialog.locator('.assembly-detail').textContent(),
        /gain.*1/i,
      ]);
    });
    await attempt('named-targets-and-layout', async (p, load) => {
      await load(rover);
      const g = await selectAssembly(p, 'Rover corner');
      evidence.assert('match', [
        await g
          .getByRole('combobox', { name: 'Connect Rover corner Power to', exact: true })
          .textContent(),
        /Rover corner-2 · Power/,
      ]);
      await openTools(p);
      await p.getByRole('button', { name: 'Assemblies', exact: true }).click();
      evidence.assert('equal', [await g.isVisible(), false]);
    });
    await attempt('sidebar-layout', async (p, load) => {
      await load(rover);
      await selectAssembly(p, 'Rover corner');
      await openTools(p);
      await p.getByRole('button', { name: 'Assemblies', exact: true }).click();
      evidence.assert('equal', [await p.locator('.assembly-instance').first().isVisible(), false]);
    });
    await attempt('draft-origin-and-cancel', async (p, load, observed) => {
      const bp = structuredClone(createEmptyBlueprint('assembly-origin', 'Origin ordering'));
      bp.parts.push(
        createPart('poweredMotor', 'origin-motor', [0, 0.5, 0]),
        createPart('gripWheel', 'origin-wheel', [0.8, 0.5000000000000001, 0]),
      );
      await load(bp);
      const before = (await observed()).metadata.blueprint;
      await p.getByRole('button', { name: 'Create assembly…', exact: true }).click();
      const motor = p.getByRole('checkbox', { name: 'Include Powered Motor', exact: true });
      const wheel = p.getByRole('checkbox', { name: 'Include Grip Wheel', exact: true });
      // Clear any ordinary part selection carried into the editor, then choose the origin.
      await motor.uncheck();
      await wheel.uncheck();
      await motor.check();
      const canvas = await p.locator('canvas').first().boundingBox();
      const center = await p.evaluate(() =>
        window.workshopProbe.readRenderedCenters().find((part) => part.id === 'origin-wheel'),
      );
      await p.mouse.click(
        canvas.x + (center.x * 0.5 + 0.5) * canvas.width,
        canvas.y + (-center.y * 0.5 + 0.5) * canvas.height,
      );
      evidence.assert('equal', [await wheel.isChecked(), true]);
      evidence.assert('equal', [
        await p
          .getByText(
            'Origin: Powered Motor · highlighted in amber. Removing it uses the next selected part.',
            { exact: true },
          )
          .isVisible(),
        true,
      ]);
      await motor.uncheck();
      await motor.check();
      evidence.assert('equal', [
        await p
          .getByText(
            'Origin: Grip Wheel · highlighted in amber. Removing it uses the next selected part.',
            { exact: true },
          )
          .isVisible(),
        true,
      ]);
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
      await p.getByRole('button', { name: 'Cancel assembly', exact: true }).click();
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
      await p.getByRole('button', { name: 'Create assembly…', exact: true }).click();
      await motor.uncheck();
      await wheel.uncheck();
      await wheel.check();
      await motor.check();
      await p.getByRole('button', { name: 'Create and save assembly', exact: true }).click();
      const created = (await observed()).metadata.blueprint;
      evidence.assert('deepEqual', [created.assemblies[0].ids, ['origin-wheel', 'origin-motor']]);
      evidence.assert('deepEqual', [created.parts, before.parts]);
      evidence.assert('deepEqual', [created.connections, before.connections]);
      // Display rounding must not become an authored edit when a field is only visited.
      await openTools(p);
      await p.getByRole('button', { name: 'Assemblies', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: 'Assemblies', exact: true });
      await dialog.getByRole('button', { name: 'My assembly', exact: true }).click();
      await dialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
      const placement = p.getByRole('region', { name: 'Assembly placement', exact: true });
      await placement.getByText('Precise position', { exact: true }).click();
      const height = placement.getByRole('spinbutton', {
        name: 'Insert assembly Y (m)',
        exact: true,
      });
      await height.focus();
      await height.press('Tab');
      await p.screenshot({ path: `${out}/free-placement-desktop.png` });
      await placement.getByRole('button', { name: 'Place', exact: true }).click();
      const inserted = (await observed()).metadata.blueprint;
      const copiedOrigin = inserted.parts.find((part) => part.id === inserted.assemblies[1].ids[0]);
      evidence.assert('equal', [copiedOrigin.position[1], 0.5000000000000001]);
    });
    await attempt('browse-place-cancel', async (p, load, observed) => {
      await load(rover);
      const group = await selectAssembly(p, 'Rover corner');
      await group.getByRole('button', { name: 'Save to library', exact: true }).click();
      const before = (await observed()).metadata.blueprint;
      await openTools(p);
      const launcher = p.getByRole('button', { name: 'Assemblies', exact: true });
      await launcher.click();
      const dialog = p.getByRole('dialog', { name: 'Assemblies', exact: true });
      const search = dialog.getByRole('searchbox', { name: 'Search assemblies', exact: true });
      await search.fill('not a saved assembly');
      evidence.assert('equal', [
        await dialog.getByText('No matching assemblies.', { exact: true }).isVisible(),
        true,
      ]);
      evidence.assert('equal', [
        await dialog.getByText('No saved assemblies yet.', { exact: true }).count(),
        0,
      ]);
      await dialog.getByRole('button', { name: 'Clear search', exact: true }).click();
      await search.fill('corner');
      await search.press('Escape');
      evidence.assert('equal', [await dialog.isVisible(), false]);
      // The launcher sits in the Tools menu; leaving the browser hands focus to that control.
      evidence.assert('equal', [
        await p
          .locator('details.tools-menu > summary')
          .evaluate((node) => node === document.activeElement),
        true,
      ]);
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
      await openTools(p);
      await launcher.click();
      evidence.assert('equal', [await search.inputValue(), 'corner']);
      await p.setViewportSize({ width: 640, height: 360 });
      const bounds = await dialog.boundingBox();
      evidence.assert('ok', [
        bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= 640 &&
          bounds.y + bounds.height <= 360,
      ]);
      await dialog.getByRole('button', { name: 'Rover corner', exact: true }).click();
      await dialog.getByRole('button', { name: 'Back to results', exact: true }).click();
      await dialog.getByRole('button', { name: 'Rover corner', exact: true }).click();
      await dialog.getByRole('button', { name: 'Place in machine', exact: true }).click();
      const placement = p.getByRole('region', { name: 'Assembly placement', exact: true });
      await placement.waitFor({ state: 'visible' });
      evidence.assert('equal', [await dialog.isVisible(), false]);
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
      evidence.assert('equal', [
        await p.getByRole('checkbox', { name: 'Surface snap', exact: true }).isVisible(),
        false,
      ]);
      await placement.getByText('Precise position', { exact: true }).click();
      const x = placement.getByRole('spinbutton', { name: 'Insert assembly X (m)', exact: true });
      const initial = await x.inputValue();
      await x.focus();
      await x.press('Tab');
      evidence.assert('equal', [await x.inputValue(), initial]);
      await placement
        .getByRole('combobox', { name: 'Position increment', exact: true })
        .selectOption('0.1');
      await placement.getByRole('button', { name: 'X +', exact: true }).click();
      evidence.assert('ok', [
        Math.abs(Number(await x.inputValue()) - Number(initial) - 0.1) < 1e-9,
      ]);
      await placement
        .getByRole('combobox', { name: 'Rotation axis', exact: true })
        .selectOption('Y');
      const turn = placement.getByRole('spinbutton', {
        name: 'Insert assembly Y rotation (degrees)',
        exact: true,
      });
      const beforeTurn = Number(await turn.inputValue());
      await placement.getByRole('button', { name: 'Rotate 90°', exact: true }).click();
      evidence.assert('ok', [Math.abs(Number(await turn.inputValue()) - beforeTurn) > 45]);
      await p.screenshot({ path: `${out}/free-placement-ghost.png` });
      await x.fill('5.125');
      await x.press('Tab');
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
      await x.press('Escape');
      await dialog.waitFor({ state: 'visible' });
      evidence.assert('equal', [await placement.isVisible(), false]);
      evidence.assert('equal', [await search.inputValue(), 'corner']);
      evidence.assert('deepEqual', [(await observed()).metadata.blueprint, before]);
    });
    await attempt('hinge-check', async (p, load) => {
      const bp = createEmptyBlueprint('hinge', 'Articulation');
      bp.parts.push(createPart('poweredHinge', 'hinge', [0, 1, 0]));
      await load(bp);
      await openTools(p);
      await p.getByRole('button', { name: 'Check machine', exact: true }).click();
      const text = await p.getByRole('dialog', { name: 'Check machine' }).textContent();
      evidence.assert('doesNotMatch', [text, /Add a motor, a power cell and a driven wheel/]);
      evidence.assert('match', [text, /hinge/i]);
    });
    await attempt('failure-layout', async (p) => {
      await placeCatalogPart(p, 'poweredMotor');
      // Build already shows the readiness line; the Run line is a different, later text.
      await p.locator('.machine-health', { hasText: /^Not ready to run/ }).waitFor();
      await p.locator('[data-command=run]').click();
      // Running replaces the readiness line with the first blocker's own title.
      await p
        .locator('.machine-health', { hasNotText: /ready to run/ })
        .waitFor({ state: 'visible', timeout: 6000 });
      const health = await p.locator('.machine-health').boundingBox(),
        follow = await p
          .getByRole('checkbox', { name: 'Follow motion' })
          .locator('..')
          .boundingBox();
      evidence.assert('ok', [
        health.y >= follow.y + follow.height || health.y + health.height <= follow.y,
      ]);
      await p.locator('.machine-health').click();
      await p.getByRole('dialog', { name: 'Check machine' }).waitFor({ state: 'visible' });
      await p.locator('[data-diagnostic-code="MISSING_POWER"]').waitFor({ state: 'visible' });
    });
    evidence.assertUnchanged();
    writeFileSync(`${out}/result.json`, JSON.stringify({ ...evidence.identity, results }, null, 2));
    evidence.assert('deepEqual', [results.filter((r) => !r.ok), []]);
    console.log('assembly UX browser passed');
  } finally {
    await browser.close();
  }
}
