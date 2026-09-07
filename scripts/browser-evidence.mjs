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
