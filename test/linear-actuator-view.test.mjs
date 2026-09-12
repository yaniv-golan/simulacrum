import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSpringView } from '../src/presentation/spring-view.mjs';
import { PART_HELP } from '../src/presentation/part-help-content.mjs';
test('linear rod is distinct from passive coil and follows completed endpoints with retained geometry', () => {
  assert.match(PART_HELP.linearActuator.explanation, /unpowered/);
  const scene = new THREE.Scene(),
    view = createSpringView(scene);
  const row = {
    id: 'drive',
    linear: true,
    a: new THREE.Vector3(1, 2, 3),
    b: new THREE.Vector3(1, 2.2, 3),
  };
  try {
    view.update([row]);
    const mesh = scene.children[0],
      geometry = mesh.geometry;
    const p = geometry.attributes.position;
    assert.ok(Math.hypot(p.getX(0), p.getZ(0)) < 0.02);
    for (const length of [0.08, 0.4, 0.2]) {
      row.b.set(1 + length, 2, 3);
      view.update([row]);
      assert.equal(mesh.geometry, geometry);
      const check = () => {
        const r = view.readRenderedEndpoints()[0];
        for (const end of ['a', 'b'])
          assert.ok(new THREE.Vector3(...r[end]).distanceTo(row[end]) < 1e-6);
      };
      check();
      mesh.position.x += 0.01;
      assert.throws(check);
      mesh.position.x -= 0.01;
    }
  } finally {
    view.dispose();
  }
  assert.equal(scene.children.length, 0);
});
