import test from 'node:test';
import assert from 'node:assert/strict';
import { finalRollingIntervals } from '../scripts/starter-motion.mjs';

test('continued rolling accepts a loop but rejects stopped and missing intervals', () => {
  const circle = Array.from({ length: 11 }, (_, i) => ({
    tick: 2400 + i * 120,
    physics: [
      { position: [2 * Math.cos((i * Math.PI) / 5), 0.1, 2 * Math.sin((i * Math.PI) / 5)] },
    ],
  }));
  assert.equal(finalRollingIntervals(circle).length, 10);
  const stopped = structuredClone(circle);
  for (let i = 6; i < stopped.length; i++) stopped[i].physics = structuredClone(stopped[5].physics);
  assert.throws(() => finalRollingIntervals(stopped), /movement/);
  assert.throws(() => finalRollingIntervals(circle.filter((_, i) => i !== 5)), /coverage/);
  const late = structuredClone(circle);
  late[4].tick += 80;
  assert.throws(() => finalRollingIntervals(late), /coverage/);
});
