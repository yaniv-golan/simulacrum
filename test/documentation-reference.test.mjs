import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatedReference } from '../scripts/development-reference.mjs';
test('reference derives commands, check ownership and invariant pointers from their owners', () => {
  const pkg = { scripts: { hello: 'node hello.mjs' } };
  const manifest = {
    checks: [{ id: 'a', ruleId: 'r', dueAt: 'M0', module: 'scripts/a.mjs' }],
    invariants: [],
  };
  const result = generatedReference(pkg, manifest);
  assert.match(result, /npm run hello/);
  assert.match(result, /node hello.mjs/);
  assert.match(result, /scripts\/a.mjs/);
  assert.doesNotMatch(result, /npm run removed/);
  assert.notEqual(result, generatedReference({ scripts: { changed: 'node hello.mjs' } }, manifest));
  assert.notEqual(result, generatedReference(pkg, { ...manifest, checks: [] }));
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshReference } from '../scripts/development-reference.mjs';
test('generated reference must match content and missing output is actionable', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-reference-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'docs/development'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { check: 'node check.mjs' } }),
    );
    writeFileSync(
      join(root, 'scripts/manifest.json'),
      JSON.stringify({ checks: [], invariants: [] }),
    );
    assert.throws(() => refreshReference(root, { check: true }), /docs:generate/);
    refreshReference(root);
    assert.doesNotThrow(() => refreshReference(root, { check: true }));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { check: 'node changed.mjs' } }),
    );
    assert.throws(() => refreshReference(root, { check: true }), /stale/);
    refreshReference(root);
    assert.doesNotThrow(() => refreshReference(root, { check: true }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
