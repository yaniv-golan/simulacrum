import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  mergeSelection,
  mergeChanges,
  reviewOnlyPolicyFiles,
  metadataOnlyPolicyFiles,
} from '../scripts/merge-selection.mjs';
const checks = [
  ...['workshop', 'selection', 'ui-lifecycle'].map((id) => ({ id, mergeSmoke: true })),
  { id: 'affected' },
  { id: 'gear' },
  { id: 'recording' },
];
const selection = { checks: [checks[3]], scope: 'local-contract', reasons: [] };

test('audited selection unions mandatory smoke in canonical order and accounts for every omission', () => {
  for (const scope of ['local-contract', 'documentation', 'non-runtime']) {
    const result = mergeSelection({
      checks,
      selection: { ...selection, scope },
      files: ['src/presentation/copy.mjs'],
    });
    assert.deepEqual(result.checks, checks.slice(0, 4));
    assert.deepEqual(
      result.omitted.map((row) => row.id),
      ['gear', 'recording'],
    );
    assert.ok([...result.selected, ...result.omitted].every((row) => row.reason));
    assert.equal(result.qualification, 'NOT_EVALUATED');
    assert.equal(result.fullReason, null);
  }
});
test('full risk wins even when supplied an apparently audited narrow classification', () => {
  for (const path of [
    'AGENTS.md',
    'docs/development/README.md',
    '.github/workflows/ci.yml',
    'scripts/tool.mjs',
    'package-lock.json',
    'vite.config.mjs',
    '.nvmrc',
    'src/model/observation.mjs',
    'src/simulation/power.mjs',
    'src/core/workshop.mjs',
    'src/scripting/vm.mjs',
  ]) {
    const result = mergeSelection({
      checks,
      selection: { ...selection, scope: 'documentation' },
      files: [path, 'src/presentation/copy.mjs'],
    });
    assert.deepEqual(result.checks, checks, path);
    assert.equal(result.scope, 'full');
  }
});
test('unknown, empty, graph-only, stale and malformed registries cannot narrow', () => {
  for (const input of [
    { files: [] },
    { selection: { ...selection, scope: undefined } },
    { selection: { ...selection, fallback: 'stale registry' } },
  ]) {
    assert.deepEqual(
      mergeSelection({ checks, selection, files: ['src/presentation/copy.mjs'], ...input }).checks,
      checks,
    );
  }
  assert.throws(
    () => mergeSelection({ checks: checks.slice(1), selection, files: ['README.md'] }),
    /registry/,
  );
  assert.throws(
    () => mergeSelection({ checks, selection: { checks: [{ id: 'alien' }] }, files: [] }),
    /selection/,
  );
});

