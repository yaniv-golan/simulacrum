import { liveWait } from './browser-idle.mjs';
import { placeCatalogPart, browseAllParts } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { CATALOG } from '../src/model/catalog.mjs';
import * as THREE from 'three';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence();
const out = browserArtifactPath('artifacts/connection-test-browser');
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui', ...{} });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = evidence.errors;

const section = page.getByRole('region', { name: 'Connect and test actuator' });
async function select(name) {
  const picker = page.locator('.machine-picker');
  if (!(await picker.evaluate((element) => element.open))) await picker.locator('summary').click();
  await picker.getByRole('button', { name, exact: true }).click();
}
const wiringState = () => page.evaluate(() => window.workshopProbe.readInteractionState().wiring);
const visibleElectrical = async () => {
  const state = await wiringState();
  const frame = await read();
  return state.connections
    .filter(
      (c) =>
        c.visible &&
        frame.metadata.blueprint.connections.some(
          (e) => e.id === c.id && ['power', 'signal'].includes(e.kind),
        ),
    )
    .map((c) => c.id)
    .sort();
};
const read = () => page.evaluate(() => window.workshopProbe.observe().frames[0]);
// A duty flip is the app reflecting a key or pointer hold; it is not a timing assertion, so
// the wait's budget is the check's watchdog, and a starved renderer fails as such.
async function duty(value) {
  await liveWait(
    page,
    (value) => {
      const frame = window.workshopProbe.observe().frames[0];
      const index = frame.metadata.blueprint.parts.findIndex(
        (part) => part.type === 'commandReceiver',
      );
      return frame.power.sources.find((source) => source.node === index)?.duty === value;
    },
    value,
    { label: `commandReceiver duty ${value}` },
  );
}
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await placeCatalogPart(page, 'poweredMotor');
  await section.waitFor({ state: 'visible' });
  await section.locator('summary').click();
  evidence.assert('match', [await section.innerText(), /Connect power/]);
  await placeCatalogPart(page, 'powerCell');
  await browseAllParts(page);
  await placeCatalogPart(page, 'commandReceiver');
  await placeCatalogPart(page, 'gripWheel');
  await page.getByRole('button', { name: /Wheel axle/ }).click();
  await page.getByRole('button', { name: /Attach to Powered Motor · shaft/ }).click();
  await select('Powered Motor');
  await section.locator('summary').click();
  await section.getByRole('button', { name: 'Connect power', exact: true }).click();
  await page.getByRole('button', { name: /Wire Power Cell · power/ }).click();
  await section.getByRole('button', { name: 'Connect control', exact: true }).click();
  await page.getByRole('button', { name: /Wire Command Receiver · signal/ }).click();
  evidence.assert('match', [await section.innerText(), /Power Cell/]);
  evidence.assert('match', [await section.innerText(), /Command Receiver/]);
  evidence.assert('match', [await section.innerText(), /Grip Wheel/]);
  const original = (await read()).metadata.blueprint;
  evidence.assert('equal', [original.parts.length, 4]);
  evidence.assert('equal', [original.connections.length, 3]);
  const wiring = page.getByRole('checkbox', { name: 'Wiring', exact: true });
  const electricalIds = original.connections
    .filter((e) => ['power', 'signal'].includes(e.kind))
    .map((e) => e.id)
    .sort();
  evidence.assert('equal', [await wiring.isChecked(), true]);
  await wiring.uncheck();
  evidence.assert('deepEqual', [
    await visibleElectrical(),
    electricalIds,
    'open panel reveals exact paths',
  ]);
  const powerRow = section.locator('.connection-test-path').nth(0);
  await powerRow.hover();
  evidence.assert('deepEqual', [
    await page.evaluate(() => window.workshopProbe.readInteractionState().testConnectionIds),
    original.connections.filter((edge) => edge.kind === 'power').map((edge) => edge.id),
  ]);
  await wiring.hover();
  evidence.assert('deepEqual', [
    await page.evaluate(() => window.workshopProbe.readInteractionState().testConnectionIds),
    [],
  ]);
  evidence.assert('deepEqual', [
    await visibleElectrical(),
    electricalIds,
    'pointer leave keeps panel reveal',
  ]);
  await section.locator('summary').click();
  await page.waitForFunction('document.querySelector(".wiring-notice").hidden');
  evidence.assert('deepEqual', [
    await visibleElectrical(),
    [],
    'ordinary selected motor does not reveal wiring',
  ]);
  await page.locator('[data-port-id=power]').click();
  await page.getByRole('button', { name: 'Trace Power → Power Cell', exact: true }).click();
  evidence.assert('deepEqual', [
    await visibleElectrical(),
    original.connections.filter((e) => e.kind === 'power').map((e) => e.id),
  ]);
  await page.getByRole('button', { name: 'Clear trace', exact: true }).click();
  evidence.assert('deepEqual', [await visibleElectrical(), []]);
  await page.locator('[data-port-id=power]').click();
  evidence.assert('deepEqual', [
    await visibleElectrical(),
    original.connections.filter((e) => e.kind === 'power').map((e) => e.id),
  ]);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await page.waitForFunction(
    () =>
      window.workshopProbe.readInteractionState().wiring.connections.filter((c) => c.visible)
        .length === 1,
  );
  evidence.assert('deepEqual', [await visibleElectrical(), []]);
  await page.waitForFunction('document.querySelector(".wiring-notice").hidden');
  await page.screenshot({ path: `${out}/build-hidden.png` });
  await wiring.check();
  await page.screenshot({ path: `${out}/build-schematic.png` });
  await wiring.uncheck();
  await page.waitForFunction('document.querySelector(".wiring-notice").hidden');
  await page.waitForFunction(
    'window.workshopProbe.readInteractionState().testConnectionIds.length === 0',
  );
  await page.waitForFunction(
    'window.workshopProbe.readInteractionState().wiring.preference === false',
  );
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().testConnectionIds?.length === 0,
  );
  evidence.assert('deepEqual', [
    await page.evaluate(() => window.workshopProbe.readInteractionState().testConnectionIds),
    [],
  ]);
  evidence.assert('deepEqual', [(await read()).metadata.blueprint, original]);
  await section.locator('summary').click();
  await page.screenshot({ path: `${out}/wired.png` });
  await section.getByRole('button', { name: 'Test in Run', exact: true }).click();
  const plus = section.getByRole('button', { name: /Hold \+ through/ });
  await plus.focus();
  await page.keyboard.down('Enter');
  await duty(1);
  // Simulation progress under a held key is app work, not a timing budget: live waits.
  await liveWait(
    page,
    () => {
      const frame = window.workshopProbe.observe().frames[0];
      return frame.power.motors.some((motor) => Math.abs(motor.current) > 0.001);
    },
    null,
    { label: 'motor current under the held key' },
  );
  await liveWait(
    page,
    () => {
      const match = document
        .querySelector('.connection-test-live')
        ?.textContent.match(/shaft (-?[0-9.]+) rad/);
      return match && Math.abs(Number(match[1])) > 0.01;
    },
    null,
    { label: 'shaft readout under the held key' },
  );
  await page.keyboard.up('Enter');
  await duty(0);
  evidence.assert('match', [
    await section.locator('.connection-test-live').innerText(),
    /A · shaft .*rad\/s/,
  ]);
  await page.screenshot({ path: `${out}/tested.png` });
  const box = await plus.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await duty(1);
  await page.mouse.up();
  await duty(0);
  await page.keyboard.down('w');
  await duty(1);
  const minus = section.getByRole('button', { name: /Hold − through/ });
  const minusBox = await minus.boundingBox();
  await page.mouse.move(minusBox.x + minusBox.width / 2, minusBox.y + minusBox.height / 2);
  await page.mouse.down();
  await duty(-1);
  await page.mouse.up();
  await duty(1);
  await page.keyboard.up('w');
  await duty(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await duty(1);
  await page.keyboard.down('w');
  const beforeKeyRelease = (await read()).tick;
  await page.keyboard.up('w');
  await liveWait(
    page,
    (tick) => window.workshopProbe.observe().frames[0].tick > tick + 2,
    beforeKeyRelease,
    { label: 'two ticks after key release' },
  );
  await duty(1);
  await page.mouse.up();
  await duty(0);
  await plus.focus();
  await page.keyboard.down('Enter');
  await duty(1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.keyboard.up('Enter');
  await duty(0);
  await page.mouse.down();
  await duty(1);
  await plus.dispatchEvent('pointercancel');
  await page.mouse.up();
  await duty(0);
  await section.getByRole('button', { name: 'Return to Build', exact: true }).click();
  await page.waitForFunction(
    () => window.workshopProbe.observe().frames[0].metadata.mode === 'build',
  );
  evidence.assert('deepEqual', [
    (await read()).metadata.blueprint,
    original,
    'testing preserves authored settings and wires',
  ]);
  evidence.assert('equal', [await plus.isDisabled(), true]);
  // Replay fixed ticks with the same ordinary controls and different overlay preferences.
  await section.locator('summary').click();
  async function projection(show) {
    await page.locator('[data-command=build]').click();
    await page.evaluate(async () => {
      document.querySelector('[data-command=run]').click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
      document.querySelector('[data-command=pause]').click();
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    await wiring.setChecked(show);
    for (let i = 0; i < 12; i++) await page.locator('[data-command=step]').click();
    const snapshot = await page.evaluate(() => ({
      frame: window.workshopProbe.observe().frames[0],
      poses: window.workshopProbe.readRenderedTransforms(),
      wiring: window.workshopProbe.readInteractionState().wiring,
    }));
    for (const edge of snapshot.frame.metadata.blueprint.connections.filter((e) =>
      ['power', 'signal'].includes(e.kind),
    )) {
      const actual = snapshot.wiring.connections.find((c) => c.id === edge.id).endpoints[0];
      const expected = [edge.a, edge.b].flatMap((endpoint) => {
        const part = snapshot.frame.metadata.blueprint.parts.find((p) => p.id === endpoint.part);
        const pose = snapshot.poses.find((p) => p.id === endpoint.part);
        return new THREE.Vector3(
          ...CATALOG[part.type].ports.find((p) => p.id === endpoint.port).position,
        )
          .applyQuaternion(new THREE.Quaternion(...pose.rotation))
          .add(new THREE.Vector3(...pose.position))
          .toArray();
      });
      evidence.assert('ok', [
        actual.every((n, i) => Math.abs(n - expected[i]) < 1e-6),
        'line endpoints match displayed transformed ports',
      ]);
    }
    evidence.assert('equal', [await wiring.isChecked(), show]);
    evidence.assert('equal', [(await visibleElectrical()).length, show ? 2 : 0]);
    await page.screenshot({ path: `${out}/paused-${show ? 'shown' : 'hidden'}.png` });
    return deterministicProjection(snapshot.frame);
  }
  const hiddenProjection = await projection(false);
  const shownProjection = await projection(true);
  evidence.assert('deepEqual', [
    shownProjection,
    hiddenProjection,
    'overlay has no physical or network effect',
  ]);
  await page.locator('[data-command=run]').click();
  evidence.assert('equal', [await wiring.isChecked(), true, 'resume retains run preference']);
  await page.locator('[data-command=build]').click();
  evidence.assert('equal', [await wiring.isChecked(), false, 'restores build preference']);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
  evidence.assert('equal', [
    await wiring.isChecked(),
    false,
    'blueprint replacement retains preference',
  ]);
  evidence.assert('equal', [
    (await wiringState()).connections.length,
    0,
    'removed resources disappear',
  ]);
  await evidence.reload(page);
  evidence.assert('equal', [await wiring.isChecked(), true, 'reload defaults build on']);
  await page.locator('[data-command=run]').click();
  await page.locator('[data-command=pause]').click();
  evidence.assert('equal', [await wiring.isChecked(), false, 'reload defaults paused/run off']);
  evidence.assert('deepEqual', [errors, []]);
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        checks: [
          'Build/Run/Paused preferences, blueprint replacement and reload defaults',
          'exact trace and source reveals; panel reveal survives row pointer leave',
          'schematic endpoints agree with moving displayed ports',
          'identical fixed-tick deterministic projections with wiring shown and hidden',
          'empty workbench UI wiring',
          'ordinary powered run',
          'keyboard release',
          'pointer release',
          'pointer cancellation',
          'blur release',
          'return to Build preserves authored machine',
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log('connection test browser passed');
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  try {
    evidence.assertUnchanged();
  } finally {
    await browser.close();
  }
}
