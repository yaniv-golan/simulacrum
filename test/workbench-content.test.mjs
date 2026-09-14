import test from 'node:test';
import assert from 'node:assert/strict';
import {
  movementScope,
  footerModel,
  modeControlState,
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
