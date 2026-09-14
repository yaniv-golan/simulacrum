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

test('performance, probe and timing-sensitive self-hosted checks cannot opt into parallel execution', () => {
  for (const mutate of [
    (m) => (m.browserChecks[0].execution = 'unknown'),
    (m) => (m.browserChecks[0].execution = 'parallel'),
    (m) => {
      const c = m.browserChecks.find((c) => c.environment === 'probe');
      c.execution = 'parallel';
    },
    (m) => {
      const c = m.browserChecks.find((c) => c.environment === 'self' && c.timingSensitive);
      c.execution = 'parallel';
    },
  ]) {
    const m = structuredClone(readManifest());
    mutate(m);
    assert.throws(() => validateManifest(m));
  }
  // An isolated self-hosted check may share the pool; the source control below decides isolation.
  const m = structuredClone(readManifest());
  const c = m.browserChecks.find((x) => x.environment === 'self' && !x.timingSensitive);
  c.execution = 'parallel';
  assert.doesNotThrow(() => validateManifest(m));
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
  const graph = { nodes, errors: [] };
  const scopes = [
    {
      entrypoint: 'help',
      dependencies: ['shared'],
      checks: ['help', 'integration'],
      consumers: [],
      reachingChecks: browserScopeRoots(checks, graph, 'help'),
    },
  ];
  const select = (files) => selectAffectedBrowserChecks({ checks, graph, files, scopes });
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
      reachingChecks: browserScopeRoots(checks, graph, 'scripts/mirror.mjs'),
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
      'verify-feedback-flow',
      'verify-feedback-lifecycle',
      'verify-feedback-receipts',
      'verify-feedback-recovery',
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
    reachingChecks: browserScopeRoots(checks, graph, 'src/shared.mjs'),
  };
  const select = () =>
    selectAffectedBrowserChecks({ checks, graph, files: ['src/shared.mjs'], scopes: [scope] });
  assert.equal(select().checks.length, 2);
  nodes.get(checks[2].script).dependencies.push('src/shared.mjs');
  assert.equal(select().checks.length, 3);
  nodes.get(checks[2].script).dependencies = [];
  // A new workshop check that does not reach the entrypoint leaves the local contract intact.
  checks.push({ id: 'd', script: 'scripts/d.mjs', environment: 'workshop' });
  nodes.set('scripts/d.mjs', { dependencies: [] });
  assert.equal(select().checks.length, 2);
  // Once the served page reaches the module, every workshop check reaches it.
  nodes.get('index.html').dependencies.push('src/shared.mjs');
  assert.equal(select().checks.length, 4);
  // A self-hosted check may load any module at runtime and always invalidates the contract.
  nodes.get('index.html').dependencies = [];
  checks.pop();
  checks.push({ id: 'e', script: 'scripts/e.mjs', environment: 'self' });
  nodes.set('scripts/e.mjs', { dependencies: [] });
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
    reachingChecks: browserScopeRoots(checks, graph, 'scripts/read.mjs'),
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
    reachingChecks: browserScopeRoots(checks, graph, reader),
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

test('audio probe readers are selected for every audio entrypoint; an audio local row must declare every reader', async () => {
  const { readFileSync } = await import('node:fs');
  const { buildModuleGraph } = await import('../scripts/module-graph.mjs');
  const { selectAffectedBrowserChecks, browserGraphEntrypoints } = await import(
    '../scripts/browser-selection.mjs'
  );
  // Checks drive the served page and import no audio module, so the reader set is a text
  // probe over check scripts — a declared heuristic, not graph evidence. A comment that
  // names the probe surface counts (conservative on purpose).
  const probe = /impactVoiceStarts|readAudio\(|['"]Sound (?:on|off)['"]/;
  const readersOf = (checks, read) =>
    checks.filter((c) => probe.test(read(c.script))).map((c) => c.id);
  assert.deepEqual(
    readersOf([{ id: 'commented', script: 'x' }], () => '// probe: readAudio() in a comment'),
    ['commented'],
  );
  const m = readManifest(),
    checks = browserChecks(),
    graph = buildModuleGraph(process.cwd(), {
      purpose: 'test-selection',
      entrypoints: browserGraphEntrypoints(process.cwd()),
    }),
    readers = readersOf(checks, (script) => readFileSync(script, 'utf8')).sort();
  assert.ok(readers.includes('verify-ball-browser') && readers.includes('verify-mechanical-audio'));
  const entrypoints = [
    'src/presentation/mechanical-audio.mjs',
    'src/presentation/mechanical-audio-model.mjs',
    'src/presentation/sound-controls.mjs',
    'src/application/mechanical-audio-adapter.mjs',
  ];
  const missing = (scopes, file) => {
    const selected = new Set(
      selectAffectedBrowserChecks({ checks, graph, files: [file], scopes }).checks.map((c) => c.id),
    );
    return readers.filter((id) => !selected.has(id));
  };
  for (const file of entrypoints) {
    assert.ok(graph.nodes.has(file), `${file} is in the served graph`);
    assert.deepEqual(missing(m.browserLocalScopes, file), [], `${file} selects every audio reader`);
  }
  // Negative control: a local row for an audio entrypoint that declares only one reader
  // narrows selection to that reader; the guarantee must report the omitted reader.
  const file = entrypoints[0],
    node = graph.nodes.get(file),
    narrowed = [
      ...m.browserLocalScopes,
      {
        entrypoint: file,
        checks: ['verify-mechanical-audio'],
        dependencies: [...node.dependencies].sort(),
        externalImports: (node.imports ?? [])
          .filter((i) => i.target === null)
          .map((i) => i.specifier)
          .sort(),
        consumers: browserScopeConsumers(graph, file),
        reachingChecks: browserScopeRoots(checks, graph, file),
      },
    ];
  assert.equal(
    selectAffectedBrowserChecks({ checks, graph, files: [file], scopes: narrowed }).scope,
    'local-contract',
    'the fabricated row must actually match, or the control proves nothing',
  );
  assert.deepEqual(missing(narrowed, file), ['verify-ball-browser']);
});

test('timing-sensitive checks are a registered fact: declared rows run exclusively and every budget assertion declares itself', async () => {
  const { timingSensitiveChecks, TIMING_ASSERTION } = await import(
    '../scripts/browser-registry.mjs'
  );
  const m = readManifest();
  const declared = timingSensitiveChecks(m.browserChecks)
    .map((c) => c.id)
    .sort();
  // The eight rows measured as budget-asserting on 2026-09-14; the guard below, not this
  // list, is what keeps the set honest when a new check starts asserting a budget.
  assert.deepEqual(declared, [
    'measure-cameras',
    'measure-gears',
    'qualify-workshop',
    'verify-adaptive-graphics',
    'verify-camera-browser',
    'verify-lamp-performance',
    'verify-mechanical-audio',
    'verify-spring-performance',
  ]);
  for (const c of timingSensitiveChecks(m.browserChecks))
    assert.notEqual(c.execution, 'parallel', `${c.id} must run exclusively`);
  // Source guard: a script that asserts a p95/quantile/budget must be declared.
  const { readFileSync } = await import('node:fs');
  for (const c of m.browserChecks)
    if (TIMING_ASSERTION.test(readFileSync(c.script, 'utf8')))
      assert.ok(
        c.timingSensitive === true,
        `${c.id} asserts a timing budget but is not declared timingSensitive`,
      );
  assert.doesNotThrow(() => validateBrowserCoverage());
  for (const [mutate, message] of [
    [(x) => (x.browserChecks[0].timingSensitive = 'yes'), /invalid timingSensitive metadata/],
    [
      (x) => {
        const row = x.browserChecks.find((c) => c.id === 'verify-camera-browser');
        row.timingSensitive = true;
        row.execution = 'parallel';
      },
      /timing-sensitive checks run exclusively/,
    ],
  ]) {
    const mutated = structuredClone(m);
    mutate(mutated);
    assert.throws(() => validateManifest(mutated), message);
  }
  // Negative control for the guard: an undeclared budget-asserting script is refused.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'timing-guard-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync('scripts/manifest.json', join(root, 'scripts/manifest.json'));
    for (const c of m.browserChecks) cpSync(c.script, join(root, c.script));
    const undeclared = m.browserChecks.find((c) => !c.timingSensitive);
    writeFileSync(
      join(root, undeclared.script),
      readFileSync(undeclared.script, 'utf8') + "\nassert.ok(p95 <= 1, 'sneaky budget');\n",
    );
    assert.throws(
      () => validateBrowserCoverage(root),
      new RegExp(`timing budget assertion requires timingSensitive: ${undeclared.script}`),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checks moved into the headless pool launch the ui profile and stay registered parallel', async () => {
  const { readFileSync } = await import('node:fs');
  const m = readManifest();
  // Re-registered 2026-09-14 after an assertion-level audit: none of these asserts on window
  // focus, tab capture or a timing budget; their exclusivity was only the profile literal. On
  // the first phased run the six former focus checks took 4.1x their headed duration under the
  // headless shell — SwiftShader, not contention (the duration audit found the shell renders
  // on Metal when asked); the ui profile now asks, so they pool.
  const moved = [
    'verify-property-focus',
    'verify-recording-browser',
    'verify-rope-browser',
    'verify-load-cell-browser',
    'verify-load-cell-force-browser',
    'verify-load-cell-copy-browser',
    'verify-mirror-browser',
    'verify-authorable-scenes',
  ];
  for (const id of moved) {
    const row = m.browserChecks.find((c) => c.id === id);
    assert.equal(row?.execution, 'parallel', `${id} is registered parallel`);
    assert.equal(row.environment, 'workshop');
    assert.notEqual(row.timingSensitive, true);
    const source = readFileSync(row.script, 'utf8');
    assert.doesNotMatch(
      source,
      /profile\s*:\s*['"](?:focus|recording|performance)['"]|headless\s*:\s*false/,
      `${id} launches headless ui`,
    );
  }
  // assembly-ux stays pooled with a watchdog that admits the pool's measured contention: its
  // serial duration (84.7 s under ≈4 external load) was 94 % of the old 90 s watchdog, and the
  // first phased run fired it at 1.15x with 17 of 19 evidence sections written — slow, not hung.
  const assemblyUx = m.browserChecks.find((c) => c.id === 'verify-assembly-ux-browser');
  assert.equal(assemblyUx.execution, 'parallel');
  assert.equal(assemblyUx.timeoutMs, 120000);
  // The runtime guard still refuses a parallel launch that is not headless ui: keep the
  // registry guard as the negative control (it throws for a parallel row with a focus profile).
  assert.doesNotThrow(() => validateBrowserCoverage());
});

test('parallel self-hosted checks prove isolation from source: port 0, per-check artifact roots, no Vite dev server', async () => {
  const { selfCheckIsolationProblems } = await import('../scripts/browser-registry.mjs');
  const { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } = await import(
    'node:fs'
  );
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const m = readManifest();
  const pooledSelf = m.browserChecks.filter(
    (c) => c.environment === 'self' && c.execution === 'parallel',
  );
  assert.deepEqual(pooledSelf.map((c) => c.id).sort(), [
    'verify-cloud-runtime',
    'verify-feedback-flow',
    'verify-feedback-lifecycle',
    'verify-feedback-receipts',
  ]);
  const read = (p) => readFileSync(p, 'utf8');
  for (const c of pooledSelf)
    assert.deepEqual(selfCheckIsolationProblems(c.script, read), [], c.id);
  // feedback-recovery proves isolation too but stays in the lane: its consecutive unchecks race
  // the dialog's render() (feedback-client.mjs:282 rewrites a checkbox from a draft whose save
  // is still pending); the lane only restores the timing that let it pass, so it is timing-
  // dependent until the application fix lands, then one manifest field pools it again.
  const recovery = m.browserChecks.find((c) => c.id === 'verify-feedback-recovery');
  assert.equal(recovery.execution, 'exclusive');
  assert.deepEqual(selfCheckIsolationProblems(recovery.script, read), []);
  // The Vite-hosted checks are not isolated (shared dependency-optimizer cache) and stay exclusive.
  for (const id of ['verify-part-help-window', 'verify-mechanical-audio']) {
    const c = m.browserChecks.find((x) => x.id === id);
    assert.equal(c.execution, 'exclusive');
    assert.ok(
      selfCheckIsolationProblems(c.script, read).includes('vite dev server (shared cache)'),
    );
  }
  // Wrapper imports are followed one level: cloud-runtime's server lives in ./playtest/verify-runtime.mjs.
  assert.deepEqual(
    selfCheckIsolationProblems('scripts/verify-cloud-runtime.mjs', (p) =>
      p.endsWith('verify-runtime.mjs') ? 'createServer().listen(4173)' : read(p),
    ),
    ['fixed port'],
  );
  assert.deepEqual(
    selfCheckIsolationProblems(
      'x',
      () => "writeFileSync('artifacts/shared/out.json', body); listen(0)",
    ),
    ['artifact path outside the per-check root'],
  );
  // Negative control through the registry itself: a fabricated pooled self row with a fixed port is refused.
  const root = mkdtempSync(join(tmpdir(), 'self-isolation-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const c of m.browserChecks) cpSync(c.script, join(root, c.script));
    const target = pooledSelf.find((c) => c.id === 'verify-feedback-receipts');
    writeFileSync(
      join(root, target.script),
      read(target.script).replace('listen(0,', 'listen(4173,'),
    );
    assert.throws(
      () => validateBrowserCoverage(root),
      new RegExp(`parallel self-hosted check must be isolated: ${target.script}: fixed port`),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
