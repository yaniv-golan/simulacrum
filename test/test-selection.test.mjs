import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModuleGraph, affectedTests } from '../scripts/module-graph.mjs';
test('real repository selection is selective and keeps opaque tooling consumers', () => {
  const graph = buildModuleGraph(process.cwd(), { purpose: 'test-selection' });
  assert.deepEqual(graph.errors, []);
  const selected = affectedTests(graph, ['src/model/duplication.mjs']);
  assert.ok(selected.includes('test/duplication.test.mjs'));
  assert.ok(
    selected.includes('test/assessment.test.mjs'),
    'subprocess/file-driven tooling is conservative',
  );
  assert.ok(
    !selected.includes('test/power.test.mjs'),
    'unrelated pure unit suite stays unselected',
  );
  assert.ok(selected.length < affectedTests(graph, undefined).length);
  assert.equal(
    affectedTests(graph, ['unknown.file']).length,
    affectedTests(graph, undefined).length,
  );
});
