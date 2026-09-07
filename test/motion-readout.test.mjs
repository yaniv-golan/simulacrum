import test from 'node:test';
import assert from 'node:assert/strict';
import { machineMotion } from '../src/model/motion-readout.mjs';
test('motion readout uses mass-weighted authored bodies and excludes terrain', () => {
  const frame = {
    metadata: { blueprint: { parts: [{}, {}] } },
    physics: [
      { mass: 1, position: [0, 1, 0], velocity: [0, 0, 2] },
      { mass: 3, position: [4, 1, 0], velocity: [0, 0, 0] },
      { mass: 1000, position: [0, 0, 0], velocity: [0, 0, 0] },
    ],
  };
  assert.deepEqual(machineMotion(frame), { center: [3, 1, 0], speed: 0.5 });
  assert.equal(machineMotion({ ...frame, metadata: { blueprint: { parts: [] } } }), null);
  const wrong = structuredClone(frame);
  wrong.physics[1].velocity = [0, 0, 2];
  assert.notEqual(machineMotion(wrong).speed, 0.5);
});
import { BUILD_ENVIRONMENT } from '../src/model/environment.mjs';
import * as motionModel from '../src/model/motion-readout.mjs';
test('workshop floor is 200 metres across and warnings follow actual configured bounds', () => {
  assert.deepEqual(BUILD_ENVIRONMENT.ground.halfExtents, [100, 0.1, 100]);
  const frame = (position) => ({
    metadata: { blueprint: { parts: [{}] } },
    physics: [{ position, mass: 1, velocity: [0, 0, 0] }],
  });
  assert.equal(typeof motionModel.machineBoundary, 'function');
  assert.equal(
    motionModel.machineBoundary(frame([13, 1, 0])),
    null,
    'old24m floor must not determine the new boundary',
  );
  assert.equal(motionModel.machineBoundary(frame([89, 1, 0])), null);
  assert.equal(motionModel.machineBoundary(frame([91, 1, 0])).kind, 'near');
  assert.equal(motionModel.machineBoundary(frame([-101, 1, 0])).kind, 'outside');
  assert.equal(motionModel.machineBoundary(frame([0, -3, 0])).kind, 'fallen');
  const custom = { position: [30, 5, -20], halfExtents: [20, 1, 40] };
  assert.equal(motionModel.machineBoundary(frame([30, 7, -20]), custom), null);
  assert.equal(motionModel.machineBoundary(frame([42, 7, -20]), custom).kind, 'near');
  assert.equal(motionModel.machineBoundary(frame([51, 7, -20]), custom).kind, 'outside');
  assert.equal(motionModel.machineBoundary(frame([30, 3, -20]), custom).kind, 'fallen');
  assert.equal(motionModel.machineBoundary(frame([1000, -100, 0]), null), null);
  assert.match(motionModel.machineBoundary(frame([101, 1, 0])).message, /Return to Build/);
});
test('boundary warning measures authored parts and excludes the terrain body', () => {
  const f = {
    metadata: { blueprint: { parts: [{}] } },
    physics: [
      { position: [0, 1, 0], mass: 1, velocity: [0, 0, 0] },
      { position: [1000, -50, 0], mass: 1000, velocity: [0, 0, 0] },
    ],
  };
  assert.equal(motionModel.machineBoundary(f), null);
  const wrong = structuredClone(f);
  wrong.metadata.blueprint.parts.push({});
  assert.equal(motionModel.machineBoundary(wrong).kind, 'fallen');
});
