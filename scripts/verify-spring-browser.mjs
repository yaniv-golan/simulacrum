import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const evidence = createBrowserEvidence(),
  out = 'artifacts/spring-browser';
mkdirSync(out, { recursive: true });
const browser = await evidence.launch({ profile: 'ui' }),
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  await page.getByRole('button', { name: 'Learn & examples', exact: true }).click();
  await page.locator('.spring-experiments > summary').click();
  await page.locator('[data-command=spring-example]').click();
  let f = await read();
  evidence.assert('equal', [f.metadata.blueprint.parts.length, 6]);
  const stiffness = page.getByRole('spinbutton', { name: 'Stiffness · Soft / Firm', exact: true });
  evidence.assert('equal', [await stiffness.inputValue(), '200']);
  await stiffness.fill('999');
  await stiffness.press('Tab');
  evidence.assert('equal', [await stiffness.inputValue(), '200']);
  evidence.assert('ok', [
    (await page.locator('.spring-setting [role=status]').allTextContents()).some((t) =>
      t.includes('Kept 200'),
    ),
  ]);
  const minimum = page.getByRole('spinbutton', { name: 'Minimum length', exact: true });
  await minimum.fill('0.35');
  evidence.assert('ok', [
    (await page.locator('.spring-setting [role=status]').allTextContents()).some((t) =>
      t.includes('zero-force length within travel'),
    ),
  ]);
  await minimum.press('Tab');
  evidence.assert('equal', [await minimum.inputValue(), '0.08']);
  await stiffness.fill('250');
  await stiffness.press('Tab');
  f = await read();
  evidence.assert('equal', [
    f.metadata.blueprint.parts.find((p) => p.id === 'guide').parameters.stiffness,
    250,
  ]);
  await page
    .getByRole('spinbutton', { name: 'Damping · More bounce / Less bounce', exact: true })
    .fill('12');
  await page
    .getByRole('spinbutton', { name: 'Damping · More bounce / Less bounce', exact: true })
    .press('Tab');
  f = await read();
  evidence.assert('equal', [
    f.metadata.blueprint.parts.find((p) => p.id === 'guide').parameters.damping,
    12,
  ]);
  await page.locator('[data-command=run]').click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).tick >= 120);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  f = await read();
  evidence.assert('ok', [f.springs[0].length < 0.29], { frame: f });
  evidence.assert('ok', [Math.abs(f.energy.balanceResidualJ) < 1e-5], { frame: f });
  const rendered = await page.evaluate(() => window.workshopProbe.readRenderedTransforms());
  for (let i = 0; i < f.metadata.blueprint.parts.length; i++)
    evidence.assert(
      'deepEqual',
      [
        rendered.find((r) => r.id === f.metadata.blueprint.parts[i].id).position,
        f.physics[i].position,
      ],
      { frame: f },
    );
  await page.screenshot({ path: `${out}/loaded.png` });
  evidence.assert('deepEqual', [evidence.errors, []]);
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/result.json`,
    JSON.stringify({ ...evidence.identity, frame: f, errors: evidence.errors }, null, 2),
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
