import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { appFingerprint } from './build-fingerprint.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const browserEvidence = createBrowserEvidence();

const identity = appFingerprint();
const browser = await browserEvidence.launch({ profile: 'ui', ...{ headless: true } });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } }),
  errors = browserEvidence.errors;

try {
  await browserEvidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:5173/test/browser/');
  await page.waitForFunction(() => window.probe);
  await page.click('#start-btn');
  await page.waitForFunction(() => window.probe.session.observe().cursor.tick >= 120);
  await page.click('#pause');
  const data = await page.evaluate(() => ({
    trace: window.probe.trace(),
    configuration: window.probe.configuration,
    text: JSON.parse(window.render_game_to_text()),
  }));
  const reference = await createSession(data.configuration);
  try {
    const expected = [];
    for (let tick = 0; tick <= 120; tick++) {
      expected.push(deterministicProjection(reference.observe().frames.at(-1)));
      if (tick < 120) reference.step(1);
    }
    const actual = data.trace.filter((f) => f.tick <= 120);
    browserEvidence.assert('deepEqual', [
      actual,
      expected,
      'real requestAnimationFrame trace must equal fixed-tick trace',
    ]);
    browserEvidence.assert('deepEqual', [
      data.text.physics,
      data.trace.at(-1).physics,
      'text mirror must match last published frame',
    ]);
    browserEvidence.assert('deepEqual', [errors, []]);
    browserEvidence.assert('equal', [
      appFingerprint(),
      identity,
      'source changed during browser verification',
    ]);
    mkdirSync(browserArtifactPath('artifacts/browser-m1'), { recursive: true });
    await page.screenshot({ path: browserArtifactPath('artifacts/browser-m1/raf.png') });
    const result = {
      ...browserEvidence.identity,
      app: identity,
      runtime: process.version,
      browser: browser.version(),
      ticks: 120,
      clock: 'real-requestAnimationFrame',
      digest: createHash('sha256').update(JSON.stringify(actual)).digest('hex'),
      errors,
    };
    browserEvidence.assertUnchanged();
    writeFileSync(
      browserArtifactPath('artifacts/browser-m1/raf.json'),
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result));
  } finally {
    reference.dispose();
  }
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
