import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRead,
  classifyReads,
  declarationSkeleton,
  READ_PURPOSES,
  REQUIRED_EXCLUSIONS,
} from '../scripts/read-classification.mjs';
import { readManifest } from '../scripts/validate-manifest.mjs';

test('an audited read names its purpose and excludes both documentation and unit tests; every refusal names the field', () => {
  const full = {
    expression: 'readFileSync(path)',
    purpose: 'identity',
    excludedInputs: [...REQUIRED_EXCLUSIONS],
  };
  assert.deepEqual(classifyRead(full), { ok: true });
  assert.deepEqual(classifyReads([full, { ...full, purpose: 'runtime' }]), {
    ok: true,
    reasons: [],
  });
  // The lamp-shadows declaration of 2026-09-15: a purpose but no exclusions.
  const partial = classifyRead({ ...full, excludedInputs: [] });
  assert.equal(partial.ok, false);
  assert.match(partial.reason, /readFileSync\(path\)/);
  assert.match(partial.reason, /must exclude documentation and unit-test/);
  assert.match(
    classifyRead({ ...full, excludedInputs: ['documentation'] }).reason,
    /must exclude unit-test \(excludedInputs\)/,
  );
  assert.match(
    classifyRead({ ...full, excludedInputs: ['documentation', 'unit-test', 'runtime'] }).reason,
    /unknown input kind runtime/,
  );
  assert.match(
    classifyRead({ ...full, purpose: 'test-selection' }).reason,
    /needs purpose in identity\|fixture\|runtime\|source-analysis/,
  );
  assert.match(classifyRead({ ...full, purpose: null }).reason, /needs purpose/);
  assert.match(
    classifyRead({ purpose: 'identity', excludedInputs: [...REQUIRED_EXCLUSIONS] }).reason,
    /no expression/,
  );
  assert.match(classifyRead(null).reason, /not an object/);
  assert.deepEqual(classifyReads('nope'), { ok: false, reasons: ['reads is not an array'] });
  assert.deepEqual([...READ_PURPOSES], ['identity', 'fixture', 'runtime', 'source-analysis']);
  // Every registered row already satisfies the predicate: the block changes nothing on main.
  for (const scope of readManifest().browserReviewMetadataScopes ?? [])
    assert.deepEqual(classifyReads(scope.reads ?? []), { ok: true, reasons: [] }, scope.entrypoint);
});

test('a declaration skeleton lists every unclassified expression with the purpose left to choose and both exclusions present', () => {
  const s = declarationSkeleton('scripts/x.mjs', ['execFileSync(bin)', 'readFileSync(a)'], {
    checks: ['invariant-controls'],
  });
  assert.equal(s.kind, 'metadata');
  assert.equal(s.entrypoint, 'scripts/x.mjs');
  assert.deepEqual(
    s.reads.map((r) => r.expression),
    ['execFileSync(bin)', 'readFileSync(a)'],
  );
  for (const r of s.reads) {
    assert.match(r.purpose, /one of identity\|fixture\|runtime\|source-analysis/);
    assert.deepEqual(r.excludedInputs, ['documentation', 'unit-test']);
    assert.equal(classifyRead(r).ok, false, 'the skeleton is not itself a valid declaration');
    assert.equal(
      classifyRead({ ...r, purpose: 'runtime' }).ok,
      true,
      'choosing a purpose completes it',
    );
  }
  assert.deepEqual(s.checks, ['invariant-controls']);
  assert.deepEqual(declarationSkeleton('scripts/y.mjs', []).checks, [
    '<registered witness check id>',
  ]);
});
