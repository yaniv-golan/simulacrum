import test from 'node:test';
import assert from 'node:assert/strict';
import { queryNavigation } from '../scripts/navigation.mjs';
const graph = {
  root: '.',
  errors: [],
  files: ['src/a.mjs', 'src/b.mjs', 'test/a.test.mjs'],
  nodes: new Map([
    ['src/a.mjs', { dependencies: new Set() }],
    ['src/b.mjs', { dependencies: new Set(['src/a.mjs']) }],
    ['test/a.test.mjs', { dependencies: new Set(['src/b.mjs']) }],
  ]),
};
const read = (path) => (path === 'src/a.mjs' ? 'export function canonicalPolicy() {}' : '');
test('navigation resolves symbols and reverse test consumers through actual graph edges', () => {
  const result = queryNavigation(graph, 'canonicalPolicy', { read });
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'src/a.mjs');
  assert.deepEqual(result[0].consumers, ['src/b.mjs']);
  assert.deepEqual(result[0].tests, ['test/a.test.mjs']);
  assert.deepEqual(queryNavigation(graph, 'doesNotExist', { read }), []);
});
test('removing a consumer edge removes the claimed test path; imports remain directional', () => {
  const changed = { ...graph, nodes: new Map(graph.nodes) };
  changed.nodes.set('src/b.mjs', { dependencies: new Set() });
  assert.deepEqual(queryNavigation(changed, 'src/a.mjs', { read })[0].tests, []);
  assert.deepEqual(queryNavigation(graph, 'src/b.mjs', { read })[0].imports, ['src/a.mjs']);
});
