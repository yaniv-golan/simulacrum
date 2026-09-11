import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';
import { createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { createSpringStrut } from '../src/model/fixtures/spring-playground.mjs';
import { insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { springQuantile, SPRING_PERFORMANCE } from './measure-springs.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = browserArtifactPath('artifacts/adaptive-graphics');
mkdirSync(out, { recursive: true });
let blueprint = createEmptyBlueprint('adaptive-check', 'Springs');
for (let i = 0; i < 8; i++)
  blueprint = insertAssembly(
    blueprint,
    createSpringStrut(),
    [i * 0.6, 0.02, 0],
    [0, 0, 0, 1],
  ).blueprint;
writeFileSync(`${out}/fixture.json`, JSON.stringify(blueprint));
const reports = [];
for (const backend of process.platform === 'darwin' ? ['metal', 'swiftshader'] : ['swiftshader']) {
  const evidence = createBrowserEvidence();
  const browser = await evidence.launch({
    profile: 'performance',
    args:
      backend === 'metal'
        ? ['--use-angle=metal']
        : ['--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
    await evidence.loadAndWait(page, `${out}/fixture.json`);
    const before = await page.evaluate(
      () => JSON.parse(window.render_game_to_text()).metadata.blueprint,
    );
    await page.screenshot({ path: `${out}/${backend}-build.png` });
    evidence.assert('equal', [
      await page.evaluate(
        () => window.workshopProbe.readInteractionState().rendering.quality.level,
      ),
      0,
    ]);
    await page.locator('[data-command=run]').click();
    const sample = await page.evaluate(async () => {
      const timeline = [];
      const waitFrames = (n, collect) =>
        new Promise((resolve) => {
          let previous;
          const tick = (now) => {
            if (previous !== undefined) collect?.(now - previous);
            previous = now;
            if (--n) requestAnimationFrame(tick);
            else resolve();
          };
          requestAnimationFrame(tick);
        });
      await waitFrames(360, () => {
        const q = window.workshopProbe.readInteractionState().rendering.quality;
        if (timeline.at(-1)?.level !== q.level) timeline.push({ ...q, at: performance.now() });
      });
      const start = performance.now(),
        startTick = JSON.parse(window.render_game_to_text()).tick,
        cadence = [];
      await waitFrames(91, (ms) => cadence.push(ms));
      const frame = JSON.parse(window.render_game_to_text());
      const gl = document.querySelector('canvas').getContext('webgl2'),
        debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        drawingSize: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        cssSize: [
          document.querySelector('canvas').clientWidth,
          document.querySelector('canvas').clientHeight,
        ],
        timeline,
        cadence,
        elapsedMs: performance.now() - start,
        startTick,
        endTick: frame.tick,
        status: frame.status,
        blueprint: frame.metadata.blueprint,
        visible: !document.hidden,
        rendering: window.workshopProbe.readInteractionState().rendering,
        renderer: debug
          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
      };
    });
    reports.push({ ...evidence.identity, backend, ...sample });
    await page.screenshot({ path: `${out}/${backend}-run.png` });
    const png = await page.locator('canvas').screenshot();
    const visibleFraction = await page.evaluate(async (base64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          Math.abs(pixels[i] - 24) + Math.abs(pixels[i + 1] - 37) + Math.abs(pixels[i + 2] - 45) >
          30
        )
          visible++;
      return visible / (img.width * img.height);
    }, png.toString('base64'));
    evidence.assert('ok', [visibleFraction > 0.05, 'scene disappeared during quality transition']);
    reports.at(-1).visibleFraction = visibleFraction;
    evidence.assert('equal', [sample.visible, true]);
    evidence.assert('equal', [sample.status, 'ready']);
    evidence.assert('deepEqual', [sample.blueprint, before]);
    evidence.assert('ok', [
      springQuantile(sample.cadence) <= SPRING_PERFORMANCE.cadenceP95Ms,
      `${backend}: cadence p95 ${springQuantile(sample.cadence)} exceeds 40 ms`,
    ]);
    evidence.assert('ok', [Math.max(...sample.cadence) <= SPRING_PERFORMANCE.stallMs]);
    evidence.assert('ok', [
      springQuantile(sample.rendering.costsMs.slice(-90)) <= SPRING_PERFORMANCE.renderP95Ms,
      'renderer CPU exceeds budget',
    ]);
    const ratio = (sample.endTick - sample.startTick) / 120 / (sample.elapsedMs / 1000);
    evidence.assert('ok', [ratio >= 0.95 && ratio <= 1.05, `real-time ratio ${ratio}`]);
    // Actual backend identity, never a hardware-name quality decision in the product.
    if (backend === 'swiftshader') evidence.assert('ok', [/swiftshader/i.test(sample.renderer)]);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.locator('[data-command=build]').click();
    evidence.assert('deepEqual', [
      await page.evaluate(() => JSON.parse(window.render_game_to_text()).metadata.blueprint),
      before,
    ]);
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 900, height: 650 },
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${out}/${backend}-${viewport.width}-build.png` });
      const sizing = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        return {
          width: canvas.width,
          css: canvas.clientWidth,
          ratio: window.workshopProbe.readInteractionState().rendering.pixelRatio,
        };
      });
      evidence.assert('ok', [Math.abs(sizing.width - sizing.css * sizing.ratio) <= 1]);
    }
    evidence.assert('deepEqual', [evidence.errors, []]);
    evidence.assertUnchanged();
  } catch (error) {
    await evidence.captureFailure(error);
    throw error;
  } finally {
    writeFileSync(`${out}/result.json`, JSON.stringify(reports, null, 2));
    await browser.close();
  }
}
