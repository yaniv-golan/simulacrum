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

import { createAssemblyConnections } from '../src/presentation/assembly-thumbnails.mjs';
import { machine } from './fixtures/linear-machine.mjs';
test('saved actuator thumbnails retain straight rods and guide endpoint order in either edge direction', () => {
  for (const reverse of [false, true]) {
    const definition = machine();
    if (reverse)
      [definition.connections[0].a, definition.connections[0].b] = [
        definition.connections[0].b,
        definition.connections[0].a,
      ];
    const before = structuredClone(definition),
      group = new THREE.Group();
    const view = createAssemblyConnections(group, definition);
    try {
      const mesh = group.children.find((o) => o.isMesh),
        positions = mesh.geometry.attributes.position;
      const radius = Math.hypot(positions.getX(0), positions.getZ(0));
      assert.ok(Math.abs(radius - 0.012) < 1e-6, 'actuator thumbnail is a rod, not a passive coil');
      const check = (row) => {
        assert.ok(
          new THREE.Vector3(...row.a).distanceTo(new THREE.Vector3(0, 1.01, 0)) < 1e-6,
          'thumbnail starts at guide',
        );
        assert.ok(
          new THREE.Vector3(...row.b).distanceTo(new THREE.Vector3(0, 1.21, 0)) < 1e-6,
          'thumbnail ends at carriage',
        );
      };
      const row = view.readRenderedSpringEndpoints()[0];
      check(row);
      assert.throws(() => check({ a: row.b, b: row.a }), /thumbnail starts at guide/);
      assert.deepEqual(definition, before);
    } finally {
      view.dispose();
    }
    assert.equal(group.children.length, 0);
  }
});
