import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeChangeInspection,
  parseChangeInspectionArgs,
} from '../scripts/change-inspection.mjs';
const node = (dependencies = [], opaqueInputs = false) => ({
  dependencies: new Set(dependencies),
  opaqueInputs,
});
function inputs() {
  return {
    graph: {
      root: '.',
      errors: [],
      files: [
        'src/policy.mjs',
        'src/view.mjs',
        'test/view.test.mjs',
        'test/opaque.test.mjs',
        'scripts/browser.mjs',
      ],
      nodes: new Map([
        ['src/policy.mjs', node()],
        ['src/view.mjs', node(['src/policy.mjs'])],
        ['test/view.test.mjs', node(['src/view.mjs'])],
        ['test/opaque.test.mjs', node([], true)],
        ['scripts/browser.mjs', node(['src/view.mjs'])],
      ]),
    },
    manifest: {
      invariants: [
        {
          id: 'view-policy',
          owners: [{ path: 'src/view.mjs', anchor: 'view' }],
          controls: { positive: [], negative: [] },
          checks: ['browser'],
          qualificationBars: [],
        },
      ],
      checks: [],
      exitObligations: {},
      browserChecks: [
        { id: 'browser', script: 'scripts/browser.mjs' },
        { id: 'other', script: 'scripts/unrelated.mjs' },
      ],
    },
    documentation: {
      errors: [],
      sections: [
        {
          file: 'docs/development/map.md',
          id: 'view',
          dependencies: { 'src/view.mjs': 'hash', 'src/policy.mjs#policy': 'hash' },
          stale: false,
        },
        {
          file: 'docs/development/other.md',
          id: 'other',
          dependencies: { 'src/unrelated.mjs': 'hash' },
          stale: true,
        },
      ],
    },
    read: () => 'export function policy() {}',
  };
}
test('one report derives owners, invariants, exact tests, browser paths and documentation impacts', () => {
  const input = inputs(),
    before = structuredClone(input.graph.nodes);
  const report = composeChangeInspection({ ...input, files: ['src/policy.mjs'] });
  assert.equal(report.executed, false);
  assert.equal(report.owners[0].path, 'src/policy.mjs');
  assert.equal(report.invariants[0].id, 'view-policy');
  assert.deepEqual(
    report.tests.causal.map((x) => x.test),
    ['test/view.test.mjs'],
  );
  assert.deepEqual(
    report.tests.conservative.map((x) => x.test),
    ['test/opaque.test.mjs'],
  );
  assert.deepEqual(report.browserChecks[0].dependencyPath, [
    'scripts/browser.mjs',
    'src/view.mjs',
    'src/policy.mjs',
  ]);
  assert.equal(report.browserChecks[1].dependencyPath, null);
  assert.equal(report.browserChecks[1].status, 'REGISTERED_NOT_EXECUTED');
  assert.deepEqual(
    report.documentation.sections.map((x) => x.id),
    ['view'],
  );
  assert.deepEqual(input.graph.nodes, before);
});
test('removing dependency edges removes inferred relevance; unknown paths retain all-test fallback', () => {
  const input = inputs();
  input.graph.nodes.set('src/view.mjs', node());
  const report = composeChangeInspection({ ...input, files: ['src/policy.mjs'] });
  assert.deepEqual(report.invariants, []);
  assert.equal(report.browserChecks[0].dependencyPath, null);
  assert.deepEqual(report.tests.causal, []);
  const unknown = composeChangeInspection({ ...input, files: ['src/missing.mjs'] });
  assert.equal(unknown.tests.selectedCount, 2);
  assert.match(unknown.tests.fallback, /unknown changed inputs/);
});
test('change inspection accepts explicit files only and rejects ambiguous options', () => {
  assert.deepEqual(parseChangeInspectionArgs(['--files', 'src/a.mjs', 'src/b.mjs']), [
    'src/a.mjs',
    'src/b.mjs',
  ]);
  for (const args of [
    [],
    ['--all'],
    ['--files'],
    ['--files', 'src/a.mjs', '--summary'],
    ['--files', 'src/a.mjs', '--wat'],
  ])
    assert.throws(() => parseChangeInspectionArgs(args));
});
test('removed documentation dependencies and unknown selection fallback remain explicit', () => {
  const input = inputs();
  input.documentation.sections[1].reviewDependencies = { 'src/policy.mjs': 'old' };
  const report = composeChangeInspection({ ...input, files: ['src/policy.mjs'] });
  assert.deepEqual(
    report.documentation.sections.map((x) => x.id),
    ['view', 'other'],
  );
  const unknown = composeChangeInspection({ ...input, files: ['missing'] });
  assert.equal(unknown.fallback, unknown.tests.fallback);
});

test('default report contains each selected reason once and compact browser discovery fields', () => {
  const input = inputs();
  input.manifest.browserChecks[0].timeoutMs = 90000;
  const report = composeChangeInspection({ ...input, files: ['src/policy.mjs'] });
  assert.deepEqual(Object.keys(report.tests).sort(), [
    'causal',
    'conservative',
    'fallback',
    'selectedCount',
    'total',
  ]);
  assert.equal(report.tests.total, 2);
  assert.equal(report.tests.selectedCount, 2);
  assert.deepEqual(Object.keys(report.browserChecks[0]).sort(), [
    'dependencyPath',
    'id',
    'invariantIds',
    'script',
    'status',
  ]);
});
test('CLI emits report before returning failure for parse or documentation issues', async () => {
  const { runInspectionCLI } = await import('../scripts/inspect-change.mjs');
  for (const [parseErrors, errors, expected] of [
    [[], [], 0],
    [[{ path: 'bad.mjs' }], [], 1],
    [[], ['stale review'], 1],
  ]) {
    const report = {
      analysis: { format: 'change-inspection/v1' },
      value: { parseErrors, documentation: { errors } },
    };
    const output = [];
    const status = await runInspectionCLI(['--files', 'src/policy.mjs', '--json'], {
      inspect: async () => report,
      write: (text) => output.push(text),
    });
    assert.equal(status, expected);
    assert.deepEqual(
      output.map((text) => JSON.parse(text)),
      [report],
    );
  }
});