test('real Git unions both branches and actual candidate including deletions, renames and untracked files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'merge-scope-'));
  const git = (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (path, content) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), content);
  };
  const commit = () => {
    git(['add', '.']);
    git(['commit', '-qm', 'fixture']);
    return git(['rev-parse', 'HEAD']).trim();
  };
  try {
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@example.invalid']);
    git(['config', 'user.name', 'Fixture']);
    write('README.md', 'old');
    const old = commit();
    write('delete.mjs', 'delete');
    write('rename.mjs', 'rename');
    const base = commit();
    git(['checkout', '-qb', 'incoming']);
    write('src/presentation/copy.mjs', 'incoming');
    const incoming = commit();
    git(['checkout', '-qb', 'destination', base]);
    write('src/simulation/power.mjs', 'destination');
    const destination = commit();
    git(['merge', '--no-edit', incoming]);
    rmSync(join(cwd, 'delete.mjs'));
    renameSync(join(cwd, 'rename.mjs'), join(cwd, 'renamed.mjs'));
    git(['add', '-A']);
    write('README.md', 'unstaged');
    write('new.mjs', 'untracked');
    const result = mergeChanges({ base, incoming, destination }, git);
    assert.equal(result.scopeKind, 'branch-pair');
    assert.deepEqual(result.files, [
      'README.md',
      'delete.mjs',
      'new.mjs',
      'rename.mjs',
      'renamed.mjs',
      'src/presentation/copy.mjs',
      'src/simulation/power.mjs',
    ]);
    assert.deepEqual(mergeSelection({ checks, selection, files: result.files }).checks, checks);
    assert.deepEqual(mergeChanges({ base }, git).files, result.files);
    assert.equal(mergeChanges({ base }, git).scopeKind, 'explicit-base');
    // The destination is retained as supplied beside its pinned commit; a ref name
    // (pinned to the pre-merge destination commit) stays a name so drift can be checked.
    assert.equal(result.refs.destinationName, destination);
    git(['branch', 'target', destination]);
    const named = mergeChanges({ base, incoming, destination: 'target' }, git);
    assert.equal(named.refs.destination, destination);
    assert.equal(named.refs.destinationName, 'target');
    assert.deepEqual(named.files, result.files);
    assert.equal(mergeChanges({ base }, git).refs.destinationName, undefined);
    assert.throws(() => mergeChanges({ base: old, incoming, destination }, git), /merge-base/);
    assert.throws(() => mergeChanges({ base, incoming }, git), /together/);
    git(['checkout', '-qf', 'destination']);
    git(['reset', '--hard', destination]);
    assert.throws(() => mergeChanges({ base, incoming, destination }, git));
    assert.throws(() => mergeChanges({ base: incoming }, git));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('review-only exemption compares exact nonreceipt bytes and rejects code, prose and malformed markers', () => {
  const path = 'docs/development/README.md';
  const receipt = (rationale) =>
    '<!-- doc-review ' +
    JSON.stringify({
      version: 1,
      fingerprint: 'a'.repeat(64),
      dependencyDigest: 'b'.repeat(64),
      dependencies: 'docs/development/.reviews/README/a.json',
      disposition: 'still accurate',
      rationale,
    }) +
    ' -->';
  const old = '# Policy\n\n' + receipt('old') + '\n\nKeep all rules.\n';
  const updated = old.replace(receipt('old'), receipt('new'));
  const classify = (before, after) =>
    reviewOnlyPolicyFiles(
      [path],
      'base',
      () => before,
      () => after,
    );
  assert.deepEqual(classify(old, updated), [path]);
  const allowed = mergeSelection({
    checks,
    selection: { ...selection, scope: 'documentation' },
    files: [path],
    reviewOnlyFiles: classify(old, updated),
  });
  assert.equal(allowed.fullReason, null);
  for (const after of [
    updated.replace('Keep all rules.', 'Drop rules.'),
    updated + ' ',
    updated.replace('"version":1', '"version":2'),
    updated.replace('doc-review {', 'doc-review broken {'),
    updated.replace(' -->', ' --> changed prose'),
  ])
    assert.deepEqual(classify(old, after), []);
  assert.deepEqual(classify('```html\n' + old + '```', '```html\n' + updated + '```'), []);
  assert.deepEqual(classify(old, updated.replace('<!--', '<!-- other -->\n<!--')), []);
  assert.deepEqual(
    reviewOnlyPolicyFiles(
      [path],
      'base',
      () => {
        throw Error('missing');
      },
      () => updated,
    ),
    [],
  );
  assert.equal(
    mergeSelection({
      checks,
      selection: { ...selection, scope: 'documentation' },
      files: ['docs/development/.reviews/README/a.json'],
    }).fullReason,
    null,
  );
  assert.equal(
    mergeSelection({
      checks,
      selection: { ...selection, scope: 'documentation', fallback: 'stale metadata' },
      files: ['docs/development/.reviews/README/a.json'],
    }).scope,
    'full',
  );
});

test('manifest exemption strips only reviewed scope hash values and preserves all other bytes', () => {
  const path = 'scripts/manifest.json';
  const before = {
    browserChecks: [{ id: 'workshop', mergeSmoke: true }],
    browserReviewMetadataScopes: [
      {
        sourceSha256: 'a'.repeat(64),
        consumerSourceHash: 'b'.repeat(64),
        checks: ['workshop'],
        reads: [{ expression: 'read(file)', excludedInputs: ['documentation'] }],
        dependencies: ['x.mjs'],
      },
    ],
  };
  const source = JSON.stringify(before);
  const updated = structuredClone(before);
  updated.browserReviewMetadataScopes[0].consumerSourceHash = 'c'.repeat(64);
  const classify = (after) =>
    metadataOnlyPolicyFiles(
      [path],
      'base',
      () => source,
      () => after,
    );
  assert.deepEqual(classify(JSON.stringify(updated)), [path]);
  assert.equal(
    mergeSelection({
      checks,
      selection,
      files: [path],
      metadataOnlyFiles: classify(JSON.stringify(updated)),
    }).fullReason,
    null,
  );
  for (const change of [
    (x) => {
      x.browserReviewMetadataScopes[0].checks = ['other'];
    },
    (x) => {
      x.browserReviewMetadataScopes[0].reads[0].expression = 'different';
    },
    (x) => {
      x.browserReviewMetadataScopes[0].reads[0].excludedInputs.push('runtime');
    },
    (x) => {
      x.browserReviewMetadataScopes[0].dependencies.push('y.mjs');
    },
    (x) => {
      x.browserChecks[0].mergeSmoke = false;
    },
    (x) => {
      x.browserReviewMetadataScopes[0].sourceSha256 = 'invalid';
    },
  ]) {
    const wrong = structuredClone(updated);
    change(wrong);
    assert.deepEqual(classify(JSON.stringify(wrong)), []);
  }
  assert.deepEqual(classify(JSON.stringify(updated) + ' '), []);
  assert.deepEqual(classify('{malformed'), []);
  assert.deepEqual(
    metadataOnlyPolicyFiles(
      [path],
      'base',
      () => {
        throw Error('missing');
      },
      () => source,
    ),
    [],
  );
});

test('a timing-budget row runs in a merge tier only when the delta can reach what it measures', () => {
  const timing = [
    { id: 'measure-gears', timingSensitive: true, measures: 'physics', environment: 'self' },
    { id: 'measure-cameras', timingSensitive: true, measures: 'physics', environment: 'self' },
    { id: 'verify-adaptive-graphics', timingSensitive: true, measures: 'render' },
    { id: 'verify-camera-browser', timingSensitive: true, measures: 'render' },
  ];
  const all = [...checks, ...timing];
  const run = (files, closureReached = {}) =>
    mergeSelection({ checks: all, selection: { ...selection, closureReached }, files });
  const ids = (rows) => rows.map((row) => row.id).sort();
  const omittedTiming = (result) =>
    ids(result.omitted.filter((row) => row.reason.startsWith('timing budget')));
  // Tooling-only delta: full selection for every functional row, all four timing rows omitted
  // with the reason (this is the 12-failures-a-day case).
  const tooling = run(['scripts/check-sequence.mjs']);
  assert.match(tooling.fullReason, /verification policy.*timing-budget rows by measured scope/);
  assert.deepEqual(ids(tooling.checks), ids(checks));
  assert.deepEqual(omittedTiming(tooling), ids(timing));
  assert.match(
    tooling.omitted.find((row) => row.id === 'measure-gears').reason,
    /timing budget \(physics\): its measured scope is not in the delta; nightly and final run it/,
  );
  // Presentation-only delta: the physics stopwatches are omitted, the render budgets run.
  const css = run(['src/presentation/workshop.css']);
  assert.deepEqual(omittedTiming(css), ['measure-cameras', 'measure-gears']);
  assert.ok(ids(css.checks).includes('verify-adaptive-graphics'));
  // Simulation delta: every row runs (control).
  assert.deepEqual(omittedTiming(run(['src/simulation/session.mjs'])), []);
  // The engine pin reaches everything (control).
  assert.deepEqual(omittedTiming(run(['package.json'])), []);
  // A timing row's own closure (its script, a harness module, a fixture) reaches it alone:
  // the affected walk cannot say this, the closure flag from affectedBrowserChecks can.
  const own = run(['scripts/measure-gears.mjs'], { 'measure-gears': true });
  assert.deepEqual(omittedTiming(own), [
    'measure-cameras',
    'verify-adaptive-graphics',
    'verify-camera-browser',
  ]);
  assert.ok(ids(own.checks).includes('measure-gears'));
  // Merge smoke rows are never omitted by this rule (control).
  for (const result of [tooling, css, own])
    for (const id of ['workshop', 'selection', 'ui-lifecycle'])
      assert.ok(ids(result.checks).includes(id));
  // A narrow audited selection that happened to include a timing row still applies the rule.
  const narrow = mergeSelection({
    checks: all,
    selection: {
      checks: [checks[3], timing[0]],
      scope: 'local-contract',
      reasons: [],
      closureReached: {},
    },
    files: ['src/presentation/copy.mjs'],
  });
  assert.ok(!ids(narrow.checks).includes('measure-gears'));
  assert.ok(omittedTiming(narrow).includes('measure-gears'));
});
