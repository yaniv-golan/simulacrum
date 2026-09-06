import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBrowserEvidence, createFixtureEvidence } from '../scripts/browser-evidence.mjs';

const page = build => ({ async goto() {}, locator: () => ({ async getAttribute() { return build; } }) });

test('browser evidence refuses a stale or missing served build and accepts the matching build', async () => {
  const evidence = createBrowserEvidence({ readBuild: () => 'app-current', readSource: () => ({ workingTreeDigest: 'current' }) });
  await assert.rejects(evidence.goto(page('app-stale'), 'http://fixture/'), /served build/);
  await assert.rejects(evidence.goto(page(null), 'http://fixture/'), /served build/);
  assert.equal(await evidence.goto(page('app-current'), 'http://fixture/'), 'app-current');
  assert.doesNotThrow(() => evidence.assertUnchanged());
});

test('verification cannot finish after app or verifier source changes', async () => {
  let build = 'app-current'; const source = { workingTreeDigest: 'original' };
  const evidence = createBrowserEvidence({ readBuild: () => build, readSource: () => source });
  await evidence.goto(page(build), 'http://fixture/');
  build = 'app-edited'; assert.throws(() => evidence.assertUnchanged(), /app source changed/);
  build = 'app-current'; source.workingTreeDigest = 'edited-test';
  assert.throws(() => evidence.assertUnchanged(), /verification source changed/);
});

test('receipt fixture records the actual input bytes and refuses changed fixture input', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'browser-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'capture.mjs'); writeFileSync(path, 'first');
  const evidence = createFixtureEvidence({ name: 'feedback-receipts', build: 'receipt-test', files: [path] });
  assert.equal(await evidence.goto(page('receipt-test'), 'http://fixture/'), 'receipt-test');
  assert.equal(evidence.identity.source.fixture, 'feedback-receipts');
  assert.match(evidence.identity.source.files[0].sha256, /^[a-f0-9]{64}$/);
  writeFileSync(path, 'changed');
  assert.throws(() => evidence.assertUnchanged(), /verification source changed/);
});
