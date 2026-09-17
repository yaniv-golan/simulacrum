import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementScope,
  footerModel,
  modeControlState,
  firstRunDecision,
  FIRST_RUN_KEY,
  paletteKeyOpens,
  controlTitle,
  historyChord,
  LEARN_GROUPS,
  learnRow,
} from '../src/presentation/workbench-content.mjs';

test('scope predicts multi-part direct dragging and rotation before the gesture', () => {
  assert.equal(
    movementScope({ mode: 'build', tool: 'select', count: 5 }),
    'Moves 5 parts together',
  );
  assert.equal(
    movementScope({ mode: 'build', tool: 'rotate', count: 3 }),
    'Rotates 3 parts together',
  );
});

test('scope refuses irrelevant or blocked movement claims', () => {
  for (const mode of ['run', 'paused'])
    assert.equal(movementScope({ mode, tool: 'select', count: 5 }), '');
  for (const count of [0, 1])
    assert.equal(movementScope({ mode: 'build', tool: 'translate', count }), '');
  assert.equal(movementScope({ mode: 'build', tool: 'rotate', count: 5, blocked: true }), '');
});
test('footer model composes mode, count and message and drops Next when nothing is pending', () => {
  assert.deepEqual(
    footerModel({ mode: 'build', status: 'ok', tick: 0, parts: 1, message: 'Hi', next: null }),
    { mode: 'Build', parts: '1 part', message: 'Hi', next: '' },
  );
  assert.deepEqual(
    footerModel({
      mode: 'run',
      status: 'ok',
      tick: 240,
      parts: 8,
      message: '',
      next: 'Place Motor',
    }),
    { mode: 'Run · tick 240', parts: '8 parts', message: '', next: 'Next: Place Motor' },
  );
  assert.equal(
    footerModel({ mode: 'paused', status: 'failed', tick: 30, parts: 2, message: 'x' }).mode,
    'Stopped · tick 30',
  );
  assert.equal(
    footerModel({ mode: 'paused', status: 'ok', tick: 30, parts: 2 }).mode,
    'Paused · tick 30',
  );
});
test('mode switch state follows the frame mode and hides stepping in Build', () => {
  assert.deepEqual(modeControlState('build'), {
    build: true,
    run: false,
    stepping: false,
    stepEnabled: false,
  });
  assert.deepEqual(modeControlState('run'), {
    build: false,
    run: true,
    stepping: true,
    stepEnabled: false,
  });
  assert.deepEqual(modeControlState('paused'), {
    build: false,
    run: true,
    stepping: true,
    stepEnabled: true,
  });
});
test('first-run choice opens once per remembered device and never on a used bench', () => {
  const fresh = { keys: [], storage: true, hasContent: false, guideActive: false };
  assert.equal(firstRunDecision(fresh), 'modal');
  assert.equal(firstRunDecision({ ...fresh, shape: 'once' }), 'once');
  assert.equal(firstRunDecision({ ...fresh, shape: 'hint' }), null);
  assert.equal(firstRunDecision({ ...fresh, keys: [FIRST_RUN_KEY] }), null, 'answered');
  assert.equal(
    firstRunDecision({ ...fresh, keys: ['simulacrum-whats-new'] }),
    null,
    'any earlier simulacrum key is a prior visit',
  );
  assert.equal(firstRunDecision({ ...fresh, keys: ['other-app'] }), 'modal');
  assert.equal(firstRunDecision({ ...fresh, storage: false }), null, 'no storage, no modal');
  assert.equal(firstRunDecision({ ...fresh, hasContent: true }), null);
  assert.equal(firstRunDecision({ ...fresh, guideActive: true }), null);
});
test('P summons the parts only in Build and never from a text field', () => {
  assert.equal(paletteKeyOpens({ mode: 'build', editableTarget: false }), true);
  assert.equal(paletteKeyOpens({ mode: 'run', editableTarget: false }), false);
  assert.equal(paletteKeyOpens({ mode: 'paused', editableTarget: false }), false);
  assert.equal(paletteKeyOpens({ mode: 'build', editableTarget: true }), false);
});

test('control titles join the name and key, and a reason for being off replaces both', () => {
  assert.equal(controlTitle({ name: 'Run', key: 'Space' }), 'Run · Space');
  assert.equal(controlTitle({ name: 'Undo', key: '⌘Z' }), 'Undo · ⌘Z');
  assert.equal(
    controlTitle({ name: 'Undo', key: '⌘Z', reason: 'Nothing to undo' }),
    'Nothing to undo',
  );
  assert.equal(controlTitle({ name: 'Save' }), 'Save');
  assert.equal(controlTitle({ name: 'Undo', key: '⌘Z', reason: '' }), 'Undo · ⌘Z');
});

test('history chords follow the platform modifier', () => {
  assert.deepEqual(historyChord('MacIntel'), { undo: '⌘Z', redo: '⇧⌘Z' });
  assert.deepEqual(historyChord('macOS'), { undo: '⌘Z', redo: '⇧⌘Z' });
  assert.deepEqual(historyChord('iPad'), { undo: '⌘Z', redo: '⇧⌘Z' });
  assert.deepEqual(historyChord('Win32'), { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' });
  assert.deepEqual(historyChord('Linux x86_64'), { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' });
  assert.deepEqual(historyChord(undefined), { undo: 'Ctrl+Z', redo: 'Ctrl+Shift+Z' });
});

test('each Learn row keeps a short summary, its readiness clause and an honest claim', () => {
  const rows = LEARN_GROUPS.flatMap((group) => group.rows);
  assert.deepEqual(
    LEARN_GROUPS.map((group) => group.label),
    ['Start here', 'Drive and lift', 'Spring experiments'],
  );
  assert.equal(rows.length, 12, 'every entry in the browser is one row');
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'row ids identify the row');
  for (const row of rows) {
    const words = row.summary.split(/\s+/).filter((word) => word !== '·');
    assert.ok(words.length > 0 && words.length <= 10, `${row.id} summary is one short line`);
    assert.doesNotMatch(row.summary, /\.$/, `${row.id} summary is a label, not a sentence`);
    // A picker line may not claim behaviour the authored activity does not have.
    assert.doesNotMatch(row.summary, /it learns|learns by itself|teaches itself/i);
  }
  // Prerequisites advise readiness while the player is choosing, not after the machine loads.
  assert.match(learnRow('cargo-delivery').summary, /keyboard driving first/);
  assert.match(learnRow('gear-lift').summary, /motor and shaft connections first/);
  // One row edits the current machine; it says so instead of relying on its position.
  assert.match(learnRow('reusable-suspension').summary, /^Adds a module to your machine/);
  assert.deepEqual(
    rows.filter((row) => row.adds).map((row) => row.id),
    ['reusable-suspension'],
  );
});

test('an unlisted Learn row is a rendering mistake rather than a blank line', () => {
  assert.throws(() => learnRow('no-such-example'), /Unknown Learn & examples row/);
  assert.throws(() => learnRow(undefined), /Unknown Learn & examples row/);
  assert.equal(learnRow('rolling-machine').id, 'rolling-machine');
});
