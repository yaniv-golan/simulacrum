import { createBrowserEvidence } from './browser-evidence.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts/ux-repairs', { recursive: true });

const browserEvidence = createBrowserEvidence();

const b = await browserEvidence.launch({ profile: 'ui', ...{} }),
  p = await b.newPage();
try {
  await browserEvidence.goto(p, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await p.waitForFunction(() => window.workshopProbe);
  await p.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) await p.locator('[data-command=guide-step]').click();
  await p.locator('.machine-picker > summary').click();
  await p
    .locator('.part-list-item')
    .filter({ hasText: /^Drive wheel$/ })
    .click();
  browserEvidence.assert('match', [
    await p.locator('.mount-status').innerText(),
    /Axle attached to/,
  ]);
  browserEvidence.assert('doesNotMatch', [
    await p.locator('.mount-status').innerText(),
    /Not mounted|Unattached/,
  ]);
  browserEvidence.assert('equal', [
    await p.getByRole('button', { name: 'Snap to surface', exact: true }).isEnabled(),
    true,
  ]);
  await p.screenshot({ path: 'artifacts/ux-repairs/attached.png' });
  console.log('PASS axle status');
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await b.close();
  }
}
