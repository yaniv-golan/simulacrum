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
  const result = queryNavigation(graph, 'canonicalPolicy', { read }).matches;
  assert.equal(result.length, 1);
  assert.equal(result[0].path, 'src/a.mjs');
  assert.deepEqual(result[0].consumers, ['src/b.mjs']);
  assert.deepEqual(result[0].tests, ['test/a.test.mjs']);
  assert.deepEqual(queryNavigation(graph, 'doesNotExist', { read }).matches, []);
});
test('removing a consumer edge removes the claimed test path; imports remain directional', () => {
  const changed = { ...graph, nodes: new Map(graph.nodes) };
  changed.nodes.set('src/b.mjs', { dependencies: new Set() });
  assert.deepEqual(queryNavigation(changed, 'src/a.mjs', { read }).matches[0].tests, []);
  assert.deepEqual(queryNavigation(graph, 'src/b.mjs', { read }).matches[0].imports, ['src/a.mjs']);
});

const scoped = (path) =>
  path === 'src/a.mjs'
    ? `
const policy = 1;
export function owner() {
  const noise = 2;
  function nestedPolicy() { const deeperNoise = 3; }
  const nestedArrow = () => noise;
}
for (const loopNoise of []) { const blockNoise = 0; }
`
    : '';
test('path navigation shows module owners while nested function searches retain enclosing scope', () => {
  const result = queryNavigation(graph, 'src/a.mjs', { read: scoped });
  assert.deepEqual(
    result.matches[0].symbols.map((x) => x.name),
    ['policy', 'owner'],
  );
  const nested = queryNavigation(graph, 'nestedPolicy', { read: scoped }).matches[0].symbols;
  assert.deepEqual(
    nested.map((x) => [x.name, x.enclosingScope]),
    [['nestedPolicy', ['owner']]],
  );
  assert.equal(queryNavigation(graph, 'noise', { read: scoped }).matches.length, 0);
  assert.deepEqual(
    queryNavigation(graph, 'nestedArrow', { read: scoped }).matches[0].symbols[0].enclosingScope,
    ['owner'],
  );
});
test('all-symbols opts into locals without changing imports or reverse consumers', () => {
  const normal = queryNavigation(graph, 'src/a.mjs', { read: scoped }).matches[0];
  const all = queryNavigation(graph, 'src/a.mjs', { read: scoped, allSymbols: true }).matches[0];
  assert.ok(all.symbols.some((x) => x.name === 'loopNoise'));
  assert.ok(all.symbols.some((x) => x.name === 'deeperNoise'));
  assert.deepEqual(all.tests, normal.tests);
  assert.deepEqual(all.consumers, normal.consumers);
});
test('malformed source produces explicit parse errors even when no declaration matches', () => {
  const read = (path) => (path === 'src/a.mjs' ? 'export function broken(' : '');
  const result = queryNavigation(graph, 'missingSymbol', { read });
  assert.equal(result.matches.length, 0);
  assert.equal(result.parseErrors.length, 1);
  assert.equal(result.parseErrors[0].path, 'src/a.mjs');
  assert.match(result.parseErrors[0].message, /Unexpected token/);
  assert.deepEqual(queryNavigation(graph, 'owner', { read: scoped }).parseErrors, []);
});
test('export metadata includes default and destructured owners while class methods retain scope', () => {
  const read = (path) =>
    path === 'src/a.mjs'
      ? 'export const {port} = config; export default function factory() {} export class Assembly { attach() {} }'
      : '';
  const { matches } = queryNavigation(graph, 'src/a.mjs', { read });
  assert.deepEqual(
    matches[0].symbols.map((x) => [x.name, x.exported]),
    [
      ['port', true],
      ['factory', true],
      ['Assembly', true],
    ],
  );
  assert.deepEqual(
    queryNavigation(graph, 'attach', { read }).matches[0].symbols[0].enclosingScope,
    ['Assembly'],
  );
});
