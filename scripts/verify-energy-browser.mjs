import { createBrowserEvidence } from './browser-evidence.mjs';

import { mkdirSync, writeFileSync } from 'node:fs';
import { sourceIdentity } from './source-identity.mjs';
const browserEvidence = createBrowserEvidence();

const out = 'artifacts/energy-browser';
mkdirSync(out, { recursive: true });
const source = sourceIdentity(),
  browser = await browserEvidence.launch({ profile: 'ui', ...{} }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = browserEvidence.errors;

try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.locator('input[type=file]').setInputFiles('test/fixtures/free-build-energy.json');
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const authored = (await read()).metadata.blueprint;
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).tick >= 120,
    {},
    { timeout: 10000 },
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const realTimeTick = (await read()).tick;
  await page.evaluate(() => {
    const t = JSON.parse(window.render_game_to_text()).tick;
    window.advanceTime(((6000 - t) * 1000) / 120);
  });
  const f = await read();
  browserEvidence.assert('equal', [f.status, 'ready']);
  browserEvidence.assert('equal', [f.tick, 6000]);
  browserEvidence.assert('deepEqual', [f.metadata.blueprint, authored]);
  browserEvidence.assert('ok', [
    f.power.cells[0].energyJ <
      authored.parts.find((p) => p.type === 'powerCell').parameters.capacityJ,
  ]);
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (let i = 0; i < authored.parts.length; i++) {
    const r = rendered.find((r) => r.id === authored.parts[i].id);
    browserEvidence.assert('deepEqual', [r.position, f.physics[i].position], { frame: f });
    browserEvidence.assert('deepEqual', [r.rotation, f.physics[i].rotation], { frame: f });
  }
  browserEvidence.assert('deepEqual', [errors, []]);
  await page.screenshot({ path: `${out}/6000-ticks.png` });
  browserEvidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify(
      {
        ...browserEvidence.identity,
        source,
        build: await page.locator('meta[name=build-id]').getAttribute('content'),
        realTimeTick,
        frame: f,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS real browser clock past original failure, 6000 production ticks, rendered/text agreement',
  );
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