test('concise discovery preserves errors, fallback, identity and required checks', async () => {
  const { summarizeChangeInspection } = await import('../scripts/change-inspection.mjs');
  const report = {
    analysis: { contentIdentity: 'source123' },
    value: composeChangeInspection({ ...inputs(), files: ['src/policy.mjs'] }),
  };
  const text = summarizeChangeInspection(report);
  assert.match(text, /source123/);
  assert.match(text, /2\/2.*1 causal.*1 conservative/);
  assert.match(text, /view-policy/);
  assert.match(text, /browser/);
  assert.match(text, /other/);
  assert.match(text, /No checks executed/);
  report.value.documentation.errors.push('stale review');
  report.value.parseErrors.push({ path: 'broken.mjs', message: 'bad syntax' });
  report.value.tests.fallback = 'unknown changed inputs';
  const failed = summarizeChangeInspection(report);
  assert.match(failed, /stale review/);
  assert.match(failed, /broken.mjs/);
  assert.match(failed, /unknown changed inputs/);
});

test('concise discovery enumerates the affected browser selection by id, collapsed by reason', async () => {
  const { summarizeChangeInspection } = await import('../scripts/change-inspection.mjs');
  const report = {
    analysis: { contentIdentity: 'source123' },
    value: composeChangeInspection({ ...inputs(), files: ['src/policy.mjs'] }),
  };
  // A waived tier must still be able to say which checks it skipped: every selected id
  // is printed, with its selection reason; identical reasons collapse into one line.
  report.value.browserSelection = {
    checks: [{ id: 'browser' }, { id: 'other' }, { id: 'third' }],
    reasons: [
      {
        id: 'browser',
        reason: 'changed dependency',
        path: ['scripts/browser.mjs', 'src/view.mjs', 'src/policy.mjs'],
      },
      { id: 'other', reason: 'opaque runtime input', path: ['scripts/unrelated.mjs', 'x.mjs'] },
      { id: 'third', reason: 'opaque runtime input', path: ['scripts/third.mjs', 'x.mjs'] },
    ],
    fallback: null,
    unknownInputs: [],
  };
  const text = summarizeChangeInspection(report);
  assert.match(text, /Executable conservative browser selection: 3\/2\./);
  assert.match(
    text,
    /affected \(changed dependency, 1\): browser via scripts\/browser.mjs → src\/view.mjs → src\/policy.mjs/,
  );
  assert.match(text, /affected \(opaque runtime input, 2\): other, third/);
  // A local contract's `path` is the changed-file list, not a chain; a long chain is elided.
  report.value.browserSelection = {
    checks: [{ id: 'browser' }, { id: 'other' }],
    reasons: [
      {
        id: 'browser',
        reason: 'manifest local behavioral contract',
        path: ['src/a.mjs', 'src/b.mjs'],
      },
      { id: 'other', reason: 'changed dependency', path: ['w', 'x', 'y', 'z'] },
    ],
    fallback: null,
    unknownInputs: [],
  };
  const mixed = summarizeChangeInspection(report);
  assert.match(
    mixed,
    /affected \(manifest local behavioral contract, 1\): browser for src\/a.mjs, src\/b.mjs$/m,
  );
  assert.match(mixed, /affected \(changed dependency, 1\): other via … → x → y → z$/m);
  assert.equal((text.match(/^ {2}affected/gm) ?? []).length, 2, 'one line per distinct reason');
  assert.doesNotMatch(text, /affected: none/);
  // Fallback selection still lists every id: a fallback names why, never a substitute for what.
  report.value.browserSelection = {
    checks: [{ id: 'browser' }, { id: 'other' }],
    reasons: [
      { id: 'browser', reason: 'unknown changed inputs', path: null, inputs: ['mystery.bin'] },
      { id: 'other', reason: 'unknown changed inputs', path: null, inputs: ['mystery.bin'] },
    ],
    fallback: 'unknown changed inputs',
    unknownInputs: ['mystery.bin'],
  };
  const fallback = summarizeChangeInspection(report);
  assert.match(fallback, /affected \(unknown changed inputs, 2\): browser, other/);
  assert.match(fallback, /Unknown browser inputs: mystery.bin/);
  // An empty selection says so once and prints no ids.
  report.value.browserSelection = { checks: [], reasons: [], fallback: null, unknownInputs: [] };
  const empty = summarizeChangeInspection(report);
  assert.equal((empty.match(/^ {2}affected/gm) ?? []).length, 1);
  assert.match(empty, /^ {2}affected: none$/m);
});

test('live inspection and execution discovery use the same local browser contracts', async () => {
  const { inspectChange } = await import('../scripts/change-inspection.mjs');
  const { affectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
  const files = ['src/presentation/part-help.mjs'];
  const inspected = await inspectChange(process.cwd(), { files });
  assert.deepEqual(
    inspected.value.browserSelection.checks.map((c) => c.id),
    affectedBrowserChecks(files).checks.map((c) => c.id),
  );
});
