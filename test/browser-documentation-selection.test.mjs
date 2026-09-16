import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  selectAffectedBrowserChecks,
  browserScopeConsumers,
  browserScopeRoots,
  browserConsumerSourceHash,
} from '../scripts/browser-selection.mjs';

test('unit-only documentation readers do not expand browsers, but browser and opaque readers do', () => {
  const doc = 'docs/development/README.md';
  const checks = [
    { id: 'help', script: 'help', environment: 'workshop' },
    { id: 'other', script: 'other', environment: 'workshop' },
  ];
  const graph = {
    errors: [],
    nodes: new Map([
      ['help', { dependencies: ['copy'] }],
      ['copy', { dependencies: [] }],
      ['other', { dependencies: [] }],
      ['index.html', { dependencies: [] }],
      ['test/docs.test.mjs', { dependencies: [doc] }],
      [doc, { dependencies: [] }],
    ]),
  };
  const scopes = [
    {
      entrypoint: 'copy',
      dependencies: [],
      checks: ['help'],
      consumers: browserScopeConsumers(graph, 'copy'),
      reachingChecks: browserScopeRoots(checks, graph, 'copy'),
    },
  ];
  const select = (files) => selectAffectedBrowserChecks({ checks, graph, files, scopes });
  assert.equal(select([doc]).scope, 'documentation');
  assert.deepEqual(select([doc]).checks, []);
  assert.deepEqual(
    select([doc, 'copy']).checks.map((c) => c.id),
    ['help'],
  );
  graph.nodes.get('other').dependencies.push(doc);
  assert.deepEqual(
    select([doc]).checks.map((c) => c.id),
    ['other'],
  );
  assert.ok(select([doc, 'copy']).checks.some((c) => c.id === 'other'));
  graph.nodes.get('other').dependencies = [];
  graph.nodes.get('other').opaqueInputs = true;
  assert.ok(select([doc]).checks.some((c) => c.id === 'other'));
  assert.deepEqual(
    select([doc, 'copy']).checks.map((c) => c.id),
    ['help', 'other'],
  );
});

test('selection reports why a metadata row is not audited so a widened selection names its cause', () => {
  const checks = [{ id: 'help', script: 'help', environment: 'workshop' }];
  const graph = {
    errors: [],
    nodes: new Map([
      ['help', { dependencies: ['reader'], imports: [] }],
      [
        'reader',
        { dependencies: [], imports: [], opaqueInputs: true, opaqueReads: ['execFileSync(bin)'] },
      ],
      ['index.html', { dependencies: [], imports: [] }],
      ['docs/development/README.md', { dependencies: [] }],
    ]),
  };
  const row = (reads) => ({
    entrypoint: 'reader',
    sourceSha256: createHash('sha256').update('reader-source').digest('hex'),
    dependencies: [],
    externalImports: [],
    reads,
    consumers: browserScopeConsumers(graph, 'reader'),
    reachingChecks: browserScopeRoots(checks, graph, 'reader'),
    checks: ['controls'],
  });
  const select = (metadataScopes) =>
    selectAffectedBrowserChecks({
      checks,
      graph,
      files: ['docs/development/README.md'],
      scopes: [],
      metadataScopes,
      readSource: (p) => `${p}-source`,
      // consumerSourceHash is computed by the selector; a row that omits it is unaudited for
      // that reason, so the fixture asserts on the read reason it injects first.
    });
  // The 2026-09-15 row: purpose set, exclusions empty.
  const partial = select([
    row([{ expression: 'execFileSync(bin)', purpose: 'runtime', excludedInputs: [] }]),
  ]);
  assert.equal(partial.audit.readKindsAudited, false);
  assert.ok(partial.audit.unaudited.length >= 1);
  assert.equal(partial.audit.unaudited[0].entrypoint, 'reader');
  assert.match(partial.audit.unaudited[0].reason, /execFileSync\(bin\)/);
  assert.match(partial.audit.unaudited[0].reason, /must exclude documentation and unit-test/);
  assert.ok(partial.checks.length >= 1, 'documentation reached an unaudited reader: conservative');
  // No row at all names that, not a field.
  const none = select([]);
  assert.equal(none.audit.readKindsAudited, false);
  assert.match(none.audit.unaudited[0].reason, /no metadata scope row/);
  // An environment override is a named reason too.
  const env = selectAffectedBrowserChecks({
    checks,
    graph,
    files: ['docs/development/README.md'],
    scopes: [],
    metadataScopes: [],
    readSource: (p) => `${p}-source`,
    metadataEnvironmentSafe: false,
  });
  assert.equal(env.audit.readKindsAudited, false);
  assert.match(env.audit.unaudited[0].reason, /environment override/);
  // A complete row is audited: the documentation-only shape carries an empty unaudited list.
  const complete = row([
    {
      expression: 'execFileSync(bin)',
      purpose: 'runtime',
      excludedInputs: ['documentation', 'unit-test'],
    },
  ]);
  complete.consumerSourceHash = browserConsumerSourceHash(
    graph,
    'reader',
    (p) => `${p}-source`,
    checks,
  );
  const audited = select([complete]);
  assert.deepEqual(audited.audit, { readKindsAudited: true, unaudited: [] });
  assert.equal(audited.scope, 'documentation');
  assert.deepEqual(audited.checks, []);
  // The manifest local-contract shape carries the audit block as well.
  const local = {
    errors: [],
    nodes: new Map([
      ['help', { dependencies: ['copy'], imports: [] }],
      ['copy', { dependencies: [], imports: [] }],
      ['index.html', { dependencies: [], imports: [] }],
    ]),
  };
  const contract = selectAffectedBrowserChecks({
    checks,
    graph: local,
    files: ['copy'],
    scopes: [
      {
        entrypoint: 'copy',
        dependencies: [],
        externalImports: [],
        checks: ['help'],
        consumers: browserScopeConsumers(local, 'copy'),
        reachingChecks: browserScopeRoots(checks, local, 'copy'),
      },
    ],
    metadataScopes: [],
    readSource: (p) => p,
  });
  assert.equal(contract.scope, 'local-contract');
  assert.deepEqual(contract.audit, { readKindsAudited: true, unaudited: [] });
});
