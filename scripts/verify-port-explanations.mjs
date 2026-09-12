import { placeCatalogPart } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { createStarterVehicle } from '../src/model/starter-vehicle.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { snapConnection } from '../src/model/assembly.mjs';
const browserEvidence = createBrowserEvidence();

const browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
  errors = browserEvidence.errors;
page.setDefaultTimeout(6000);

mkdirSync(browserArtifactPath('artifacts/feedback-fixes'), { recursive: true });
const read = () => page.evaluate(() => window.workshopProbe.observe().frames[0].metadata.blueprint);
async function select(name) {
  if (!(await page.locator('.machine-picker').evaluate((el) => el.open)))
    await page.locator('.machine-picker > summary').click();
  await page
    .locator('.part-list-item')
    .filter({ hasText: new RegExp(`^${name}$`) })
    .click();
}
try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await page.locator('[data-command=guide-step]').click();
  await page.getByRole('button', { name: 'Leave guide', exact: true }).click();
  await select('Motor');
  const before = await read();
  browserEvidence.assert('equal', [
    await page.locator('.port-button[data-port-id=mount]').count(),
    0,
    'surface mounting must not expose a duplicate fixed socket',
  ]);
  browserEvidence.assert('match', [
    await page.locator('.mount-relationship').innerText(),
    /Bolted to Chassis/,
  ]);
  browserEvidence.assert('equal', [
    await page.getByRole('button', { name: 'Adjust mount', exact: true }).isEnabled(),
    true,
  ]);
  browserEvidence.assert('equal', [
    await page.getByRole('button', { name: 'Detach', exact: true }).isEnabled(),
    true,
  ]);
  for (const id of ['shaft', 'power']) {
    const port = page.locator(`.port-button[data-port-id=${id}]`);
    browserEvidence.assert('equal', [
      await port.isEnabled(),
      true,
      'connected ports must remain inspectable',
    ]);
    await port.click();
    browserEvidence.assert('equal', [
      await page.locator('.port-explanation [data-disconnect-id]').count(),
      1,
    ]);
    browserEvidence.assert('equal', [
      await page.locator('.target-button').count(),
      0,
      'occupied connector must not offer another attachment',
    ]);
  }
  browserEvidence.assert('deepEqual', [
    await read(),
    before,
    'inspection must not change authored connections',
  ]);
  await select('Drive wheel');
  browserEvidence.assert('equal', [
    await page.locator('.port-button[data-port-id=mount]').count(),
    0,
  ]);
  await page.locator('.port-button[data-port-id=axle]').click();
  browserEvidence.assert('match', [
    await page.locator('.port-explanation').textContent(),
    /holds the wheel too; no separate fixed mount/,
  ]);
  await page.screenshot({ path: browserArtifactPath('artifacts/feedback-fixes/wheel-ports.png') });
  browserEvidence.assert('deepEqual', [await read(), before]);
  await select('Motor');
  await page.getByRole('button', { name: 'Adjust mount', exact: true }).click();
  browserEvidence.assert('equal', [await page.locator('.surface-placement').isVisible(), true]);
  browserEvidence.assert('deepEqual', [
    await read(),
    before,
    'mount adjustment begins as read-only preview',
  ]);
  await page
    .locator('.surface-placement')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  browserEvidence.assert('deepEqual', [await read(), before]);
  await page.getByRole('button', { name: 'Detach', exact: true }).click();
  const detached = await read(),
    motor = before.parts.find((p) => p.name === 'Motor'),
    surface = before.connections.find(
      (c) => c.kind === 'fixed' && (c.a.part === motor.id || c.b.part === motor.id),
    );
  browserEvidence.assert('ok', [surface?.a.surface && surface?.b.surface]);
  browserEvidence.assert('deepEqual', [detached.parts, before.parts, 'detach does not move parts']);
  browserEvidence.assert('deepEqual', [
    detached.connections,
    before.connections.filter((c) => c.id !== surface.id),
    'detach removes only the surface relationship, preserving shaft and power',
  ]);
  await page.locator('[data-command=undo]').click();
  browserEvidence.assert('deepEqual', [await read(), before]);
  await placeCatalogPart(page, 'poweredMotor');
  await page.locator('.port-button[data-port-id=power]').click();
  await page
    .getByRole('button', { name: 'Wire Cell · power (parts stay put)', exact: true })
    .click();
  browserEvidence.assert('equal', [
    (await read()).connections.filter((c) => c.kind === 'power').length,
    before.connections.filter((c) => c.kind === 'power').length + 1,
    'a second motor shares the cell through another visible wire',
  ]);
  const shared = await read();
  await placeCatalogPart(page, 'powerCell');
  await page.locator('.port-button[data-port-id=power]').click();
  await page
    .getByRole('button', { name: 'Wire Cell · power (parts stay put)', exact: true })
    .click();
  browserEvidence.assert('deepEqual', [
    (await read()).connections,
    shared.connections,
    'a second cell cannot join the circuit',
  ]);
  browserEvidence.assert('match', [
    await page.locator('.connection-targets [role=alert]').innerText(),
    /one cell/,
  ]);
  let twoMotors = createStarterVehicle();
  twoMotors.parts = twoMotors.parts.filter((p) =>
    ['frame', 'motor', 'cell', 'drive'].includes(p.id),
  );
  twoMotors.connections = twoMotors.connections.filter(
    (c) =>
      twoMotors.parts.some((p) => p.id === c.a.part) &&
      twoMotors.parts.some((p) => p.id === c.b.part),
  );
  twoMotors.parts.push(
    createPart('poweredMotor', 'motor2', [2, 0.4, 0]),
    createPart('powerCell', 'cell2', [2, 0.4, 1]),
    createPart('gripWheel', 'wheel2', [2, 0.4, -1]),
  );
  twoMotors.parts.find((p) => p.id === 'wheel2').name = 'Second wheel';
  const a = { part: 'frame', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    b = { part: 'motor2', surface: { region: 'left', u: 0, v: 0, twist: 0 } };
  twoMotors = snapConnection(twoMotors, a, b);
  twoMotors.connections.push(
    { id: 'second-mount', kind: 'fixed', a, b },
    {
      id: 'second-power',
      kind: 'power',
      a: { part: 'cell2', port: 'power' },
      b: { part: 'motor2', port: 'power' },
    },
  );
  writeFileSync(
    browserArtifactPath('artifacts/feedback-fixes/two-motors.json'),
    JSON.stringify(twoMotors),
  );
  await page
    .locator('input[type=file]')
    .setInputFiles(browserArtifactPath('artifacts/feedback-fixes/two-motors.json'));
  await select('Second wheel');
  await page.locator('.port-button[data-port-id=axle]').click();
  await page
    .getByRole('button', {
      name: 'Attach to Powered Motor · shaft Moves Second wheel',
      exact: true,
    })
    .click();
  browserEvidence.assert('equal', [
    (await read()).connections.filter((c) => c.kind === 'shaft').length,
    2,
    'second motor wheel snaps on the same chassis',
  ]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => window.workshopProbe.observe().frames[0].tick >= 120);
  await page.locator('[data-command=pause]').click();
  const running = await page.evaluate(() => window.workshopProbe.observe().frames[0]);
  browserEvidence.assert('ok', [
    running.power.motors.every((m) => m.shaftWorkJ > 0),
    'both motors physically deliver work',
  ]);
  await page.screenshot({ path: browserArtifactPath('artifacts/feedback-fixes/two-motors.png') });
  await page.locator('[data-command=build]').click();
  const diameter = page.getByLabel('Wheel diameter (mm)', { exact: true });
  const beforeSize = await read();
  await diameter.fill('405');
  browserEvidence.assert('deepEqual', [
    await read(),
    beforeSize,
    'diameter input previews without changing authored state',
  ]);
  await diameter.press('Tab');
  await page.waitForFunction(
    () =>
      window.workshopProbe
        .observe()
        .frames[0].metadata.blueprint.parts.find((p) => p.id === 'wheel2').parameters.diameter ===
      0.405,
  );
  await page.screenshot({
    path: browserArtifactPath('artifacts/feedback-fixes/wheel-diameter.png'),
  });
  browserEvidence.assert('deepEqual', [errors, []]);
  browserEvidence.assertUnchanged();
  writeFileSync(
    browserArtifactPath('artifacts/feedback-fixes/ports.json'),
    JSON.stringify(
      {
        ...browserEvidence.identity,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        errors,
        checks: [
          'occupied shaft and power ports inspect without mutation',
          'occupied ports cannot add another attachment',
          'surface attachment has status, adjust and detach without duplicate sockets',
          'adjust cancel preserves blueprint',
          'detach preserves shaft and power; undo restores exact blueprint',
          'rotating wheel attachment explained',
        ],
      },
      null,
      2,
    ),
  );
  console.log('port explanation browser passed');
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
