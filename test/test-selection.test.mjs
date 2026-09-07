import test from 'node:test';
import assert from 'node:assert/strict';
import { explainAffectedTests } from '../scripts/module-graph.mjs';
import { parseTestSelectionArgs } from '../scripts/test-selection.mjs';
const graph = () => ({
  files: ['test/a.test.mjs', 'test/b.test.mjs', 'src/a.mjs', 'data.json'],
  errors: [],
  nodes: new Map([
    [
      'test/a.test.mjs',
      { dependencies: new Set(['src/a.mjs']), imports: [{ target: 'src/a.mjs', kind: 'import' }] },
    ],
    [
      'src/a.mjs',
      { dependencies: new Set(['data.json']), imports: [{ target: 'data.json', kind: 'data' }] },
    ],
    ['data.json', { dependencies: new Set(), imports: [] }],
    ['test/b.test.mjs', { dependencies: new Set(), imports: [] }],
  ]),
});
test('focused selection explains import and data paths, with unrelated negative control', () => {
  const result = explainAffectedTests(graph(), ['data.json']);
  assert.deepEqual(result.tests, ['test/a.test.mjs']);
  assert.deepEqual(result.reasons[0].path, ['test/a.test.mjs', 'src/a.mjs', 'data.json']);
  assert.deepEqual(
    result.reasons[0].edges.map((e) => e.kind),
    ['import', 'data'],
  );
  assert.deepEqual(explainAffectedTests(graph(), ['test/b.test.mjs']).tests, ['test/b.test.mjs']);
});
test('unknown changes and graph uncertainty conservatively select all with reasons', () => {
  for (const [changed, errors] of [
    [['unknown'], []],
    [undefined, []],
    [['src/a.mjs'], ['unresolved input']],
  ]) {
    const g = graph();
    g.errors = errors;
    const result = explainAffectedTests(g, changed);
    assert.equal(result.tests.length, 2);
    assert.ok(result.fallback);
    assert.equal(result.reasons.length, 2);
  }
});
test('explicit selection CLI rejects missing/conflicting/unknown arguments', () => {
  assert.deepEqual(parseTestSelectionArgs(['--files', 'src/a.mjs', 'data.json', '--explain']), {
    all: false,
    files: ['src/a.mjs', 'data.json'],
    explain: true,
  });
  for (const args of [
    ['--files'],
    ['--all', '--files', 'a'],
    ['--wat'],
    ['a'],
    ['--explain', '--explain'],
  ])
    assert.throws(() => parseTestSelectionArgs(args));
});
