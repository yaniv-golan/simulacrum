import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import * as bundle from '../scripts/playtest/calibration-bundle.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
test('private calibration retrieval is bounded, pinned and fails before publishing partial files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calibration-bundle-'));
  try {
    const data = Buffer.from('{}');
    const manifest = Buffer.from(
      JSON.stringify({
        schema: 1,
        files: [{ path: 'comparison.json', bytes: data.length, sha256: hash(data) }],
      }),
    );
    const reference = {
      url: 'https://private.test/calibration/manifest.json',
      sha256: hash(manifest),
    };
    const calls = [];
    const request = async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(String(url).endsWith('manifest.json') ? manifest : data);
    };
    const path = await bundle.retrieveCalibrationBundle(reference, join(root, 'good'), {
      token: 'test-secret',
      request,
    });
    assert.equal(await readFile(path, 'utf8'), '{}');
    assert.ok(
      calls.every(
        (c) =>
          c.options.redirect === 'error' &&
          c.options.headers.authorization === 'Bearer test-secret',
      ),
    );
    await assert.rejects(
      bundle.retrieveCalibrationBundle(
        { ...reference, sha256: 'a'.repeat(64) },
        join(root, 'bad'),
        { token: 'test-secret', request },
      ),
      /integrity/,
    );
    await assert.rejects(access(join(root, 'bad')));
    await assert.rejects(
      bundle.retrieveCalibrationBundle(reference, join(root, 'changed'), {
        token: 'test-secret',
        request: async (url) =>
          new Response(String(url).endsWith('manifest.json') ? manifest : '[]'),
      }),
      /integrity/,
    );
    for (const path of [
      '../escape',
      '/absolute',
      'a/../../escape',
      'corpus/../secret',
      'capture.json?token=x',
    ]) {
      const wrong = Buffer.from(
        JSON.stringify({ schema: 1, files: [{ path, bytes: 2, sha256: hash(data) }] }),
      );
      await assert.rejects(
        bundle.retrieveCalibrationBundle(
          { ...reference, sha256: hash(wrong) },
          join(root, 'traversal'),
          { token: 'test-secret', request: async () => new Response(wrong) },
        ),
        /path/,
      );
    }
    await assert.rejects(
      bundle.retrieveCalibrationBundle(
        { ...reference, url: 'http://private.test/manifest.json' },
        join(root, 'http'),
        { token: 'test-secret', request },
      ),
      /HTTPS/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
