import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeShadowReport, integrationChanges } from '../scripts/merge-shadow.mjs';
const checks = [{ id: 'smoke', smoke: true }, { id: 'gear', tier: 'performance' }, { id: 'other' }];
const selection = { checks: [], reasons: [], fallback: null };
test('shadow preserves full qualification and adds registered smoke without invented coverage', () => {
  const r = mergeShadowReport({ checks, selection, files: ['src/presentation/copy.mjs'] });
  assert.deepEqual(
    r.proposed.map((x) => x.id),
    ['smoke'],
  );
  assert.deepEqual(
    r.requiredNow,
    checks.map((x) => x.id),
  );
  assert.equal(r.qualification, 'NOT_EVALUATED');
  assert.equal(r.activation, 'NOT_AUTHORIZED');
  assert.deepEqual(
    r.omitted.map((x) => x.id),
    ['gear', 'other'],
  );
  assert.equal(r.validation.status, 'NOT_EVALUATED');
});
test('shared laws and unknown changes cannot authorize omissions', () => {
  for (const files of [
    ['src/model/observation.mjs'],
    ['src/simulation/power.mjs'],
    ['src/core/workshop.mjs'],
    ['src/scripting/vm.mjs'],
  ])
    assert.deepEqual(
      mergeShadowReport({ checks, selection, files }).proposed.map((x) => x.id),
      checks.map((x) => x.id),
    );
  assert.deepEqual(
    mergeShadowReport({
      checks,
      selection: { ...selection, fallback: 'unknown changed inputs' },
      files: ['x'],
    }).omitted,
    [],
  );
});
test('historical timing is work estimate, not wall time or proof; omitted failures remain visible', () => {
  const r = mergeShadowReport({
    checks,
    selection,
    files: ['src/presentation/copy.mjs'],
    historical: {
      source: { head: 'old' },
      runs: [
        { id: 'smoke', elapsedMs: 10, status: 'passed' },
        { id: 'gear', elapsedMs: 20, status: 'failed' },
        { id: 'other', elapsedMs: 30, status: 'passed' },
      ],
    },
  });
  assert.equal(r.historical.estimate.selectedCheckWorkMs, 10);
  assert.equal(r.historical.estimate.fullCheckWorkMs, 60);
  assert.equal(r.historical.estimate.wallClockSavingsMs, null);
  assert.deepEqual(r.historical.omittedFailures, ['gear']);
  assert.equal(r.historical.coverage, 'UNPROVEN');
  assert.throws(
    () =>
      mergeShadowReport({
        checks,
        selection,
        files: ['x'],
        historical: {
          runs: [
            { id: 'smoke', elapsedMs: 1 },
            { id: 'smoke', elapsedMs: 2 },
          ],
        },
      }),
    /duplicate/,
  );
});
test('changes include both branches, resolutions, untracked files and reject unrelated base', () => {
  const commands = [];
  const git = (args) => {
    commands.push(args);
    if (args[0] === 'rev-parse') return args.at(-1).replace('^{commit}', '') + '-sha';
    if (args[0] === 'merge-base') return '';
    if (args[0] === 'ls-files') return 'new.mjs\0';
    if (args[3] === '-z' && args.length === 7)
      return args[5] === 'incoming-sha' ? 'incoming.mjs\0' : 'destination.mjs\0';
    return 'resolution.mjs\0';
  };
  const r = integrationChanges(
    { base: 'base', incoming: 'incoming', destination: 'destination' },
    git,
  );
  assert.deepEqual(r.files, ['destination.mjs', 'incoming.mjs', 'new.mjs', 'resolution.mjs']);
  assert.equal(commands.filter((x) => x[0] === 'merge-base').length, 3);
  assert.throws(
    () =>
      integrationChanges({ base: 'base', incoming: 'incoming', destination: 'destination' }, () => {
        throw Error('unrelated');
      }),
    /unrelated/,
  );
  assert.throws(() => integrationChanges({ base: 'base' }, git), /incoming/);
});
