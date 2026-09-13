import { attachBrowserSession } from './browser-session.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appFingerprint } from './app-fingerprint.mjs';
import { sourceIdentity } from './source-identity.mjs';

export function createBrowserEvidence({
  readBuild = appFingerprint,
  readSource = sourceIdentity,
  ...sessionOptions
} = {}) {
  const build = readBuild(),
    source = structuredClone(readSource());
  return attachBrowserSession(
    {
      identity: { build, source },
      async assertServed(page) {
        const served = await page.locator('meta[name=build-id]').getAttribute('content');
        assert.equal(served, build, 'served build must match the expected source fingerprint');
        return served;
      },
      async goto(page, url) {
        await page.goto(url);
        return this.assertServed(page);
      },
      async reload(page) {
        await page.reload();
        return this.assertServed(page);
      },
      // This sends an ordinary pointer click; callers must assert what was picked.
      async clickPart(page, partId) {
        const center = await page.evaluate(
          (id) => window.workshopProbe.readRenderedCenters().find((row) => row.id === id),
          partId,
        );
        const canvas = await page.locator('canvas').first().boundingBox();
        assert.ok(
          canvas &&
            center &&
            [center.x, center.y].every((value) => Number.isFinite(value) && Math.abs(value) <= 1),
          `Part ${partId} needs a visible projected center; frame or rotate the view first.`,
        );
        await page.mouse.click(
          canvas.x + (center.x * 0.5 + 0.5) * canvas.width,
          canvas.y + (-center.y * 0.5 + 0.5) * canvas.height,
        );
      },
      // Returns the complete receipt. Matching input alone is insufficient for repeated failures.
      async loadAndWait(page, file, { ok = true } = {}) {
        const save = JSON.parse(readFileSync(file, 'utf8'));
        const before = await page.evaluate(() => window.workshopProbe.readLastCommandResult());
        await uploadWorkshopFile(page, file);
        const handle = await page.waitForFunction(
          ({ sequence, save }) => {
            const receipt = window.workshopProbe.readLastCommandResult();
            return (
              receipt?.sequence > sequence &&
              receipt.input.type === 'load' &&
              JSON.stringify(receipt.input.save) === JSON.stringify(save) &&
              receipt
            );
          },
          { sequence: before?.sequence ?? 0, save },
        );
        const receipt = await handle.jsonValue();
        await handle.dispose();
        assert.equal(receipt.result.ok, ok, 'load returned an unexpected result');
        return receipt;
      },
      // The caller owns the consequential state projection, including history/cursor when relevant.
      async assertRejectedEdit({ snapshot, action }) {
        const before = structuredClone(await snapshot());
        const receipt = await action();
        assert.equal(receipt.result.ok, false, 'expected a rejected edit');
        assert.deepEqual(await snapshot(), before, 'rejected edit changed consequential state');
        return receipt;
      },
      // Resolve the destination after scrolling; callers still assert the authored outcome.
      async dragFrom(page, source, destination) {
        await source.scrollIntoViewIfNeeded();
        const box = await source.boundingBox(),
          target = await destination();
        assert.ok(
          box &&
            box.width > 0 &&
            box.height > 0 &&
            Number.isFinite(target.x) &&
            Number.isFinite(target.y),
          'drag needs visible source and finite destination',
        );
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        try {
          await page.mouse.move(target.x, target.y, { steps: 20 });
        } finally {
          await page.mouse.up();
        }
      },
      assertUnchanged() {
        assert.equal(readBuild(), build, 'app source changed during browser verification');
        assert.deepEqual(
          readSource(),
          source,
          'verification source changed during browser verification',
        );
      },
    },
    sessionOptions,
  );
}

export function createFixtureEvidence({ name, build, files, ...sessionOptions }) {
  const readSource = () => ({
    fixture: name,
    files: files.map((path) => ({
      path,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    })),
  });
  return createBrowserEvidence({ readBuild: () => build, readSource, name, ...sessionOptions });
}

/** Upload through the document control and explicitly accept its replacement prompt. */
export async function uploadWorkshopFile(page, file) {
  const protectedDocument = await page.evaluate(() => {
    const b = JSON.parse(window.render_game_to_text()).metadata.blueprint;
    return (
      !!b.parts.length ||
      (b.environment &&
        b.environment !== 'flat' &&
        (typeof b.environment === 'string' ||
          b.environment.objects.length ||
          b.environment.ground.friction !== 0.6 ||
          b.environment.ground.restitution !== 0))
    );
  });
  await page.locator('input[type=file]').first().setInputFiles(file);
  if (protectedDocument)
    await page.getByRole('button', { name: 'Replace without saving', exact: true }).click();
}
