import { deterministicProjection } from '../src/model/tick.mjs';
import { rotateVector } from '../src/model/transforms.mjs';
import { proposeSurfaceMount } from '../src/model/assembly.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
const out = browserArtifactPath('artifacts/lamp-performance');
mkdirSync(out, { recursive: true });
let bp = createEmptyBlueprint('lamp-workload', 'Eight mounted lamps');
bp.parts.push(createPart('chassis', 'base', [0, 0.12, 0]));
for (let i = 0; i < 8; i++) {
  bp.parts.push(createPart('poweredLamp', `lamp${i}`, [i + 1, 1, 0]));
  bp = proposeSurfaceMount(bp, {
    part: `lamp${i}`,
    sourceRegion: 'bottom',
    targetPart: 'base',
    targetRegion: 'top',
    u: i % 2 === 0 ? -0.07 : 0.07,
    v: (Math.floor(i / 2) - 1.5) * 0.1,
    twist: 0,
    id: `mount${i}`,
  }).blueprint;
}
bp.parts.push(createPart('powerCell', 'cell', [-1, 1, 0]));
bp = proposeSurfaceMount(bp, {
  part: 'cell',
  sourceRegion: 'bottom',
  targetPart: 'base',
  targetRegion: 'bottom',
  u: 0,
  v: 0,
  twist: 0,
  id: 'cell-mount',
}).blueprint;
const receiver = createPart('commandReceiver', 'receiver', [0.8, 0.05, 0]);
receiver.parameters.duty = 1;
bp.parts.push(receiver);
for (const l of bp.parts.filter((p) => p.type === 'poweredLamp'))
  bp.connections.push(
    {
      id: `w${l.id}`,
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: l.id, port: 'power' },
    },
    {
      id: `s${l.id}`,
      kind: 'signal',
      a: { part: 'receiver', port: 'signal' },
      b: { part: l.id, port: 'signal' },
    },
  );
