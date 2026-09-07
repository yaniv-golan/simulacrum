import { createBrowserEvidence } from './browser-evidence.mjs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PART_EXAMPLES } from '../src/presentation/part-help-content.mjs';
import { examplePortLabel } from '../src/presentation/part-help-diagram.mjs';
const temporary = mkdtempSync(join(tmpdir(), 'help-window-'));
const extension = join(temporary, 'extension');
mkdirSync(extension);
writeFileSync(
  join(extension, 'manifest.json'),
  JSON.stringify({
    manifest_version: 3,
    name: 'Browser zoom test',
    version: '1.0',
    permissions: ['tabs'],
    background: { service_worker: 'worker.js' },
  }),
);
writeFileSync(join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
let persistent;
const evidence = createBrowserEvidence({
  name: 'part-help-window',
  launchBrowser: async (options) => {
    persistent = await chromium.launchPersistentContext(join(temporary, 'profile'), {
      ...options,
      channel: 'chromium',
      viewport: { width: 1280, height: 720 },
      args: [
        ...(options.args ?? []),
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    const browser = persistent.browser();
    return new Proxy(browser, {
      get(target, key) {
        if (key === 'newContext') return async () => persistent;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  },
});
const out = 'artifacts/part-help-window';
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
let browser;
const equal = (actual, expected, message) =>
  evidence.assert('deepEqual', [actual, expected, message]);
const ok = (actual, message) => evidence.assert('ok', [actual, message]);
try {
  browser = await evidence.launch({ profile: 'ui' });
  const p = await browser.newPage();
  p.setDefaultTimeout(3500);
  await evidence.goto(
    p,
    `http://127.0.0.1:${server.httpServer.address().port}/test/browser/part-help-fixture.html`,
  );
  await p.waitForFunction(() => window.helpFixture);
  const resources = () => p.evaluate(() => window.helpFixture.resources());
  const baseline = await resources();
  await p.evaluate(() => window.helpFixture.mount());
  const mounted = await resources();
  ok(
    mounted.listeners > baseline.listeners && mounted.observers > baseline.observers,
    'resource witness detects a live owner before disposal',
  );
  const open = async (name) => {
    await p.getByRole('button', { name: `About ${name}`, exact: true }).click();
    await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
  };
  await open('Grip Wheel');
  const rect = () => p.locator('.part-help').boundingBox();
  // Actual native CSS resize, not a style assignment masquerading as a drag.
  const before = await rect();
  await p.mouse.move(before.x + before.width - 3, before.y + before.height - 3);
  await p.mouse.down();
  await p.mouse.move(before.x + before.width - 83, before.y + before.height - 73, { steps: 8 });
  await p.mouse.up();
  const resized = await rect();
  ok(
    resized.width < before.width - 50 && resized.height < before.height - 40,
    'native resize changes both dimensions',
  );
  await p.getByRole('button', { name: 'Expand help window' }).click();
  const expanded = await rect();
  ok(expanded.width > resized.width, 'expand actually enlarges the window');
  await p.getByRole('button', { name: 'Restore help window' }).click();
  equal(await rect(), resized, 'restore returns exact position and size');
  await p.locator('.part-help h3').focus();
  await p.keyboard.press('Alt+ArrowRight');
  equal((await rect()).x, resized.x + 20, 'keyboard move');
  await p.keyboard.press('Alt+ArrowLeft');
  for (const event of ['pointercancel', 'lostpointercapture', 'blur']) {
    const start = await rect(),
      title = await p.locator('.part-help h3').boundingBox();
    await p.mouse.move(title.x + 15, title.y + 10);
    await p.mouse.down();
    await p.mouse.move(title.x + 35, title.y + 10, { steps: 4 });
    ok((await rect()).x > start.x, 'drag positive control');
    await p.evaluate(
      (event) =>
        event === 'blur'
          ? window.dispatchEvent(new Event(event))
          : document
              .querySelector('.part-help-titlebar')
              .dispatchEvent(new PointerEvent(event, { bubbles: true })),
      event,
    );
    const cancelled = await rect();
    await p.mouse.move(title.x + 60, title.y + 20, { steps: 4 });
    await p.mouse.up();
    equal(await rect(), cancelled, `${event} ends movement`);
  }
  const title = await p.locator('.part-help h3').boundingBox();
  await p.mouse.move(title.x + 10, title.y + 10);
  await p.mouse.down();
  await p.mouse.move(1279, 719, { steps: 8 });
  await p.mouse.up();
  const clamped = await rect();
  ok(
    clamped.x + clamped.width <= 1272 && clamped.y + clamped.height <= 712,
    'drag stays inside viewport',
  );
  await p.getByRole('button', { name: 'Expand help window' }).click();
  // Check actual rendered paths against canonical example endpoints and labels.
  async function diagramValid(index, example) {
    return p
      .locator('.part-help-example')
      .nth(index)
      .evaluate(
        (figure, example) => {
          const graph = figure.querySelector('.help-diagram'),
            paths = [...graph.querySelectorAll('.diagram-wire')];
          if (
            paths.length !== example.edges.length ||
            graph.querySelectorAll('.help-diagram-node').length !==
              Object.keys(example.nodes).length
          )
            return false;
          function hits(path, end, node) {
            const point = path
              .getPointAtLength(end ? path.getTotalLength() : 0)
              .matrixTransform(path.getScreenCTM());
            const r = node.getBoundingClientRect(),
              near = (a, b) => Math.abs(a - b) < 2;
            return (
              ((near(point.x, r.left) || near(point.x, r.right)) &&
                point.y >= r.top - 2 &&
                point.y <= r.bottom + 2) ||
              ((near(point.y, r.top) || near(point.y, r.bottom)) &&
                point.x >= r.left - 2 &&
                point.x <= r.right + 2)
            );
          }
          for (const [i, edge] of example.edges.entries()) {
            const a = graph.querySelector(`[data-example-node="${edge.a.node}"]`),
              b = graph.querySelector(`[data-example-node="${edge.b.node}"]`);
            if (!a || !b || !hits(paths[i], false, a) || !hits(paths[i], true, b)) return false;
            if (!paths[i].classList.contains(`diagram-wire-${edge.kind}`)) return false;
            if (
              ![...a.querySelectorAll('.help-diagram-port')].some(
                (n) => n.textContent === edge.a.label,
              ) ||
              ![...b.querySelectorAll('.help-diagram-port')].some(
                (n) => n.textContent === edge.b.label,
              )
            )
              return false;
          }
          return (
            [...graph.querySelectorAll('.diagram-edge-text')]
              .map((n) => n.textContent)
              .join(',') === example.edges.map((_, i) => i + 1).join(',') &&
            Object.entries(example.motions ?? {}).every(
              ([id, motion]) =>
                graph.querySelector(`[data-example-node="${id}"] .help-motion`)?.textContent ===
                motion,
            )
          );
        },
        {
          ...example,
          edges: example.edges.map((e) => ({
            ...e,
            a: { ...e.a, label: examplePortLabel(example.nodes[e.a.node], e.a.port) },
            b: { ...e.b, label: examplePortLabel(example.nodes[e.b.node], e.b.port) },
          })),
        },
      );
  }
  async function diagrams(width) {
    await p.setViewportSize({ width, height: 720 });
    for (const [name, ids] of [
      ['Grip Wheel', ['drive', 'free', 'steer']],
      ['Distribution Bus', ['power']],
    ]) {
      // Fixture openers stay outside the enlarged window; use keyboard activation.
      await p.getByRole('button', { name: 'Close part help' }).click();
      await open(name);
      for (const [index, id] of ids.entries()) {
        await p.locator('.part-help-example').nth(index).scrollIntoViewIfNeeded();
        await p.waitForFunction(() => document.querySelectorAll('.diagram-wire').length > 0);
        ok(
          await diagramValid(index, PART_EXAMPLES[id]),
          `${id} endpoint geometry and labels at ${width}px`,
        );
        const path = p.locator('.part-help-example').nth(index).locator('.diagram-wire').first();
        const d = await path.getAttribute('d');
        await path.evaluate((n) => n.setAttribute('d', 'M0 0L1 1'));
        equal(
          await diagramValid(index, PART_EXAMPLES[id]),
          false,
          'wrong connection geometry is rejected',
        );
        await path.evaluate((n, d) => n.setAttribute('d', d), d);
        ok(await diagramValid(index, PART_EXAMPLES[id]), 'restored connection is admitted');
        await p.screenshot({ path: `${out}/${id}-${width}.png` });
      }
    }
    const content = p.locator('.part-help-content:not([hidden])');
    ok(
      await content.evaluate((n) => n.scrollWidth <= n.clientWidth),
      'inner content has no horizontal overflow',
    );
    equal(
      await p
        .locator('.help-diagram')
        .first()
        .evaluate((n) => getComputedStyle(n).display),
      width < 470 ? 'flex' : 'grid',
      'stacked layout is exercised',
    );
  }
  await diagrams(1280);
  await diagrams(400);
  await p.setViewportSize({ width: 1280, height: 720 });
  const worker = persistent.serviceWorkers()[0] ?? (await persistent.waitForEvent('serviceworker'));
  const original = await p.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }));
  await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find((tab) => tab.url === url);
    await chrome.tabs.setZoom(tab.id, 2);
  }, p.url());
  await p.waitForFunction((dpr) => devicePixelRatio === dpr * 2, original.dpr);
  const zoomed = await p.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
  }));
  equal(zoomed.width, original.width / 2, 'real browser zoom halves layout width');
  equal(zoomed.height, original.height / 2, 'real browser zoom halves layout height');
  ok(
    await p
      .locator('.part-help-content:not([hidden])')
      .evaluate((n) => n.scrollWidth <= n.clientWidth && n.clientHeight > 0),
    '200% zoom keeps readable scrolling content',
  );
  for (const name of ['Close part help', 'Restore help window']) {
    const box = await p.getByRole('button', { name }).boundingBox();
    ok(
      box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= zoomed.width &&
        box.y + box.height <= zoomed.height,
      'zoom keeps window controls visible',
    );
  }
  await p.screenshot({ path: `${out}/browser-zoom-200.png` });
  await worker.evaluate(async (url) => {
    const tab = (await chrome.tabs.query({})).find((tab) => tab.url === url);
    await chrome.tabs.setZoom(tab.id, 1);
  }, p.url());
  await p.waitForFunction((dpr) => devicePixelRatio === dpr, original.dpr);
  await p.evaluate(() => window.helpFixture.dispose());
  equal(await resources(), baseline, 'disposal releases all listeners and observers');
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => window.helpFixture.mount());
    equal(await resources(), mounted, 'remount has exactly one owner');
    for (let j = 0; j < 3; j++) {
      await open('Grip Wheel');
      await p.getByRole('button', { name: 'Close part help' }).click();
    }
    await p.evaluate(() => window.helpFixture.dispose());
    equal(
      await resources(),
      baseline,
      'repeated open/close and disposal do not accumulate resources',
    );
    equal(await p.locator('.part-help, .part-help-tooltip').count(), 0, 'disposed UI is removed');
  }
  await browser.close();
  browser = null;
  evidence.assertUnchanged();
  writeFileSync(
    `${out}/results.json`,
    JSON.stringify(
      {
        ...evidence.identity,
        zoom: { original, zoomed },
        resources: { baseline, mounted },
        ok: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'part help window checks passed: resize, restore, keyboard movement, cancellation, clamping, all diagram paths, stacked reflow, actual 200% browser zoom, repeated disposal/remount',
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  try {
    await browser?.close();
  } finally {
    await server.close();
    rmSync(temporary, { recursive: true, force: true });
  }
}
