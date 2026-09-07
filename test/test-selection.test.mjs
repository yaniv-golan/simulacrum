import test from 'node:test';
import assert from 'node:assert/strict';
import { explainAffectedTests } from '../scripts/module-graph.mjs';
import { parseTestSelectionArgs, summarizeTestSelection } from '../scripts/test-selection.mjs';
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
    summary: false,
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

test('summary groups causal and opaque reasons without changing exact selection', () => {
  const g = graph();
  g.nodes.get('test/b.test.mjs').opaqueInputs = true;
  const result = explainAffectedTests(g, ['data.json']);
  const before = structuredClone(result);
  const text = summarizeTestSelection(result, { totalTests: 2 });
  assert.match(text, /DRY RUN.*no tests executed/i);
  assert.match(text, /Causal dependency: 1/);
  assert.match(text, /test\/a.test.mjs.*src\/a.mjs.*data.json/);
  assert.match(text, /Conservative opaque input: 1/);
  assert.deepEqual(result, before);
  const fallback = summarizeTestSelection(explainAffectedTests(g, ['unknown']), { totalTests: 2 });
  assert.match(fallback, /All-suite fallback: 2/);
  assert.match(fallback, /unknown changed inputs/);
  assert.doesNotMatch(fallback, /Causal dependency: [1-9]/);
});
test('summary is explicit dry-run CLI mode and rejects conflicting or unknown flags', () => {
  assert.equal(parseTestSelectionArgs(['--files', 'src/a.mjs', '--summary']).summary, true);
  assert.equal(parseTestSelectionArgs(['--all', '--summary']).all, true);
  for (const args of [
    ['--summary', '--explain'],
    ['--summary', '--summary'],
    ['--files', 'src/a.mjs', '--summery'],
    ['--files', '-wat'],
  ])
    assert.throws(() => parseTestSelectionArgs(args));
});
test('summary CLI does not execute selected tests and --explain keeps its JSON selection', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'selection-summary-'));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'test'));
    writeFileSync(join(root, 'src/input.mjs'), 'export const value = 1;');
    writeFileSync(
      join(root, 'test/probe.test.mjs'),
      "import '../src/input.mjs'; import {writeFileSync} from 'node:fs'; writeFileSync('EXECUTED','wrong');",
    );
    const cli = resolve('scripts/test-affected.mjs');
    const env = { ...process.env };
    // Launch an ordinary CLI: inherited node:test context suppresses nested --test execution.
    delete env.NODE_TEST_CONTEXT;
    const run = (flags) =>
      execFileSync(process.execPath, [cli, '--files', 'src/input.mjs', ...flags], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
    const summary = run(['--summary']);
    assert.match(summary, /DRY RUN.*1\/1 tests selected/);
    assert.equal(
      existsSync(join(root, 'EXECUTED')),
      false,
      'summary must not execute selected test code',
    );
    const explain = run(['--explain']);
    const selection = JSON.parse(explain.slice(explain.indexOf('{')));
    assert.deepEqual(selection.tests, ['test/probe.test.mjs']);
    assert.equal(existsSync(join(root, 'EXECUTED')), false);
    run([]);
    assert.equal(
      existsSync(join(root, 'EXECUTED')),
      true,
      'ordinary mode executes the same selected test',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('server preflight follows selected dependency paths without requiring a server for pure tests', async () => {
  const { selectedServerRequirements } = await import('../scripts/test-selection.mjs');
  const g = graph();
  g.nodes.get('src/a.mjs').serverListen = true;
  assert.deepEqual(selectedServerRequirements(g, ['test/a.test.mjs']), [
    { test: 'test/a.test.mjs', owner: 'src/a.mjs' },
  ]);
  assert.deepEqual(selectedServerRequirements(g, ['test/b.test.mjs']), []);
  assert.deepEqual(selectedServerRequirements(g, []), []);
});
