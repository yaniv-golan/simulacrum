import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { deriveExperimentInputs } from '../scripts/playtest/experiment-inputs.mjs';
const fixture = () => ({
  files: { 'assets/app.js': 'a'.repeat(64), 'backend/worker.js': 'b'.repeat(64) },
  desired: { account: 'one', limit: 100 },
  roots: { endurance: ['capture.mjs'], capacity: ['load.mjs'] },
  graph: {
    errors: [],
    nodes: new Map([
      ['capture.mjs', { dependencies: new Set(['shared.mjs']) }],
      ['load.mjs', { dependencies: new Set(['shared.mjs']) }],
      ['shared.mjs', { dependencies: new Set() }],
    ]),
  },
  read: (path) => Buffer.from(path),
  source: 'source-a',
  runtime: { node: '24.18.0', lock: 'lock-a' },
});
test('experiment identities separate payload families while binding declared verifier owners', () => {
  const options = fixture(),
    before = deriveExperimentInputs(options);
  options.files['assets/app.js'] = 'c'.repeat(64);
  const visual = deriveExperimentInputs(options);
  assert.notEqual(before.inputs.endurance, visual.inputs.endurance);
  assert.equal(before.inputs.capacity, visual.inputs.capacity);
  options.files['backend/worker.js'] = 'd'.repeat(64);
  assert.notEqual(visual.inputs.capacity, deriveExperimentInputs(options).inputs.capacity);
  options.read = (path) => Buffer.from(path === 'shared.mjs' ? 'changed owner' : path);
  const owner = deriveExperimentInputs(options);
  assert.notEqual(owner.inputs.endurance, visual.inputs.endurance);
  assert.notEqual(
    owner.inputs.capacity,
    deriveExperimentInputs({ ...options, read: (path) => Buffer.from(path) }).inputs.capacity,
  );
  options.source = 'documentation-only';
  assert.equal(owner.inputs.capacity, deriveExperimentInputs(options).inputs.capacity);
  options.runtime.lock = 'lock-b';
  assert.notEqual(owner.inputs.capacity, deriveExperimentInputs(options).inputs.capacity);
  assert.notEqual(
    owner.configuration,
    deriveExperimentInputs({ ...options, desired: { account: 'two' } }).configuration,
  );
});
test('opaque, missing and unknown payload boundaries bind complete source rather than omit inputs', () => {
  for (const mutate of [
    (x) => (x.graph.nodes.get('load.mjs').opaqueInputs = true),
    (x) => x.graph.nodes.get('load.mjs').dependencies.add('missing.mjs'),
    (x) => (x.files['unclassified.bin'] = 'e'.repeat(64)),
  ]) {
    const options = fixture();
    mutate(options);
    const before = deriveExperimentInputs(options);
    assert.equal(before.boundaries.capacity.scope, 'all-source');
    assert.ok(before.boundaries.capacity.reasons.length);
    options.source = 'changed unknown input';
    assert.notEqual(before.inputs.capacity, deriveExperimentInputs(options).inputs.capacity);
  }
  const options = fixture();
  options.graph.errors.push('unresolved');
  assert.throws(() => deriveExperimentInputs(options), /dependency discovery/);
  options.graph.errors = [];
  options.files['assets/app.js'] = 'bad hash';
  assert.throws(() => deriveExperimentInputs(options), /payload inventory/);
});

test('audited capacity runtime admits only exact owner sources and complete declared payload identities', async () => {
  const { readFileSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const { buildModuleGraph } = await import('../scripts/module-graph.mjs');
  const options = fixture();
  options.roots = {
    endurance: ['scripts/playtest/load.mjs'],
    capacity: ['scripts/playtest/load.mjs'],
  };
  options.graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
  options.read = (path) => readFileSync(path);
  options.capacityRuntime = {
    calibrationEvidence: 'a'.repeat(64),
    recordingMode: 'video',
    captureSchema: 1,
    workload: {
      maxEventBytes: 1000,
      maxMediaBytesPerSecond: 1000,
      maxEventsPerSecond: 10,
      maxChunkBytes: 10000,
    },
    browserVersion: 'Chrome1',
    effectiveProvider: 'c'.repeat(64),
  };
  options.scopes = JSON.parse(
    readFileSync('scripts/manifest.json', 'utf8'),
  ).experimentInputScopes.map((scope) => ({
    ...scope,
    sourceSha256: createHash('sha256').update(options.read(scope.entrypoint)).digest('hex'),
  }));
  const baseline = deriveExperimentInputs(options);
  assert.equal(baseline.boundaries.capacity.scope, 'packaged-runtime-and-verifier-closure');
  options.source = 'documentation-change';
  assert.equal(baseline.inputs.capacity, deriveExperimentInputs(options).inputs.capacity);
  options.capacityRuntime.calibrationEvidence = 'd'.repeat(64);
  assert.notEqual(baseline.inputs.capacity, deriveExperimentInputs(options).inputs.capacity);
  options.read = (path) =>
    Buffer.concat([
      readFileSync(path),
      path === 'scripts/playtest/load.mjs'
        ? Buffer.from('\n// changed dynamic reader')
        : Buffer.alloc(0),
    ]);
  assert.equal(deriveExperimentInputs(options).boundaries.capacity.scope, 'all-source');
  options.read = (path) => readFileSync(path);
  delete options.capacityRuntime.effectiveProvider;
  assert.equal(deriveExperimentInputs(options).boundaries.capacity.scope, 'all-source');
});

test('bounded endurance still includes every packaged byte and rejects unaudited reader edits', () => {
  const options = fixture();
  options.graph.nodes.get('capture.mjs').opaqueInputs = true;
  options.capacityRuntime = {
    calibrationEvidence: 'a'.repeat(64),
    effectiveProvider: 'b'.repeat(64),
    browserVersion: 'Chrome',
    recordingMode: 'video',
    captureSchema: 1,
    workload: {
      maxEventBytes: 1000,
      maxMediaBytesPerSecond: 1,
      maxEventsPerSecond: 1,
      maxChunkBytes: 1,
    },
  };
  options.scopes = [
    {
      family: 'endurance',
      runtimeBoundary: 'packaged-capture-runtime-v1',
      entrypoint: 'capture.mjs',
      sourceSha256: createHash('sha256').update(options.read('capture.mjs')).digest('hex'),
      dependencies: ['shared.mjs'],
      externalImports: [],
    },
  ];
  const baseline = deriveExperimentInputs(options);
  assert.equal(baseline.boundaries.endurance.scope, 'packaged-runtime-and-verifier-closure');
  options.source = 'changed-doc';
  assert.equal(baseline.inputs.endurance, deriveExperimentInputs(options).inputs.endurance);
  options.files['assets/app.js'] = 'f'.repeat(64);
  assert.notEqual(baseline.inputs.endurance, deriveExperimentInputs(options).inputs.endurance);
  options.read = (path) => Buffer.from(path + 'new-reader');
  assert.equal(deriveExperimentInputs(options).boundaries.endurance.scope, 'all-source');
});
