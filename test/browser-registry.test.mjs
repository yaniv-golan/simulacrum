import { browserScopeConsumers, browserScopeRoots } from '../scripts/browser-selection.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserChecks, validateBrowserCoverage } from '../scripts/browser-registry.mjs';
import { readManifest, validateManifest } from '../scripts/validate-manifest.mjs';
test('every browser script is registered and registry rejects invalid ownership or duplicates', () => {
  assert.doesNotThrow(() => validateBrowserCoverage());
  assert.ok(browserChecks().some((c) => c.id === 'verify-energy-browser'));
  for (const mutate of [
    (m) => m.browserChecks.push(m.browserChecks[0]),
    (m) => (m.browserChecks[0].timeoutMs = 0),
    (m) => (m.browserChecks[0].ruleId = 'unknown'),
  ]) {
    const m = structuredClone(readManifest());
    mutate(m);
    assert.throws(() => validateManifest(m));
  }
});

test('multiple explicit checks are deduplicated; unknown IDs and malformed options fail closed', async () => {
  const { selectChecks, parseBrowserArgs } = await import('../scripts/browser-registry.mjs');
  const id = browserChecks()[0].id;
  assert.equal(selectChecks([id, id]).length, 1);
  assert.throws(() => selectChecks([id, 'wrong']), /unknown/);
  assert.deepEqual(parseBrowserArgs(['--checks', id, '--workers', '2']).mode, [id]);
  assert.equal(parseBrowserArgs(['--checks', id, '--fail-fast']).failFast, true);
  assert.equal(parseBrowserArgs(['--checks', id, '--workers', '4']).workers, 4);
  assert.throws(() => parseBrowserArgs(['all', '--workers', '4']), /explicit/);
  assert.throws(() => parseBrowserArgs(['--checks', id, '--workers', '5']), /workers/);
  assert.throws(() => parseBrowserArgs(['all', '--fail-fast']), /explicit/);
  assert.throws(() => parseBrowserArgs(['--files', 'src/main.mjs', '--fail-fast']), /explicit/);
  assert.throws(() => parseBrowserArgs(['all', '--wat']), /unknown/);
  assert.throws(() => parseBrowserArgs(['--checks', id, '--files', 'src/main.mjs']), /conflict/);
});
test('runtime roots include engine consumers without test imports; unknown and opaque inputs expand coverage', async () => {
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  const checks = [
    { id: 'app', script: 'scripts/app.mjs', environment: 'workshop' },
    { id: 'probe', script: 'scripts/probe.mjs', environment: 'probe' },
    { id: 'self', script: 'scripts/self.mjs', environment: 'self' },
  ];
  const nodes = new Map(
    Object.entries({
      'index.html': { dependencies: ['src/engine.mjs'] },
      'test/browser/index.html': { dependencies: ['src/engine.mjs'] },
      'src/engine.mjs': { dependencies: [] },
      'scripts/app.mjs': { dependencies: [] },
      'scripts/probe.mjs': { dependencies: [] },
      'scripts/self.mjs': { dependencies: [] },
    }),
  );
  const select = (files) =>
    selectAffectedBrowserChecks({ checks, graph: { nodes, errors: [] }, files });
  assert.deepEqual(
    select(['src/engine.mjs']).checks.map((x) => x.id),
    ['app', 'probe', 'self'],
  );
  assert.deepEqual(
    select(['scripts/app.mjs']).checks.map((x) => x.id),
    ['app', 'self'],
  );
  assert.equal(select(['unknown.json']).checks.length, 3);
  const unknown = select(['z.json', 'scripts/app.mjs', 'a.json']);
  assert.deepEqual(unknown.unknownInputs, ['a.json', 'z.json']);
  assert.ok(
    unknown.reasons.every((r) => r.path === null && r.inputs.join(',') === 'a.json,z.json'),
  );
  nodes.get('scripts/probe.mjs').opaqueInputs = true;
  assert.equal(select(['scripts/app.mjs']).checks.length, 3);
  assert.equal(
    selectAffectedBrowserChecks({
      checks,
      graph: { nodes, errors: ['broken'] },
      files: ['scripts/app.mjs'],
    }).checks.length,
    3,
  );
});

