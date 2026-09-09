import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSpringView } from '../src/presentation/spring-view.mjs';
test('coil retains wire radius, buffers and disposal across full travel', () => {
  const scene = new THREE.Scene(),
    view = createSpringView(scene),
    row = { id: 's', a: new THREE.Vector3(), b: new THREE.Vector3(0, 0.3, 0), selected: false };
  view.update([row]);
  const mesh = scene.children[0],
    geometry = mesh.geometry,
    buffer = geometry.attributes.position.array;
  let disposed = 0;
  geometry.addEventListener('dispose', () => disposed++);
  for (const length of [0.08, 0.2, 0.4, 0.1, 0.3]) {
    row.b.y = length;
    view.update([row]);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.geometry.attributes.position.array, buffer);
    const radius = Math.hypot(buffer[0], buffer[2]);
    assert.ok(Math.abs(radius - 0.0445) < 1e-7);
    assert.ok(geometry.boundingSphere.radius < 0.25);
  }
  row.a.set(1, 2, 3);
  row.b.set(1.3, 2, 3);
  view.update([row]);
  assert.deepEqual(mesh.position.toArray(), [1, 2, 3]);
  view.update([]);
  assert.equal(scene.children.length, 0);
  assert.equal(disposed, 1);
  view.dispose();
  assert.equal(disposed, 1);
});
