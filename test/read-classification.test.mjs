import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRead,
  classifyReads,
  declarationSkeleton,
  READ_PURPOSES,
  REQUIRED_EXCLUSIONS,
} from '../scripts/read-classification.mjs';

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
  // The real case (2026-09-15): a purpose given, exclusions left empty.
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
});

test('a declaration skeleton carries the whole row: existing classifications verbatim, each unclassified expression with the purpose left to choose and both exclusions present', () => {
  const kept = {
    expression: 'readFileSync(a)',
    purpose: 'identity',
    excludedInputs: ['documentation', 'unit-test'],
  };
  const s = declarationSkeleton(
    'scripts/x.mjs',
    [{ expression: 'execFileSync(bin)', purpose: null }, kept],
    { checks: ['invariant-controls'] },
  );
  assert.equal(s.kind, 'metadata');
  assert.equal(s.entrypoint, 'scripts/x.mjs');
  assert.deepEqual(
    s.reads.map((r) => r.expression),
    ['execFileSync(bin)', 'readFileSync(a)'],
  );
  // A declaration replaces the row's reads whole, so the classified read must ride along
  // unchanged or re-declaring with the skeleton would unclassify it.
  assert.deepEqual(s.reads[1], kept);
  const placeholder = s.reads[0];
  assert.match(placeholder.purpose, /one of identity\|fixture\|runtime\|source-analysis/);
  assert.deepEqual(placeholder.excludedInputs, ['documentation', 'unit-test']);
  assert.equal(
    classifyRead(placeholder).ok,
    false,
    'the skeleton is not itself a valid declaration',
  );
  assert.equal(
    classifyRead({ ...placeholder, purpose: 'runtime' }).ok,
    true,
    'a purpose completes it',
  );
  assert.deepEqual(s.checks, ['invariant-controls']);
  // Bare expressions are accepted as unclassified reads.
  assert.deepEqual(
    declarationSkeleton('scripts/y.mjs', ['x']).reads.map((r) => r.expression),
    ['x'],
  );
  assert.deepEqual(declarationSkeleton('scripts/y.mjs', []).checks, [
    '<registered witness check id from manifest.checks>',
  ]);
});
