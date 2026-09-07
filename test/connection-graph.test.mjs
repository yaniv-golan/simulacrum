import test from 'node:test';
import assert from 'node:assert/strict';
import { mechanicalGroup, classifySelectionConnections } from '../src/model/connection-graph.mjs';
const edge = (id, kind, a, b) => ({
  id,
  kind,
  a: { part: a, port: 'axle' },
  b: { part: b, port: 'axle' },
});
const graph = () => ({
  parts: ['a', 'b', 'c', 'd', 'e', 'wire'].map((id) => ({ id })),
  connections: [
    edge('cd', 'fixed', 'c', 'd'),
    edge('bc', 'shaft', 'b', 'c'),
    edge('ab', 'fixed', 'a', 'b'),
    edge('ae', 'shaft', 'a', 'e'),
    edge('be', 'fixed', 'b', 'e'),
    edge('power', 'power', 'a', 'wire'),
    edge('signal', 'signal', 'b', 'wire'),
  ],
});
test('mechanical traversal preserves authored scan order through cycles and ignores wires', () => {
  const input = graph(),
    before = structuredClone(input);
  assert.deepEqual(mechanicalGroup(input, 'a'), ['a', 'b', 'e', 'c', 'd']);
  assert.deepEqual(mechanicalGroup(input, 'wire'), ['wire']);
  assert.deepEqual(mechanicalGroup(input, 'missing'), []);
  assert.deepEqual(input, before);
});
test('omitted edges and caller alignment eligibility constrain only mechanical traversal', () => {
  const input = graph();
  assert.deepEqual(mechanicalGroup(input, 'a', { omitConnectionIds: ['bc'] }), ['a', 'b', 'e']);
  assert.deepEqual(
    mechanicalGroup(input, 'a', { eligible: (connection) => connection.id !== 'bc' }),
    ['a', 'b', 'e'],
  );
  assert.deepEqual(
    mechanicalGroup(input, 'a', { omitConnectionIds: ['ab', 'ae'], eligible: () => true }),
    ['a'],
  );
  assert.deepEqual(mechanicalGroup(input, 'a'), ['a', 'b', 'e', 'c', 'd']);
});
test('selection boundaries classify every kind without changing connection order', () => {
  const input = graph(),
    rows = classifySelectionConnections(input, ['b', 'c']);
  assert.deepEqual(
    rows.map((row) => [row.connection.id, row.classification]),
    [
      ['cd', 'boundary'],
      ['bc', 'internal'],
      ['ab', 'boundary'],
      ['ae', 'external'],
      ['be', 'boundary'],
      ['power', 'external'],
      ['signal', 'boundary'],
    ],
  );
  assert.equal(rows[1].connection, input.connections[1]);
  assert.deepEqual(
    classifySelectionConnections(input, ['a']).filter((row) => row.classification === 'internal'),
    [],
  );
});
test('selection rejects empty, duplicate, malformed and unknown members', () => {
  const input = graph();
  for (const ids of [[], ['a', 'a'], null, 'a', [1]])
    assert.throws(
      () => classifySelectionConnections(input, ids),
      (error) => error.reasonCode === 'INVALID_COMMAND' && error.path === 'ids',
    );
  assert.throws(
    () => classifySelectionConnections(input, ['missing']),
    (error) => error.reasonCode === 'UNKNOWN_PART' && error.path === 'ids',
  );
  assert.doesNotThrow(() => classifySelectionConnections(input, ['a', 'b']));
});
