import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMechanicalDetails } from '../src/presentation/part-visuals/mechanical.mjs';
import { disposePart } from '../src/presentation/part-mesh.mjs';
import { CATALOG } from '../src/model/catalog.mjs';

const types = [
  'poweredMotor',
  'poweredHinge',
  'springGuide',
  'springCarriage',
  'gripWheel',
  'linearActuator',
];
const create = (type, scale = 1, parameters = {}) =>
  createMechanicalDetails({
    type,
    halfExtents: CATALOG[type].primitives[0].halfExtents.map((v) => v * scale),
    parameters,
  });

test('mechanical surface finishes stay inside authored envelopes and never intercept picking', () => {
  for (const type of types)
    for (const scale of [0.5, 1, 5]) {
      const group = create(type, scale);
      assert.ok(group instanceof THREE.Group);
      assert.ok(group.children.length > 0 && group.children.length <= 3);
      const extents = CATALOG[type].primitives[0].halfExtents.map((v) => v * scale);
      group.updateMatrixWorld(true);
      for (const mesh of group.children) {
        const bounds = new THREE.Box3().setFromObject(mesh);
        for (let i = 0; i < 3; i++) {
          assert.ok(bounds.max.getComponent(i) <= extents[i] + 0.0007);
          assert.ok(bounds.min.getComponent(i) >= -extents[i] - 0.0007);
        }
        const hits = [];
        mesh.raycast(new THREE.Raycaster(), hits);
        assert.deepEqual(hits, []);
      }
      disposePart(group);
    }
});

test('output construction and spring seats occupy the actual functional faces', () => {
  const motor = create('poweredMotor'),
    servo = create('poweredHinge');
  const axis = (mesh) =>
    new THREE.Vector3(0, 0, 1)
      .applyQuaternion(mesh.quaternion)
      .toArray()
      .map((v) => Math.round(v));
  assert.deepEqual(axis(motor.getObjectByName('output-cover')), [1, 0, 0]);
  assert.deepEqual(axis(servo.getObjectByName('output-cover')), [0, 1, 0]);
  const fixed = create('springGuide'),
    moving = create('springCarriage');
  assert.deepEqual(axis(fixed.children[0]), [0, 1, 0]);
  assert.deepEqual(axis(moving.children[0]), [0, -1, 0]);
  assert.notDeepEqual(
    fixed.children[0].material.map.image.data,
    moving.children[0].material.map.image.data,
  );
  for (const group of [motor, servo, fixed, moving]) disposePart(group);
});

test('wheel solid finish retains a unique rotation cue without a false central bore', () => {
  const group = create('gripWheel');
  assert.equal(group.children.length, 2);
  for (const mesh of group.children) {
    const pixels = mesh.material.map.image.data;
    const at = (x, y) => Array.from(pixels.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 4));
    assert.deepEqual(at(128, 128), [157, 171, 179, 255]);
    assert.deepEqual(at(128, 207), [221, 174, 96, 255]);
    assert.deepEqual(at(128, 48), [0, 0, 0, 0]);
  }
  disposePart(group);
});

test('mechanical decorations own disposable resources and invent no live state', () => {
  for (const type of types) {
    const first = create(type, 1, { defaultDuty: -1, defaultTarget: 0.7 });
    const second = create(type, 1, { defaultDuty: 1, defaultTarget: -0.7 });
    let disposals = 0;
    first.children.forEach((mesh, i) => {
      assert.deepEqual(mesh.material.map.image.data, second.children[i].material.map.image.data);
      for (const resource of [mesh.geometry, mesh.material, mesh.material.map])
        resource.addEventListener('dispose', () => disposals++);
    });
    disposePart(first);
    assert.equal(disposals, first.children.length * 3);
    disposePart(second);
  }
  for (const type of [
    'beam',
    'plate',
    'chassis',
    'spacerBlock',
    'mountingBlock',
    'ball',
    'wheelHub',
    'unknown',
  ])
    assert.equal(createMechanicalDetails({ type }), null);
});

test('powered slide paint clears the shared central interface and differs from passive spring seats', () => {
  const actuator = create('linearActuator');
  assert.ok(actuator);
  const face = actuator.getObjectByName('powered-slide-mark');
  assert.ok(face);
  assert.ok(Math.abs(face.position.y - 0.0104) < 1e-12);
  const pixels = face.material.map.image.data;
  let painted = 0;
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const alpha = pixels[(y * 256 + x) * 4 + 3];
      if (Math.hypot((x + 0.5) / 128 - 1, (y + 0.5) / 128 - 1) < 0.2) assert.equal(alpha, 0);
      if (alpha) painted++;
    }
  assert.ok(painted > 1000);
  const passive = create('springGuide');
  assert.notDeepEqual(pixels, passive.children[0].material.map.image.data);
  const matchesPassive = pixels.every(
    (value, i) => value === passive.children[0].material.map.image.data[i],
  );
  assert.throws(() => assert.equal(matchesPassive, true));
  disposePart(actuator);
  disposePart(passive);
});
