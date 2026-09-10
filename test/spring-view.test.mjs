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

test('rendered coil endpoint readback follows actual buffers and world transforms', () => {
  const scene = new THREE.Scene(),
    view = createSpringView(scene);
  const row = { id: 'moving', a: new THREE.Vector3(1, 2, 3), b: new THREE.Vector3(1.2, 2.2, 3.1) };
  const agrees = () => {
    const actual = view.readRenderedEndpoints()[0];
    assert.equal(actual.id, row.id);
    assert.equal(actual.visible, true);
    for (const end of ['a', 'b'])
      assert.ok(
        new THREE.Vector3(...actual[end]).distanceTo(row[end]) < 1e-6,
        'rendered coil endpoint mismatch',
      );
  };
  try {
    view.update([row]);
    agrees();
    row.a.set(-0.2, 0.3, 0.1);
    row.b.set(-0.1, 0.5, 0.35);
    view.update([row]);
    agrees();
    const mesh = scene.children[0];
    mesh.position.x += 0.01;
    assert.throws(agrees, /endpoint mismatch/);
    mesh.position.x -= 0.01;
    // Stale final ring must be observable; cached requested length is insufficient.
    const p = mesh.geometry.attributes.position;
    for (let i = p.count - 7; i < p.count; i++) p.setY(i, p.getY(i) + 0.01);
    assert.throws(agrees, /endpoint mismatch/);
  } finally {
    view.dispose();
  }
  assert.deepEqual(view.readRenderedEndpoints(), []);
});

test('rendered coil follows nearly downward endpoints without snapping its axis', () => {
  const view = createSpringView(new THREE.Scene());
  const origin = [-0.34998239666965136, 0.4497962598676848, -0.00005099597230979556];
  // Retained completed articulated pose: only 90 microradians away from downward.
  const measured = [-0.34998445169868125, 0.14982064253336488, -0.00007789652914402749];
  const directions = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [1e-4, -1, 0],
    [0, -1, -1e-4],
    [-1e-8, -1, 1e-8],
    [1e-8, 1, -1e-8],
  ];
  const ends = directions.map((d) =>
    new THREE.Vector3(...origin).add(new THREE.Vector3(...d).normalize().multiplyScalar(0.3)),
  );
  ends.splice(6, 0, new THREE.Vector3(...measured));
  try {
    for (const b of ends) {
      const row = { id: 's', a: new THREE.Vector3(...origin), b };
      view.update([row]);
      const actual = view.readRenderedEndpoints()[0];
      for (const end of ['a', 'b'])
        assert.ok(
          new THREE.Vector3(...actual[end]).distanceTo(row[end]) < 1e-6,
          `rendered ${end} must follow endpoint ${b.toArray()}`,
        );
    }
  } finally {
    view.dispose();
  }
});
