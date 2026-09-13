import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeResponse } from '../src/simulation/physics/native-response.mjs';
test('prepared reaction reader preserves joint attribution separately from body totals', () => {
  const prefix = Array(12).fill(0);
  const factor = {
    projectWithJointImpulses: () => new Float64Array([...prefix, 1, 2, 3, -1, -2, -3]),
    responseWithJointImpulses: () => new Float64Array([...prefix, 4, 5, 6, -4, -5, -6]),
    project: () => new Float64Array(prefix),
    response: () => new Float64Array(prefix),
    free() {},
  };
  const reader = readNativeResponse(factor, 1, 2);
  assert.deepEqual(reader.project(Array(6).fill(0)).jointImpulses, [1, 2, 3, -1, -2, -3]);
  assert.deepEqual(reader.response(Array(6).fill(0)).jointImpulses, [4, 5, 6, -4, -5, -6]);
  factor.projectWithJointImpulses = () => new Float64Array(prefix);
  assert.throws(() => reader.project(Array(6).fill(0)), /invalid native response/);
  reader.dispose();
  assert.throws(() => reader.project(Array(6).fill(0)), /disposed/);
});
