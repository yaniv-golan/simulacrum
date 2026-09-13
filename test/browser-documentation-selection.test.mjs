import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectAffectedBrowserChecks,
  browserScopeConsumers,
  browserScopeRoots,
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