test('performance and self-hosted checks cannot opt into parallel execution', () => {
  for (const mutate of [
    (m) => (m.browserChecks[0].execution = 'unknown'),
    (m) => (m.browserChecks[0].execution = 'parallel'),
    (m) => {
      const c = m.browserChecks.find((c) => c.environment === 'self');
      c.execution = 'parallel';
    },
  ]) {
    const m = structuredClone(readManifest());
    mutate(m);
    assert.throws(() => validateManifest(m));
  }
});

test('local feature boundary narrows only its reviewed dependency shape; shared and new inputs expand', async () => {
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  const checks = [
    { id: 'help', script: 'help-check', environment: 'workshop' },
    { id: 'integration', script: 'integration-check', environment: 'workshop' },
    { id: 'other', script: 'other-check', environment: 'self' },
  ];
  const nodes = new Map(
    ['help', 'shared', 'new', 'index.html', 'help-check', 'integration-check', 'other-check'].map(
      (p) => [p, { dependencies: [], opaqueInputs: true }],
    ),
  );
  nodes.set('help', { dependencies: ['shared'], opaqueInputs: false });
  const scopes = [
    {
      entrypoint: 'help',
      dependencies: ['shared'],
      checks: ['help', 'integration'],
      consumers: [],
      roots: browserScopeRoots(checks),
    },
  ];
  const select = (files) =>
    selectAffectedBrowserChecks({ checks, graph: { nodes, errors: [] }, files, scopes });
  assert.equal(select(['help']).checks.length, 2);
  assert.equal(select(['shared']).checks.length, 3);
  assert.equal(select(['help', 'new']).checks.length, 3);
  nodes.get('help').imports = [{ target: null, specifier: 'new-library' }];
  assert.equal(select(['help']).checks.length, 3);
  nodes.get('help').imports = [];
  nodes.get('help').dependencies.push('new');
  assert.equal(select(['help']).checks.length, 3);
});

test('documentation composes with local scopes without exempting runtime data or unknown inputs', async () => {
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  const checks = [
    { id: 'mirror', script: 'scripts/mirror.mjs', environment: 'workshop' },
    { id: 'other', script: 'other', environment: 'self' },
  ];
  const nodes = new Map([
    ['scripts/mirror.mjs', { dependencies: [] }],
    ['shared', { dependencies: [], opaqueInputs: true }],
    ['other', { dependencies: [] }],
    ['index.html', { dependencies: [] }],
  ]);
  const graph = { nodes, errors: [] };
  const scopes = [
    {
      entrypoint: 'scripts/mirror.mjs',
      dependencies: [],
      checks: ['mirror'],
      consumers: browserScopeConsumers(graph, 'scripts/mirror.mjs'),
      roots: browserScopeRoots(checks),
    },
  ];
  const doc = 'docs/development/.reviews/README/developer-guide.json';
  const select = (files) => selectAffectedBrowserChecks({ checks, graph, files, scopes });
  assert.equal(select([doc]).checks.length, 0);
  assert.deepEqual(
    select([doc, 'scripts/mirror.mjs']).checks.map((c) => c.id),
    ['mirror'],
  );
  for (const p of ['config/new.json', 'docs/runtime.json', 'docs/internal/plan.md'])
    assert.equal(select([doc, p]).checks.length, 2);
  nodes.set(doc, { dependencies: [] }); // A literal runtime read makes this data, not documentation-only.
  nodes.get('scripts/mirror.mjs').dependencies.push(doc);
  assert.equal(select([doc]).checks.length, 2);
  nodes.delete(doc);
  nodes.get('scripts/mirror.mjs').dependencies = [];
  graph.errors.push('bad import');
  assert.equal(select([doc]).checks.length, 2);
  graph.errors = [];
  assert.equal(select([]).checks.length, 2);
});

