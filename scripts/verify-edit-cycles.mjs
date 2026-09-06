import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './build-fingerprint.mjs';

const out = 'artifacts/edit-cycles';
mkdirSync(out, { recursive: true });
const source = sourceIdentity(), build = appFingerprint(), errors = [], samples = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('requestfailed', r => errors.push(`${r.url()}: ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const observe = () => page.evaluate(() => ({ frame: window.workshopProbe.observe().frames[0], transforms: window.workshopProbe.readRenderedTransforms() }));
function agree(state) {
  for (const [i, part] of state.frame.metadata.blueprint.parts.entries()) {
    const rendered = state.transforms.find(t => t.id === part.id);
    assert.deepEqual(rendered.position, state.frame.physics[i].position, `${part.id} position`);
    assert.deepEqual(rendered.rotation, state.frame.physics[i].rotation, `${part.id} rotation`);
  }
}
let served;
try {
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.workshopProbe);
  served = await page.locator('meta[name=build-id]').getAttribute('content');
  assert.equal(served, build);
  await page.locator('[data-command=start-guide]').click();
  for (let i = 0; i < 16; i++) {
    await page.locator('[data-command=guide-step]').click();
    await page.waitForFunction(n => { const b = window.workshopProbe.observe().frames[0].metadata.blueprint; return b.parts.length + b.connections.length === n; }, i + 1);
  }
  const initial = await observe();
  agree(initial);
  const wrong = structuredClone(initial);
  wrong.transforms[0].position[0] += 0.01;
  assert.throws(() => agree(wrong), /position/, 'comparison must reject a wrong rendered transform');
  writeFileSync(`${out}/negative-control.json`, JSON.stringify({ rejected: true, perturbation: 'rendered x +0.01m' }, null, 2));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  for (let cycle = 1; cycle <= 12; cycle++) {
    const before = (await observe()).frame.metadata.blueprint;
    await page.locator('[data-command=run]').click();
    await page.waitForFunction(() => window.workshopProbe.observe().cursor.tick >= 120);
    await page.locator('[data-command=pause]').click();
    const paused = await observe();
    agree(paused);
    assert.deepEqual(paused.frame.metadata.blueprint, before, 'running preserves authored blueprint');
    await page.locator('[data-command=build]').click();
    const reset = await observe();
    agree(reset);
    assert.deepEqual(reset.frame.metadata.blueprint, before, 'Build preserves authored blueprint');
    for (const [i, part] of before.parts.entries()) assert.deepEqual(reset.frame.physics[i].position, part.position.map(Math.fround), 'Build resets authored position at physics float32 precision');
    if (!await page.locator('.machine-picker').evaluate(el => el.open)) await page.locator('.machine-picker > summary').click();
    await page.locator('.part-list [data-part-id="guide-motor"]').click();
    const drive = page.getByRole('spinbutton', { name: 'Drive setting', exact: true });
    await drive.fill(cycle % 2 ? '0.3' : '0.5');
    await drive.press('Tab');
    await page.waitForFunction(value => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.find(p => p.id === 'guide-motor').parameters.defaultDuty === value, cycle % 2 ? 0.3 : 0.5);
    const edited = (await observe()).frame.metadata.blueprint;
    assert.notDeepEqual(edited, before);
    await page.locator('[data-command=undo]').click();
    assert.deepEqual((await observe()).frame.metadata.blueprint, before);
    await page.locator('[data-command=redo]').click();
    assert.deepEqual((await observe()).frame.metadata.blueprint, edited);
    if (cycle === 6) {
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await (await pending).saveAs(`${out}/saved-machine.json`);
      await page.locator('[data-command=new]').click();
      await page.waitForFunction(() => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 0);
      await page.locator('input[type=file]').setInputFiles(`${out}/saved-machine.json`);
      await page.waitForFunction(() => window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length === 8);
      assert.deepEqual((await observe()).frame.metadata.blueprint, edited, 'download and reload preserve authored blueprint');
    }
    const state = await observe();
    agree(state);
    const counters = await cdp.send('Memory.getDOMCounters');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
    samples.push({ cycle, tick: paused.frame.tick ?? null, cursor: await page.evaluate(() => window.workshopProbe.observe().cursor), counters, liveDomNodes: await page.locator('*').count(), jsHeapUsedSize: metrics.JSHeapUsedSize, jsHeapTotalSize: metrics.JSHeapTotalSize, paused, state });
    writeFileSync(`${out}/progress.json`, JSON.stringify({ source, build, served, errors, samples }, null, 2));
  }
  assert.deepEqual(errors, []);
  assert.equal(appFingerprint(), build, 'application source unchanged during probe');
  await page.screenshot({ path: `${out}/completed.png` });
  writeFileSync(`${out}/result.json`, JSON.stringify({ source, finalSource: sourceIdentity(), build, served, browser: browser.version(), errors, samples, scope: '12 cycles; raw heap and DOM counters, no leak threshold or forced GC; first 2 cycles warmup; source may contain concurrent verifier-only edits' }, null, 2));
  console.log(JSON.stringify(samples.map(({ cycle, counters, liveDomNodes, jsHeapUsedSize }) => ({ cycle, counters, liveDomNodes, jsHeapUsedSize })), null, 2));
} catch (error) {
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  writeFileSync(`${out}/failure.json`, JSON.stringify({ source, build, served, errors, samples, message: error.message, stack: error.stack }, null, 2));
  throw error;
} finally {
  await browser.close();
}
