import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { analyzeSnapshot } from '../scripts/analysis-snapshot.mjs';
const fixture = (t) => {
  const root = mkdtempSync(join(tmpdir(), 'analysis-snapshot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'input.mjs'), 'export const input = 1;');
  return root;
};
const analyze = () => ({
  value: { matches: [] },
  graph: { errors: [], nodes: new Map([['input.mjs', { opaqueInputs: true }]]) },
});
test('snapshot reports stable content, options and honest static completeness', async (t) => {
  const root = fixture(t),
    options = { query: 'input', allSymbols: false };
  const first = await analyzeSnapshot(root, { format: 'navigation-v1', options }, analyze);
  const again = await analyzeSnapshot(root, { format: 'navigation-v1', options }, analyze);
  assert.deepEqual(first, again);
  assert.equal(first.analysis.format, 'navigation-v1');
  assert.deepEqual(first.analysis.options, options);
  assert.match(first.analysis.contentIdentity, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.analysis.completeness.opaqueInputs, 1);
  assert.equal(first.analysis.completeness.complete, false);
  writeFileSync(join(root, 'input.mjs'), 'export const input = 2;');
  const changed = await analyzeSnapshot(root, { format: 'navigation-v1', options }, analyze);
  assert.notEqual(first.analysis.contentIdentity, changed.analysis.contentIdentity);
});
test('snapshot refuses content changes and newly discovered files during analysis', async (t) => {
  const root = fixture(t);
  for (const path of ['input.mjs', 'new.mjs']) {
    await assert.rejects(
      analyzeSnapshot(root, { format: 'test-selection-v1', options: {} }, () => {
        writeFileSync(join(root, path), 'changed');
        return analyze();
      }),
      /changed during analysis/,
    );
  }
});
test('snapshot refuses graph and declaration errors; error-free graph has complete static coverage', async (t) => {
  const root = fixture(t);
  for (const result of [
    { ...analyze(), graph: { errors: ['unresolved input'], nodes: new Map() } },
    { ...analyze(), graph: { errors: [], nodes: new Map([['docs/internal/private.mjs', {}]]) } },
    { ...analyze(), value: { parseErrors: [{ path: 'input.mjs', message: 'bad syntax' }] } },
  ])
    await assert.rejects(
      analyzeSnapshot(root, { format: 'navigation-v1', options: {} }, () => result),
      /incomplete analysis/,
    );
  const result = await analyzeSnapshot(root, { format: 'navigation-v1', options: {} }, () => ({
    value: {},
    graph: { errors: [], nodes: new Map() },
  }));
  assert.equal(result.analysis.completeness.complete, true);
});

test('private planning does not enter report identity, but public inputs do', async (t) => {
  const root = fixture(t);
  mkdirSync(join(root, 'docs/internal'), { recursive: true });
  const run = () => analyzeSnapshot(root, { format: 'navigation-v1', options: {} }, analyze);
  const before = await run();
  writeFileSync(join(root, 'docs/internal/private.md'), 'private details');
  assert.equal((await run()).analysis.contentIdentity, before.analysis.contentIdentity);
  writeFileSync(join(root, 'docs/public.md'), 'public input');
  assert.notEqual((await run()).analysis.contentIdentity, before.analysis.contentIdentity);
});
test('both report CLIs reject broken graphs and retain source-bound positive results', (t) => {
  const root = fixture(t);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (script, args) =>
    execFileSync(process.execPath, [resolve(script), ...args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  const nav = JSON.parse(run('scripts/navigate.mjs', ['input']));
  assert.equal(nav.analysis.format, 'navigation-v1');
  assert.equal(nav.matches[0].path, 'input.mjs');
  const output = run('scripts/test-affected.mjs', ['--files', 'input.mjs', '--explain']);
  const selected = JSON.parse(output.slice(output.indexOf('{')));
  assert.equal(selected.analysis.contentIdentity, nav.analysis.contentIdentity);
  writeFileSync(join(root, 'input.mjs'), "import './missing.mjs'; export const input=1;");
  for (const [script, args] of [
    ['scripts/navigate.mjs', ['input']],
    ['scripts/test-affected.mjs', ['--files', 'input.mjs', '--explain']],
    ['scripts/test-affected.mjs', ['--files', 'input.mjs', '--summary']],
  ]) {
    assert.throws(() => run(script, args), /input\.mjs: unresolved dependency \.\/missing\.mjs/);
  }
});

test('public parse diagnostics include location while private diagnostics stay sanitized', async (t) => {
  const root = fixture(t);
  await assert.rejects(
    analyzeSnapshot(root, { format: 'navigation-v1', options: {} }, () => ({
      ...analyze(),
      value: {
        parseErrors: [{ path: 'input.mjs', line: 3, column: 7, message: 'Unexpected token' }],
      },
    })),
    /input\.mjs:3:7: Unexpected token/,
  );
  for (const result of [
    {
      ...analyze(),
      graph: { errors: ['docs/internal/secret.mjs: secret contents'], nodes: new Map() },
    },
    {
      ...analyze(),
      value: { parseErrors: [{ path: 'docs/internal/secret.mjs', message: 'secret contents' }] },
    },
    { ...analyze(), graph: { errors: [], nodes: new Map([['docs/internal/secret.mjs', {}]]) } },
  ])
    await assert.rejects(
      analyzeSnapshot(root, { format: 'navigation-v1', options: {} }, () => result),
      (error) => {
        assert.match(error.message, /private input/);
        assert.doesNotMatch(error.message, /secret|docs\/internal/);
        return true;
      },
    );
});
