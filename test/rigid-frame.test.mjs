import test from 'node:test';
import assert from 'node:assert/strict';
import { transformPoseBetweenFrames } from '../src/model/transforms.mjs';
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-12, `${a} != ${b}`));
const identity = [0, 0, 0, 1],
  quarter = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
test('rigid frames translate and rotate offsets, not world positions', () => {
  const from = { position: [10, 20, 30], rotation: identity };
  const to = { position: [2, 3, 4], rotation: quarter };
  const pose = { position: [11, 20, 30], rotation: identity };
  const result = transformPoseBetweenFrames(pose, from, to);
  near(result.position, [2, 4, 4]);
  near(result.rotation, quarter);
  near(transformPoseBetweenFrames(result, to, from).position, pose.position);
  assert.notDeepEqual(result.position, [13, 23, 34]);
  assert.deepEqual(pose.position, [11, 20, 30]);
});
test('rigid frame composition respects rotated source and quaternion sign equivalence', () => {
  const from = { position: [1, 2, 3], rotation: quarter };
  const to = { position: [4, 5, 6], rotation: identity };
  const pose = { position: [1, 3, 3], rotation: quarter };
  near(transformPoseBetweenFrames(pose, from, to).position, [5, 5, 6]);
  near(transformPoseBetweenFrames(pose, from, to).rotation, identity);
  const opposite = { ...from, rotation: quarter.map((v) => -v) };
  near(transformPoseBetweenFrames(pose, opposite, to).position, [5, 5, 6]);
});
