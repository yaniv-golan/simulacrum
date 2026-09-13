import { placeCatalogPart, browseAllParts } from './catalog-browser-actions.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CATALOG } from '../src/model/catalog.mjs';
import { PRIMARY_PARTS } from '../src/presentation/part-palette.mjs';
import { ESSENTIAL_PARTS } from '../src/presentation/part-search.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
export function partHelpPartition(name) {
  if (typeof name !== 'string' || !name) throw Error('Invalid part help scenario');
  return name === 'supported-inspectors' ? 1 : 0;
}

export async function runPartHelpCases(partition, evidence, browser) {
  if (![0, 1].includes(partition)) throw Error('Invalid part help partition');
  const out = browserArtifactPath(`artifacts/part-help-browser-${partition}`);
  mkdirSync(out, { recursive: true });
  const results = [];
  async function attempt(name, run, viewport = { width: 1280, height: 720 }) {
    if (partHelpPartition(name) !== partition) return;
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const observed = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const load = async (bp) => {
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles({
          name: 'help.json',
          mimeType: 'application/json',
          buffer: Buffer.from(JSON.stringify(bp)),
        });
      await page.waitForFunction(
        (id) => JSON.parse(window.render_game_to_text()).metadata.blueprint.id === id,
        bp.id,
      );
    };
    try {
      await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
      await page.waitForFunction(() => window.render_game_to_text);
      // Startup is bounded by the browser check watchdog; 2.5 s is the interaction deadline.
      page.setDefaultTimeout(2500);
      await run(page, observed, load);
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
    } finally {
      await page.screenshot({ path: `${out}/${name}.png` });
      await context.tracing.stop({ path: `${out}/${name}.zip` });
      await context.close();
    }
  }
  const equal = (a, b) => evidence.assert('deepEqual', [a, b]);
  try {
    await attempt(
      'primary-placement-clicks',
      async (p, observed) => {
        for (const [index, type] of PRIMARY_PARTS.entries()) {
          const target = p.locator(`[data-part-type="${type}"]`);
          await target.hover();
          await p.locator('[role="tooltip"]').waitFor({ state: 'visible' });
          const tip = await p.locator('[role="tooltip"]').boundingBox(),
            card = await target.boundingBox();
          equal(tip.y + tip.height <= card.y || tip.y >= card.y + card.height, true);
          await placeCatalogPart(p, type);
          equal((await observed()).metadata.blueprint.parts.length, index + 1);
        }
        equal(
          await p.locator('.part-entry').evaluateAll((rows) =>
            rows.every((row) => {
              const card = row.querySelector('[data-placement]').getBoundingClientRect(),
                info = row.querySelector('.part-about').getBoundingClientRect();
              return (
                !card.width ||
                (info.x >= card.x &&
                  info.x + info.width <= card.x + card.width &&
                  info.y >= card.y &&
                  info.y + info.height <= card.y + card.height)
              );
            }),
          ),
          true,
        );
        const info = p.getByRole('button', { name: 'About Grip Wheel', exact: true });
        await info.click();
        await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
        equal(await p.getByRole('dialog', { name: 'Part help', exact: true }).isVisible(), true);
        const graph = p.locator('.help-diagram').first();
        equal(await graph.locator('.help-diagram-node').count(), 4);
        const box = await graph.boundingBox();
        equal(box.width >= 500, true);
        const beforeWindow = (await observed()).metadata.blueprint;
        const title = await p.locator('.part-help-titlebar h3').boundingBox();
        const windowBefore = await p.locator('.part-help').boundingBox();
        await p.mouse.move(title.x + 10, title.y + 10);
        await p.mouse.down();
        await p.mouse.move(title.x - 90, title.y + 50, { steps: 8 });
        await p.mouse.up();
        const moved = await p.locator('.part-help').boundingBox();
        equal(Math.round(moved.x - windowBefore.x), -100);
        equal((await observed()).metadata.blueprint, beforeWindow);
        await p.getByRole('button', { name: 'Expand help window', exact: true }).click();
        equal((await p.locator('.part-help').boundingBox()).width > moved.width, true);
        await p.getByRole('button', { name: 'Restore help window', exact: true }).click();
        // The dragged floating window may cover the expanded catalog. Dismiss it
        // through its ordinary control before choosing the next part.
        await p.getByRole('button', { name: 'Close part help', exact: true }).click();
        await browseAllParts(p);
        await p.getByRole('button', { name: 'About Wheel Hub', exact: true }).click();
        await browseAllParts(p);
        await p.getByRole('button', { name: 'Close part help', exact: true }).click();
        equal(
          await p
            .getByRole('button', { name: 'About Wheel Hub', exact: true })
            .evaluate((n) => n === document.activeElement),
          true,
        );
      },
      { width: 1440, height: 900 },
    );
    await attempt('palette-and-pinning', async (p, observed) => {
      equal(
        await p
          .locator('.catalog-entry:not([hidden]) [data-part-type]')
          .evaluateAll((ns) => ns.map((n) => n.dataset.partType)),
        ESSENTIAL_PARTS,
      );
      equal(
        await p
          .locator('.catalog-entry[hidden] [data-part-type]')
          .evaluateAll((ns) => ns.map((n) => n.dataset.partType)),
        Object.keys(CATALOG).filter((type) => !ESSENTIAL_PARTS.includes(type)),
      );
      const before = (await observed()).metadata.blueprint;
      const wheelInfo = p.getByRole('button', { name: 'About Grip Wheel', exact: true });
      await wheelInfo.click();
      await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
      const readingPosition = await p.locator('#part-help-page-1').evaluate((n) => {
        n.scrollTop = 500;
        return n.scrollTop;
      });
      equal(readingPosition > 0, true);
      await p.getByRole('button', { name: 'Close part help' }).click();
      await wheelInfo.click();
      equal(
        await p.getByRole('tab', { name: 'How to connect' }).getAttribute('aria-selected'),
        'true',
      );
      equal(await p.locator('#part-help-page-1').evaluate((n) => n.scrollTop), readingPosition);
      const info = p.getByRole('button', { name: 'About Powered Motor', exact: true });
      await info.focus();
      await p.keyboard.press('Enter');
      equal(await p.locator('.part-help h3').evaluate((n) => n === document.activeElement), true);
      await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
      await info.click();
      equal(
        await p
          .getByRole('tab', { name: 'How to connect', exact: true })
          .evaluate((n) => n.getAttribute('aria-selected') === 'true'),
        true,
      );
      for (const key of ['Space', 'PageDown', 'ArrowDown']) {
        await p.locator('#part-help-page-1').evaluate((n) => {
          n.scrollTop = 0;
        });
        await p.keyboard.press(key);
        await p.waitForFunction(() => document.querySelector('#part-help-page-1').scrollTop > 0);
      }
      for (const key of ['Shift+Space', 'PageUp', 'ArrowUp', 'Home']) {
        const bottom = await p.locator('#part-help-page-1').evaluate((n) => {
          n.scrollTop = n.scrollHeight;
          return n.scrollTop;
        });
        await p.keyboard.press(key);
        equal((await p.locator('#part-help-page-1').evaluate((n) => n.scrollTop)) < bottom, true);
      }
      await p.locator('#part-help-page-1').focus();
      await p.locator('#part-help-page-1').evaluate((n) => {
        n.scrollTop = 0;
      });
      await p.keyboard.press('Space');
      await p.waitForFunction(() => document.querySelector('#part-help-page-1').scrollTop > 0);
      await p.locator('.part-help h3').focus();
      for (const key of ['Space', 'ArrowUp', 'PageDown', 'Delete', 'Control+z', 'Meta+z', 'c'])
        await p.keyboard.press(key);
      equal((await observed()).metadata.blueprint, before);
      equal((await observed()).metadata.mode, 'build');
      await p.keyboard.press('Escape');
      equal(await info.evaluate((n) => n === document.activeElement), true);
      await info.dragTo(p.locator('canvas').first());
      equal((await observed()).metadata.blueprint, before);
      await placeCatalogPart(p, 'poweredMotor');
      equal((await observed()).metadata.blueprint.parts.length, before.parts.length + 1);
      await info.click();
      await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
      await placeCatalogPart(p, 'powerCell');
      await info.click();
      equal(
        await p
          .getByRole('tab', { name: 'How to connect', exact: true })
          .evaluate((n) => n.getAttribute('aria-selected') === 'true'),
        true,
      );
      await browseAllParts(p);
      await p.getByRole('button', { name: 'About Distribution Bus', exact: true }).tap();
      equal(
        await p
          .getByRole('tab', { name: 'How to connect', exact: true })
          .evaluate((n) => n.getAttribute('aria-selected') === 'true'),
        false,
      );
      await p.getByRole('tab', { name: 'How to connect', exact: true }).tap();
      equal(await p.locator('.part-help figure').count(), 1);
    });
    await attempt('receiver-capture', async (p, observed, load) => {
      const receiver = createPart('commandReceiver', 'receiver', [0, 1, 0]);
      await load({ ...createEmptyBlueprint('receiver-help', 'Receiver help'), parts: [receiver] });
      await p.locator('[data-command="run"]').click();
      const duty = async (value) =>
        p.waitForFunction(
          (value) => JSON.parse(window.render_game_to_text()).power.sources[0]?.duty === value,
          value,
          { timeout: 2500 },
        );
      await p
        .locator('canvas')
        .first()
        .click({ position: { x: 16, y: 250 } });
      await p.keyboard.down('ArrowUp');
      await duty(1);
      await p.getByRole('button', { name: 'About Powered Motor', exact: true }).click();
      await duty(0);
      await p.keyboard.down('ArrowUp');
      await duty(0);
      equal((await observed()).metadata.mode, 'run');
      await p
        .locator('canvas')
        .first()
        .click({ position: { x: 16, y: 250 } });
      await p.keyboard.down('ArrowUp');
      await duty(0);
      await p.keyboard.up('ArrowUp');
      await p.keyboard.down('ArrowUp');
      await duty(1);
      await p.keyboard.up('ArrowUp');
      await duty(0);
      equal(await p.locator('.part-help').isVisible(), true);
    });
    await attempt(
      'supported-inspectors',
      async (p, observed, load) => {
        for (const type of Object.keys(CATALOG)) {
          const bp = {
            ...createEmptyBlueprint(`help-${type}`, 'Help'),
            parts: [createPart(type, 'part', [0, 1, 0])],
          };
          await load(bp);
          await evidence.clickPart(p, 'part');
          await p.getByRole('button', { name: 'About this part', exact: true }).click();
          equal(await p.locator('.part-help h3').textContent(), `About ${CATALOG[type].name}`);
          await p.waitForFunction(() => document.querySelector('.help-portrait')?.naturalWidth > 0);
          equal(await p.locator('.help-portrait').getAttribute('data-icon-type'), type);
          await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
          equal((await observed()).metadata.blueprint, bp);
          await p.keyboard.press('Escape');
        }
        await evidence.reload(p);
        equal(await p.locator('.part-help').isVisible(), false);
        equal(await p.locator('.part-help').count(), 1);
      },
      { width: 1440, height: 900 },
    );
    await attempt('authoring-escape', async (p, observed, load) => {
      await load({
        ...createEmptyBlueprint('authoring-help', 'Authoring help'),
        parts: [
          createPart('poweredMotor', 'motor', [0, 1, 0]),
          createPart('powerCell', 'cell', [0.5, 1, 0]),
        ],
      });
      await evidence.clickPart(p, 'motor');
      const selected = await p.locator('.inspector').getAttribute('data-part-id');
      const before = (await observed()).metadata.blueprint;
      await p.getByRole('button', { name: 'Snap to surface', exact: true }).click();
      const surface = p.getByRole('region', { name: 'Surface placement' });
      await surface.waitFor({ state: 'visible' });
      await p.getByRole('button', { name: 'About Powered Motor', exact: true }).click();
      for (const key of ['ArrowUp', 'PageDown', 'Space', 'Delete']) await p.keyboard.press(key);
      await p.keyboard.press('Escape');
      equal(await surface.isVisible(), true);
      equal((await observed()).metadata.blueprint, before);
      await p
        .locator('canvas')
        .first()
        .click({ position: { x: 16, y: 250 } });
      await p.keyboard.press('Escape');
      await evidence.clickPart(p, selected);
      await p.getByRole('button', { name: 'Mirror parts…', exact: true }).click();
      await p.getByRole('button', { name: 'About Powered Motor', exact: true }).click();
      await p.keyboard.press('Escape');
      equal(await p.locator('.assembly-mirror').count(), 1);
      equal((await observed()).metadata.blueprint, before);
    });
    await attempt('loaded-inspector-and-modes', async (p, observed, load) => {
      const bp = {
        ...createEmptyBlueprint('loaded-help', 'Loaded help'),
        parts: [createPart('logicController', 'logic', [0, 1, 0])],
      };
      await load(bp);
      await evidence.clickPart(p, 'logic');
      await p.getByRole('button', { name: 'About this part', exact: true }).click();
      equal(await p.locator('.part-help h3').textContent(), 'About Logic Controller');
      for (const key of ['Space', 'ArrowLeft', 'PageUp', 'Delete', 'c', 'Control+z'])
        await p.keyboard.press(key);
      equal((await observed()).metadata.blueprint, bp);
      await p.keyboard.press('Escape');
      equal(await p.locator('.inspector').getAttribute('data-part-id'), 'logic');
      await p.getByRole('button', { name: 'About this part', exact: true }).click();
      await p.getByRole('button', { name: 'Delete part', exact: true }).click();
      equal(await p.locator('.part-help').isVisible(), true);
      await p.getByRole('button', { name: 'Close part help', exact: true }).click();
      equal(
        await p
          .getByRole('heading', { name: 'Parts', exact: true })
          .evaluate((n) => n === document.activeElement),
        true,
      );
      await placeCatalogPart(p, 'poweredMotor');
      for (const mode of ['run', 'pause']) {
        await p.locator(`[data-command="${mode}"]`).click();
        equal(await p.locator('.parts-browser [data-placement]:enabled').count(), 0);
        await p.getByRole('button', { name: 'About Powered Motor', exact: true }).click();
        await p.getByRole('tab', { name: 'How to connect', exact: true }).click();
        await browseAllParts(p);
        await p.getByRole('button', { name: 'About Wheel Hub', exact: true }).click();
        equal(await p.locator('.part-help').isVisible(), true);
        await p.getByRole('button', { name: 'Close part help', exact: true }).click();
        await browseAllParts(p);
      }
    });
    await attempt(
      'tooltip-and-reflow',
      async (p) => {
        await browseAllParts(p);
        const motor = p.locator('[data-part-type="poweredMotor"]');
        await motor.hover();
        await p.locator('[role="tooltip"]').waitFor({ state: 'visible' });
        await p.locator('[role="tooltip"]').hover();
        equal(await p.locator('[role="tooltip"]').isVisible(), true);
        await p.keyboard.press('Escape');
        equal(await p.locator('[role="tooltip"]').isVisible(), false);
        await motor.focus();
        equal(
          await motor.getAttribute('aria-describedby'),
          'part-description-poweredMotor catalog-reason-poweredMotor',
        );
        await p.getByRole('button', { name: 'About Grip Wheel', exact: true }).tap();
        await p.getByRole('tab', { name: 'How to connect', exact: true }).tap();
        equal(await p.locator('.part-help figure').count(), 3);
        await p.locator('.part-help figure').first().scrollIntoViewIfNeeded();
        await p.screenshot({ path: `${out}/narrow-diagram.png` });
        equal(await p.locator('.part-help').evaluate((n) => n.scrollWidth <= n.clientWidth), true);
        await p
          .getByRole('button', { name: 'Close part help', exact: true })
          .scrollIntoViewIfNeeded();
      },
      { width: 640, height: 720 },
    );
  } finally {
    await browser.close();
  }
  writeFileSync(`${out}/results.json`, JSON.stringify({ results, ...evidence.identity }, null, 2));
  console.log(JSON.stringify(results));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
