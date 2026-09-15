import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementScope,
  footerModel,
  modeControlState,
  firstRunDecision,
  FIRST_RUN_KEY,
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
