import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBreadth } from '../scripts/check-breadth.mjs';
test('catalog breadth rejects later and undeclared milestones', () => {
  const manifest = { milestone: 'M2', milestones: ['M0', 'M1', 'M2', 'M3'] };
  assert.doesNotThrow(() => checkBreadth({ beam: { milestone: 'M2' } }, manifest, {}));
  assert.throws(() => checkBreadth({ motor: { milestone: 'M3' } }, manifest, {}), /breadth/);
  assert.throws(() => checkBreadth({ motor: {} }, manifest, {}), /breadth/);
});

test('UI feature breadth refuses future features', () => {
  const m = { milestone: 'M3b', milestones: ['M3b', 'M4'] };
  assert.doesNotThrow(() => checkBreadth({}, m, { editor: { milestone: 'M3b' } }));
  assert.throws(() => checkBreadth({}, m, { programming: { milestone: 'M4' } }), /breadth/);
});
