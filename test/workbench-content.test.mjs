import test from 'node:test';
import assert from 'node:assert/strict';
import { movementScope } from '../src/presentation/workbench-content.mjs';

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
