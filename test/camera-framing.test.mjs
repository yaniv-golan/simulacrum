import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frameBounds } from '../src/presentation/editing-controls.mjs';

const bounds = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(1, 1, 0.5));
function fixture(position, aspect = 1) {
  const camera = new THREE.PerspectiveCamera(42, aspect, 0.01, 100);
  camera.position.fromArray(position);
  const orbit = {
    target: new THREE.Vector3(),
    update() {
      camera.lookAt(this.target);
      camera.updateMatrixWorld();
    },
  };
  return { camera, orbit };
}
test('Frame recovers an above-floor view after underside orbit', () => {
  const { camera, orbit } = fixture([1, -2, 1]);
  frameBounds(camera, orbit, bounds);
  assert.ok(camera.position.y > bounds.max.y);
});
test('Frame fits every corner inside the unobscured portrait viewport', () => {
  const { camera, orbit } = fixture([1, 1, 1], 0.6);
  const width = 600,
    height = 1000;
  frameBounds(camera, orbit, bounds, { width, height, top: 210, bottom: 250, left: 30, right: 30 });
  for (const x of [-1, 1])
    for (const y of [0, 1])
      for (const z of [-0.5, 0.5]) {
        const p = new THREE.Vector3(x, y, z).project(camera),
          px = ((p.x + 1) * width) / 2,
          py = ((1 - p.y) * height) / 2;
        assert.ok(px >= 30 && px <= 570 && py >= 210 && py <= 750, `corner clips: ${px},${py}`);
      }
});
test('Frame preserves a healthy viewing heading', () => {
  const { camera, orbit } = fixture([2, 1, 3]);
  const before = camera.position.clone().normalize();
  frameBounds(camera, orbit, bounds);
  assert.ok(camera.position.clone().sub(orbit.target).normalize().distanceTo(before) < 1e-8);
});
test('automatic inspection framing preserves an underside heading', () => {
  const { camera, orbit } = fixture([2, -1, 3]);
  const before = camera.position.clone().normalize();
  frameBounds(camera, orbit, bounds, { recover: false });
  assert.ok(camera.position.clone().sub(orbit.target).normalize().distanceTo(before) < 1e-8);
});
