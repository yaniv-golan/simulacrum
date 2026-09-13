import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraState } from '../src/simulation/camera-state.mjs';

test('camera samples the scheduled completed tick, deduplicates requests and checkpoints its latch', () => {
  const camera = createCameraState([2]);
  assert.equal(camera.request(2, 1), 'accepted');
  assert.equal(camera.request(2, 1), 'duplicate');
  assert.equal(camera.request(2, 2), 'busy');
  for (let tick = 1; tick < 12; tick++)
    camera.step(tick, [{ node: 2, powered: true, level: 0, owner: 'manual' }]);
  assert.equal(camera.read()[0].result, null);
  camera.step(12, [{ node: 2, powered: true, level: 0, owner: 'manual' }]);
  assert.deepEqual(camera.read()[0].result, { id: 1, tick: 12, status: 'ok', source: 'manual' });
  const restored = createCameraState([2]);
  restored.restore(camera.read(), 12);
  assert.equal(restored.request(2, 1), 'duplicate');
  camera.step(13, [{ node: 2, powered: true, level: 1, owner: 'manual' }]);
  for (let tick = 14; tick <= 36; tick++)
    camera.step(tick, [{ node: 2, powered: true, level: 1, owner: 'manual' }]);
  assert.equal(camera.read()[0].result.tick, 24);
  assert.equal(camera.read()[0].serial, 2);
  assert.throws(() => restored.restore([{ ...camera.read()[0], sampleTick: 100 }], 36));
});

test('camera faults never produce live images and ownership changes require a low rearm', () => {
  const c = createCameraState([0]);
  c.step(1, [{ node: 0, powered: true, level: 1, owner: 'automatic' }]);
  c.step(12, [{ node: 0, powered: true, level: 1, owner: 'automatic' }]);
  assert.equal(c.read()[0].result, null);
  c.step(13, [{ node: 0, powered: true, level: 0, owner: 'automatic' }]);
  c.step(14, [{ node: 0, powered: true, level: 1, owner: 'automatic' }]);
  c.step(24, [{ node: 0, powered: false, level: 1, owner: 'automatic' }]);
  assert.equal(c.read()[0].result.status, 'no-power');
  c.step(36, [{ node: 0, powered: true, level: 1, owner: 'automatic' }]);
  assert.equal(c.read()[0].serial, 1);
  assert.equal(c.request(99, 1), 'unavailable');
});

test('controller edges during a reserved exposure report busy without replacing the manual request', () => {
  const c = createCameraState([0]);
  c.step(1, [{ node: 0, powered: true, level: 0, owner: 'a' }]);
  c.request(0, 1);
  c.step(2, [{ node: 0, powered: true, level: 1, owner: 'a' }]);
  assert.equal(c.read()[0].busySerial, 1);
  c.step(12, [{ node: 0, powered: true, level: 1, owner: 'a' }]);
  assert.equal(c.read()[0].result.source, 'manual');
  assert.equal(c.read()[0].serial, 1);
  const next = createCameraState([0]);
  next.restore(c.read(), 12);
  assert.equal(next.read()[0].busySerial, 1);
});

test('checkpoint rejects completed or superseded manual requests as pending without changing live state', () => {
  const c = createCameraState([0]);
  c.request(0, 1);
  c.step(12, [{ node: 0, powered: true, level: 0, owner: 'manual' }]);
  const completed = c.read();
  assert.throws(
    () => c.restore([{ ...completed[0], pending: { id: 1, source: 'manual' } }], 12),
    /INVALID_CAMERA_CHECKPOINT/,
  );
  assert.deepEqual(c.read(), completed);
  c.request(0, 3);
  const pending = c.read();
  assert.throws(
    () => c.restore([{ ...pending[0], pending: { id: 2, source: 'manual' } }], 12),
    /INVALID_CAMERA_CHECKPOINT/,
  );
  assert.deepEqual(c.read(), pending);
  const continued = createCameraState([0]);
  continued.restore(pending, 12);
  continued.step(24, [{ node: 0, powered: true, level: 0, owner: 'manual' }]);
  assert.equal(continued.read()[0].result.id, 3);
  assert.equal(continued.read()[0].serial, 2);
  continued.step(36, [{ node: 0, powered: true, level: 0, owner: 'manual' }]);
  assert.equal(continued.read()[0].serial, 2);
});
