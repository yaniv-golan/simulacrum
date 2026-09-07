import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence();
const out = 'artifacts/connection-test-browser';
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
const read = () => page.evaluate(() => window.workshopProbe.observe().frames[0]);
async function duty(value) {
  await page.waitForFunction((value) => {
    const frame = window.workshopProbe.observe().frames[0];
    const index = frame.metadata.blueprint.parts.findIndex(
      (part) => part.type === 'commandReceiver',
    );
    return frame.power.sources.find((source) => source.node === index)?.duty === value;
  }, value);
}
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.getByRole('button', { name: 'Powered Motor', exact: true }).click();
  await section.waitFor({ state: 'visible' });
  await section.locator('summary').click();
  evidence.assert('match', [await section.innerText(), /Connect power/]);
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await page.getByText('More parts', { exact: true }).click();
  await page.getByRole('button', { name: 'Command Receiver', exact: true }).click();
  await page.getByRole('button', { name: 'Grip Wheel', exact: true }).click();
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
  const powerRow = section.locator('.connection-test-path').nth(0);
  await powerRow.hover();
  evidence.assert('deepEqual', [
    await page.evaluate(() => window.workshopProbe.readInteractionState().testConnectionIds),
    original.connections.filter((edge) => edge.kind === 'power').map((edge) => edge.id),
  ]);
  await section.locator('summary').click();
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
  await page.waitForFunction(() => {
    const frame = window.workshopProbe.observe().frames[0];
    return frame.power.motors.some((motor) => Math.abs(motor.current) > 0.001);
  });
  await page.waitForFunction(() => {
    const match = document
      .querySelector('.connection-test-live')
      ?.textContent.match(/shaft (-?[0-9.]+) rad/);
    return match && Math.abs(Number(match[1])) > 0.01;
  });
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
  await page.waitForFunction(
    (tick) => window.workshopProbe.observe().frames[0].tick > tick + 2,
    beforeKeyRelease,
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
  evidence.assert('deepEqual', [errors, []]);
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        checks: [
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
