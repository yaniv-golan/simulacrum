import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareVerification,
  assertVerificationReady,
} from '../scripts/verification-preparation.mjs';
function fixture({ changes = [], errors = [] } = {}) {
  const calls = [];
  let currentChanges = changes;
  const dependencies = {
    runtime() {
      calls.push('runtime');
    },
    environment: async () => calls.push('environment'),
    identity: () => ({ id: 1 }),
    proposal: () => ({ changes: currentChanges, blocked: [] }),
    apply: async () => {
      calls.push('apply');
      currentChanges = [];
    },
    generate: () => calls.push('generate'),
    documentation: async () => ({ value: { errors, documentation: { sections: [] } } }),
    review: () => calls.push('review'),
  };
  return { calls, dependencies };
}
test('unreviewed scope changes stop before documentation writes', async () => {
  const f = fixture({ changes: [{ entrypoint: 'reader' }] });
  const r = await prepareVerification('.', {}, f.dependencies);
  assert.equal(r.status, 'NEEDS_SCOPE_REVIEW');
  assert.deepEqual(f.calls, ['runtime', 'environment']);
});
test('failed scope application does not continue', async () => {
  const f = fixture({ changes: [{}] });
  f.dependencies.apply = async () => {
    throw Error('witness failed');
  };
  await assert.rejects(
    prepareVerification('.', { scopeReview: {} }, f.dependencies),
    /witness failed/,
  );
  assert.ok(!f.calls.includes('generate'));
});
test('closed source is ready without automatic reviews', async () => {
  const f = fixture();
  const r = await prepareVerification('.', {}, f.dependencies);
  assert.equal(r.status, 'READY');
  assert.deepEqual(f.calls, ['runtime', 'environment', 'generate', 'runtime']);
});
test('read-only preflight rejects stale registry with actionable row', async () => {
  const f = fixture({ changes: [{ kind: 'metadata', entrypoint: 'scripts/reader.mjs' }] });
  await assert.rejects(
    assertVerificationReady('.', f.dependencies),
    /scripts\/reader.mjs.*verify:prepare/s,
  );
  assert.deepEqual(f.calls, ['runtime']);
});
test('source drift during final readiness inspection rejects result', async () => {
  const f = fixture();
  let n = 0;
  f.dependencies.identity = () => ({ id: n++ });
  await assert.rejects(assertVerificationReady('.', f.dependencies), /Source changed/);
});
test('stale documentation never becomes automatically accepted', async () => {
  const f = fixture({ errors: ['stale explanation'] });
  assert.equal(
    (await prepareVerification('.', {}, f.dependencies)).status,
    'NEEDS_DOCUMENTATION_REVIEW',
  );
  assert.ok(!f.calls.includes('review'));
});

test('review approvals cannot survive changed source', async () => {
  const f = fixture();
  await assert.rejects(
    prepareVerification(
      '.',
      { documentationReview: { source: { id: 2 }, decisions: [] } },
      f.dependencies,
    ),
    /review source changed/,
  );
  assert.ok(!f.calls.includes('review'));
});
test('blocked new reads cannot be approved away', async () => {
  const f = fixture();
  f.dependencies.proposal = () => ({ changes: [], blocked: ['unknown read'] });
  assert.equal(
    (await prepareVerification('.', { scopeReview: {} }, f.dependencies)).status,
    'BLOCKED_SCOPE',
  );
  assert.deepEqual(f.calls, ['runtime', 'environment']);
});
test('explicit scope witness success precedes documentation generation', async () => {
  const f = fixture({ changes: [{}] });
  assert.equal(
    (await prepareVerification('.', { scopeReview: {} }, f.dependencies)).status,
    'READY',
  );
  assert.deepEqual(f.calls, ['runtime', 'environment', 'apply', 'generate', 'runtime']);
});
test('runtime failure happens before environment and writes', async () => {
  const f = fixture();
  f.dependencies.runtime = () => {
    throw Error('wrong runtime');
  };
  await assert.rejects(prepareVerification('.', {}, f.dependencies), /wrong runtime/);
  assert.deepEqual(f.calls, []);
});
