import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInteractionRecorder } from '../src/application/interaction-recorder.mjs';
import { createCameraFrustum } from '../src/presentation/camera-frustum.mjs';
test('requested camera cone follows completed lens pose and leaves with selection or view', () => {
  const scene = new THREE.Scene(),
    cone = createCameraFrustum(scene);
  const frame = {
    tick: 12,
    metadata: { blueprint: { parts: [{ id: 'lens', type: 'camera' }] } },
    physics: [{ position: [1, 2, 3], rotation: [0, 1, 0, 0] }],
  };
  cone.update(frame, 'lens', 'lens', false);
  assert.equal(cone.read().visible, true);
  assert.deepEqual(cone.read().position, [1, 2, 2.979999]);
  assert.deepEqual(cone.read().forward, [0, 0, -1]);
  const positions = cone.read().points;
  assert.ok(positions.some((p) => Math.abs(p[2] - 1.979999) < 1e-5));
  cone.update(frame, 'other', 'lens', false);
  assert.equal(cone.read().visible, false);
  cone.update(frame, 'lens', 'lens', true);
  assert.equal(cone.read().visible, false);
  cone.dispose();
  assert.equal(scene.children.length, 0);
});

test('unshown camera cone diagnostics remain recordable JSON', () => {
  const cone = createCameraFrustum(new THREE.Scene());
  const recorder = createInteractionRecorder({ build: 'camera-test', storage: { setItem() {} } });
  try {
    assert.equal(
      recorder.start({ ui: { cameraFrustum: cone.read() } }),
      true,
      recorder.state().error,
    );
    assert.equal(recorder.snapshot().initialContext.ui.cameraFrustum.position, null);
    assert.equal(recorder.snapshot().initialContext.ui.cameraFrustum.forward, null);
    recorder.stop();
    assert.equal(
      recorder.start({ ui: { cameraFrustum: { ...cone.read(), position: undefined } } }),
      false,
    );
    assert.equal(recorder.state().reason, 'invalid-data');
  } finally {
    cone.dispose();
  }
});