writeFileSync(`${out}/eight.json`, JSON.stringify(bp));
const evidence = createBrowserEvidence(),
  browser = await evidence.launch({
    profile: 'performance',
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
  });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
  await page.addInitScript(() => {
    window.lampSlow = false;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => (window.lampSlow ? setTimeout(() => cb(performance.now()), 45) : cb(t)));
  });
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await evidence.loadAndWait(page, `${out}/eight.json`);
  await page.locator('[data-command=run]').click();
  const sample = await page.evaluate(async () => {
    const cadence = [];
    let before;
    for (let i = 0; i < 151; i++)
      await new Promise((r) =>
        requestAnimationFrame((t) => {
          if (i > 60) cadence.push(t - before);
          before = t;
          r();
        }),
      );
    const gl = document.querySelector('canvas').getContext('webgl2'),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      cadence,
      rendering: window.workshopProbe.readInteractionState().rendering,
      lamps: window.workshopProbe.readInteractionState().lamps,
      renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
      frame: JSON.parse(window.render_game_to_text()),
    };
  });
  const p95 = (x) => [...x].sort((a, b) => a - b)[Math.floor((x.length - 1) * 0.95)];
  const report = {
    ...evidence.identity,
    cpu: cpus()[0]?.model,
    sample,
    cadenceP95: p95(sample.cadence),
    renderP95: p95(sample.rendering.costsMs.slice(-90)),
  };
  writeFileSync(`${out}/measurement.json`, JSON.stringify(report, null, 2));
  assert.equal(sample.lamps.length, 8);
  for (const l of sample.lamps) {
    const i = sample.frame.metadata.blueprint.parts.findIndex((p) => p.id === l.id),
      body = sample.frame.physics[i];
    const offset = rotateVector(body.rotation, [0, 0, 0.045]);
    for (let axis = 0; axis < 3; axis++)
      assert.ok(
        Math.abs(l.position[axis] - body.position[axis] - offset[axis]) < 1e-8,
        'rendered lamp origin follows completed body',
      );
  }
  assert.ok(sample.lamps.every((l) => l.flux > 0 && l.intensity > 0 && !l.shadows));
  assert.equal(sample.frame.status, 'ready');
  assert.ok(report.cadenceP95 <= 40, `cadence ${report.cadenceP95}`);
  assert.ok(report.renderP95 <= 6, `render ${report.renderP95}`);
  assert.ok(Math.max(...sample.cadence) <= 500);
  await page.screenshot({ path: `${out}/eight-on.png` });
  const waitTicks = async () => {
    const t = await page.evaluate(() => JSON.parse(window.render_game_to_text()).tick);
    await page.waitForFunction((t) => JSON.parse(window.render_game_to_text()).tick >= t + 12, t);
  };
  await page.keyboard.down('w');
  await waitTicks();
  const centers = await page.evaluate(() => window.workshopProbe.readRenderedCenters());
  const on = await page.locator('canvas').first().screenshot();
  await page.keyboard.up('w');
  await waitTicks();
  const off = await page.locator('canvas').first().screenshot();
  const pixels = await page.evaluate(
    async ({ on, off, centers }) => {
      const decode = async (src) => {
        const img = new Image();
        img.src = 'data:image/png;base64,' + src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return {
          width: img.width,
          height: img.height,
          data: ctx.getImageData(0, 0, img.width, img.height).data,
        };
      };
      const a = await decode(on),
        b = await decode(off);
      let brightened = 0;
      let maxDelta = 0;
      // Exclude every rendered part center with generous 50px padding: lens-only emission cannot pass.
      for (let y = 0; y < a.height; y++)
        for (let x = 0; x < a.width; x++) {
          if (
            centers.some(
              (c) =>
                Math.hypot(x - (c.x * 0.5 + 0.5) * a.width, y - (-c.y * 0.5 + 0.5) * a.height) < 50,
            )
          )
            continue;
          const i = (y * a.width + x) * 4;
          const d =
            a.data[i] + a.data[i + 1] + a.data[i + 2] - b.data[i] - b.data[i + 1] - b.data[i + 2];
          if (d > 12) brightened++;
          maxDelta = Math.max(maxDelta, d);
        }
      return { brightened, maxDelta };
    },
    { on: on.toString('base64'), off: off.toString('base64'), centers },
  );
  writeFileSync(`${out}/pixels.json`, JSON.stringify(pixels));
  assert.ok(pixels.brightened > 300, 'powered beams must illuminate floor beyond the lenses');
  assert.ok(
    (await page.evaluate(() => window.workshopProbe.readInteractionState().lamps)).every(
      (l) => l.flux === 0 && l.emission === 0,
    ),
  );
  await page.keyboard.down('w');
  await waitTicks();
  // Slow presentation frames exercise real adaptive quality without changing simulation inputs.
  await page.evaluate(() => {
    window.lampSlow = true;
  });
  await page.waitForFunction(
    () => window.workshopProbe.readInteractionState().rendering.quality.level >= 3,
    {},
    { timeout: 30000 },
  );
  await page.evaluate(() => {
    window.lampSlow = false;
  });
  const after = await page.evaluate(() => ({
    ui: window.workshopProbe.readInteractionState(),
    frame: JSON.parse(window.render_game_to_text()),
  }));
  assert.equal(after.ui.lamps.length, 8);
  assert.ok(after.ui.lamps.every((l) => l.flux > 0));
  assert.deepEqual(after.frame.metadata.blueprint, sample.frame.metadata.blueprint);
  for (let i = 0; i < 8; i++) {
    assert.equal(after.frame.power.lamps[i].requestedW, sample.frame.power.lamps[i].requestedW);
    assert.equal(after.frame.power.lamps[i].command, sample.frame.power.lamps[i].command);
    assert.equal(after.frame.power.lamps[i].deliveredW, sample.frame.power.lamps[i].deliveredW);
    const l = after.frame.power.lamps[i];
    assert.ok(l.deliveredEnergyJ > 0 && l.steps === after.frame.tick);
  }
  await page.screenshot({ path: `${out}/eight-reduced.png` });
  writeFileSync(
    `${out}/quality.json`,
    JSON.stringify(
      { ...evidence.identity, quality: after.ui.rendering.quality, power: after.frame.power },
      null,
      2,
    ),
  );
  // Re-run the same authored machine to the same tick at Full and Low quality.
  // Compare the complete deterministic projection, including cumulative cell/lamp energy.
  const runAtFixedTick = async (targetPage) => {
    await evidence.loadAndWait(targetPage, `${out}/eight.json`);
    await targetPage.locator('[data-command=run]').click();
    return targetPage.evaluate(() => {
      window.advanceTime(0);
      const read = () => JSON.parse(window.render_game_to_text());
      const target = 240;
      if (read().tick >= target) throw Error('fixed-tick capture started too late');
      while (read().tick < target) window.advanceTime(1000 / 120);
      return {
        frame: read(),
        quality: window.workshopProbe.readInteractionState().rendering.quality,
      };
    });
  };
  await page.keyboard.up('w');
  const reduced = await runAtFixedTick(page);
  assert.equal(reduced.quality.level, 3);
  const controlPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await evidence.goto(controlPage, process.argv[2] ?? 'http://127.0.0.1:4173/');
    const full = await runAtFixedTick(controlPage);
    assert.equal(full.quality.level, 0);
    assert.deepEqual(deterministicProjection(reduced.frame), deterministicProjection(full.frame));
    writeFileSync(
      `${out}/quality-equivalence.json`,
      JSON.stringify(
        {
          ...evidence.identity,
          tick: full.frame.tick,
          full: full.quality,
          reduced: reduced.quality,
          projection: deterministicProjection(full.frame),
          matched: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await controlPage.close();
  }
  evidence.assertUnchanged();
} catch (e) {
  await evidence.captureFailure(e);
  throw e;
} finally {
  await browser.close();
}