test('live mirror verifier stays bounded and metadata obeys its audited boundary', async () => {
  const { affectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
  const paths = [
    'scripts/verify-mirror-browser.mjs',
    'docs/development/.reviews/README/developer-guide.json',
  ];
  assert.deepEqual(
    affectedBrowserChecks([paths[0]]).checks.map((c) => c.id),
    ['verify-mirror-browser'],
  );
  const mixed = affectedBrowserChecks(paths);
  assert.ok(mixed.checks.length === 1 || mixed.checks.length === browserChecks().length);
  if (mixed.scope === 'local-contract')
    assert.deepEqual(
      mixed.checks.map((c) => c.id),
      ['verify-mirror-browser'],
    );
  assert.equal(
    affectedBrowserChecks(['scripts/browser-evidence.mjs', ...paths]).checks.length,
    browserChecks().length,
  );
});

test('opaque readers retain coverage for documentation-only and mixed scoped changes', async () => {
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  const checks = [
    { id: 'reader', script: 'reader', environment: 'self' },
    { id: 'mirror', script: 'mirror', environment: 'workshop' },
  ];
  const graph = {
    errors: [],
    nodes: new Map([
      ['reader', { dependencies: [], opaqueInputs: true }],
      ['mirror', { dependencies: [] }],
      ['index.html', { dependencies: [] }],
    ]),
  };
  const scopes = [{ entrypoint: 'mirror', dependencies: [], checks: ['mirror'] }];
  for (const files of [['docs/player-guide.md'], ['docs/player-guide.md', 'mirror']])
    assert.ok(
      selectAffectedBrowserChecks({ checks, graph, files, scopes }).checks.some(
        (c) => c.id === 'reader',
      ),
    );
});

test('recording client scope retains both adapters, durable receipt and workshop lifecycle witnesses', async () => {
  const { buildModuleGraph } = await import('../scripts/module-graph.mjs');
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  const m = readManifest(),
    graph = buildModuleGraph(process.cwd(), {
      purpose: 'test-selection',
      entrypoints: browserGraphEntrypoints(process.cwd()),
    }),
    file = 'src/application/remote-playtest.mjs';
  const select = () =>
    selectAffectedBrowserChecks({
      checks: browserChecks(),
      graph,
      files: [file],
      scopes: m.browserLocalScopes,
    });
  assert.equal(select().scope, 'local-contract');
  assert.deepEqual(
    select()
      .checks.map((c) => c.id)
      .sort(),
    [
      'verify-cloud-playtest',
      'verify-feedback-receipts',
      'verify-remote-playtest',
      'verify-ui-lifecycle-browser',
      'verify-workshop',
    ].sort(),
  );
  graph.nodes.get(file).dependencies.add('unknown-new-reader');
  assert.notEqual(select().scope, 'local-contract');
  graph.nodes.get(file).dependencies.delete('unknown-new-reader');
  graph.nodes.get(file).opaqueInputs = true;
  assert.notEqual(select().scope, 'local-contract');
});

test('audited review metadata exclusion rejects changed readers, direct data dependencies and unknown opacity', async () => {
  const { createHash } = await import('node:crypto');
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  const file = 'docs/development/.reviews/README/section.json',
    source = 'known output-only reader';
  const node = { dependencies: new Set(), imports: [], opaqueInputs: true };
  const graph = { nodes: new Map([['reader', node]]), errors: [] };
  const checks = [{ id: 'check', script: 'reader', environment: 'self' }];
  const metadataScopes = [
    {
      entrypoint: 'reader',
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      dependencies: [],
      externalImports: [],
    },
  ];
  const select = (overrides = {}) =>
    selectAffectedBrowserChecks({
      checks,
      graph,
      files: [file],
      metadataScopes,
      readSource: () => source,
      ...overrides,
    });
  assert.equal(select().checks.length, 1);
  assert.equal(select({ readSource: () => source + 'new input' }).checks.length, 1);
  node.dependencies.add(file);
  graph.nodes.set(file, { dependencies: new Set() });
  assert.equal(select().checks.length, 1);
  node.dependencies.clear();
  graph.nodes.delete(file);
  node.dependencies.add('new-reader');
  graph.nodes.set('new-reader', { dependencies: new Set(), opaqueInputs: true });
  assert.equal(select().checks.length, 1);
  node.dependencies.clear();
  assert.equal(select({ files: ['docs/development/README.md'] }).checks.length, 1);
  assert.equal(select({ metadataEnvironmentSafe: false }).checks.length, 1);
});

test('shared scopes expand for new reverse consumers and new browser roots', async () => {
  const { selectAffectedBrowserChecks, browserScopeConsumers, browserScopeRoots } = await import(
    '../scripts/browser-selection.mjs'
  );
  const checks = ['a', 'b', 'c'].map((id) => ({
    id,
    script: `scripts/${id}.mjs`,
    environment: 'workshop',
  }));
  const nodes = new Map([
    ['src/shared.mjs', { dependencies: [] }],
    ['index.html', { dependencies: [] }],
    ...checks.map((c) => [c.script, { dependencies: ['src/shared.mjs'], opaqueInputs: true }]),
  ]);
  nodes.get(checks[2].script).dependencies = [];
  const graph = { nodes, errors: [] };
  const scope = {
    entrypoint: 'src/shared.mjs',
    dependencies: [],
    checks: ['a', 'b'],
    consumers: browserScopeConsumers(graph, 'src/shared.mjs'),
    roots: browserScopeRoots(checks),
  };
  const select = () =>
    selectAffectedBrowserChecks({ checks, graph, files: ['src/shared.mjs'], scopes: [scope] });
  assert.equal(select().checks.length, 2);
  nodes.get(checks[2].script).dependencies.push('src/shared.mjs');
  assert.equal(select().checks.length, 3);
  nodes.get(checks[2].script).dependencies = [];
  checks.push({ id: 'd', script: 'scripts/d.mjs', environment: 'self' });
  nodes.set('scripts/d.mjs', { dependencies: [] });
  assert.equal(select().checks.length, 4);
});

test('read audits distinguish metadata from fixtures and reject new reads, consumers and runtime documents', async () => {
  const { createHash } = await import('node:crypto');
  const {
    selectAffectedBrowserChecks,
    browserScopeConsumers,
    browserScopeRoots,
    browserConsumerSourceHash,
  } = await import('../scripts/browser-selection.mjs');
  const checks = [
    { id: 'a', script: 'scripts/a.mjs', environment: 'workshop' },
    { id: 'b', script: 'scripts/b.mjs', environment: 'self' },
  ];
  const graph = {
    errors: [],
    nodes: new Map([
      ['index.html', { dependencies: [] }],
      ['scripts/a.mjs', { dependencies: ['scripts/read.mjs'] }],
      ['scripts/b.mjs', { dependencies: [] }],
      [
        'scripts/read.mjs',
        { dependencies: [], opaqueInputs: true, opaqueReads: ['readFileSync(file)'] },
      ],
      ['test/example.test.mjs', { dependencies: [] }],
    ]),
  };
  const audit = {
    entrypoint: 'scripts/read.mjs',
    sourceSha256: createHash('sha256').update('reviewed').digest('hex'),
    dependencies: [],
    externalImports: [],
    reads: [
      {
        expression: 'readFileSync(file)',
        purpose: 'fixture',
        excludedInputs: ['documentation', 'unit-test'],
      },
    ],
    consumers: browserScopeConsumers(graph, 'scripts/read.mjs'),
    roots: browserScopeRoots(checks),
    consumerSourceHash: browserConsumerSourceHash(graph, 'scripts/read.mjs', () => 'reviewed'),
  };
  const select = (files) =>
    selectAffectedBrowserChecks({
      checks,
      graph,
      files,
      metadataScopes: [audit],
      readSource: () => 'reviewed',
    });
  assert.equal(select(['docs/guide.md', 'test/example.test.mjs']).checks.length, 0);
  assert.equal(select(['config/fixture.json']).checks.length, 2);
  graph.nodes.get('scripts/read.mjs').opaqueReads.push('readFileSync(newInput)');
  assert.equal(select(['docs/guide.md']).checks.length, 2);
  graph.nodes.get('scripts/read.mjs').opaqueReads.pop();
  graph.nodes.get('scripts/b.mjs').dependencies.push('scripts/read.mjs');
  assert.equal(select(['docs/guide.md']).checks.length, 2);
  graph.nodes.get('scripts/b.mjs').dependencies = [];
  graph.nodes.get('scripts/a.mjs').dependencies.push('docs/guide.md');
  graph.nodes.set('docs/guide.md', { dependencies: [] });
  assert.equal(select(['docs/guide.md']).checks.length, 2);
});

test('read audit rejects stale callers and sibling argument providers for every metadata class', async () => {
  const { createHash } = await import('node:crypto');
  const {
    selectAffectedBrowserChecks,
    browserScopeConsumers,
    browserScopeRoots,
    browserConsumerSourceHash,
  } = await import('../scripts/browser-selection.mjs');
  const reader = 'scripts/read.mjs',
    caller = 'scripts/caller.mjs',
    provider = 'scripts/path.mjs';
  const source = new Map([
    [reader, 'readFileSync(file)'],
    [caller, 'read(path)'],
    [provider, 'fixture.json'],
  ]);
  const checks = [{ id: 'runtime', script: caller, environment: 'self' }];
  const graph = {
    errors: [],
    nodes: new Map([
      [
        reader,
        { dependencies: [], imports: [], opaqueInputs: true, opaqueReads: ['readFileSync(file)'] },
      ],
      [caller, { dependencies: [reader, provider] }],
      [provider, { dependencies: [] }],
      ['test/example.test.mjs', { dependencies: [] }],
    ]),
  };
  graph.nodes.set('test/unrelated.test.mjs', { dependencies: [reader] });
  source.set('test/unrelated.test.mjs', 'test fixture reader');
  const audit = {
    entrypoint: reader,
    sourceSha256: createHash('sha256').update(source.get(reader)).digest('hex'),
    dependencies: [],
    externalImports: [],
    reads: [
      {
        expression: 'readFileSync(file)',
        purpose: 'fixture',
        excludedInputs: ['documentation', 'unit-test'],
      },
    ],
    consumers: browserScopeConsumers(graph, reader),
    roots: browserScopeRoots(checks),
    consumerSourceHash: browserConsumerSourceHash(graph, reader, (p) => source.get(p), checks),
  };
  const select = (file) =>
    selectAffectedBrowserChecks({
      checks,
      graph,
      files: [file],
      metadataScopes: [audit],
      readSource: (p) => source.get(p),
    });
  for (const file of [
    'docs/guide.md',
    'docs/development/.reviews/README/section.json',
    'test/example.test.mjs',
  ]) {
    assert.equal(select(file).checks.length, 0);
    source.set('test/unrelated.test.mjs', 'changed test-only reader');
    assert.equal(select(file).checks.length, 0);
    source.set('test/unrelated.test.mjs', 'test fixture reader');
    source.set(caller, 'changed caller');
    assert.equal(select(file).checks.length, 1, 'changed caller ' + file);
    source.set(caller, 'read(path)');
    source.set(provider, file);
    assert.equal(select(file).checks.length, 1, 'changed argument provider ' + file);
    source.set(provider, 'fixture.json');
  }
});
