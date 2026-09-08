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
  assert.throws(() => parseBrowserArgs(['all', '--wat']), /unknown/);
  assert.throws(() => parseBrowserArgs(['--checks', id, '--files', 'src/main.mjs']), /conflict/);
});
test('runtime roots include engine consumers without test imports; unknown and opaque inputs expand coverage', async () => {
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
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
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
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
    { entrypoint: 'help', dependencies: ['shared'], checks: ['help', 'integration'] },
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
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
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
  const scopes = [{ entrypoint: 'scripts/mirror.mjs', dependencies: [], checks: ['mirror'] }];
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
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
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
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
  const m = readManifest(),
    graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' }),
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
  const { selectAffectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
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
  assert.equal(select().checks.length, 0);
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
