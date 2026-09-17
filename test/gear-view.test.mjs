import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createConnectionView } from '../src/presentation/connection-view.mjs';
import { portLabel, portPurpose } from '../src/presentation/port-wording.mjs';

test('gear mesh draws a dashed relationship, never a supporting shaft', () => {
  const parent = new THREE.Group(),
    view = createConnectionView(parent);
  view.update([
    {
      id: 'mesh',
      kind: 'gear',
      ends: [new THREE.Vector3(), new THREE.Vector3(0, 0, 0.18)],
      visible: true,
      highlighted: true,
      exploded: false,
      failed: false,
    },
  ]);
  const objects = [];
  parent.traverse((object) => objects.push(object));
  assert.equal(
    objects.filter((object) => object.isMesh).length,
    0,
    'a mesh relationship must not depict a solid shaft between gear centres',
  );
  assert.ok(objects.some((object) => object.isLine && object.material.isLineDashedMaterial));
  view.dispose();
  assert.equal(parent.children.length, 0);
});

test('mesh wording distinguishes transmission from structural support', () => {
  const port = { id: 'mesh', kind: 'gear' };
  assert.equal(portLabel({ type: 'spurGear' }, port), 'Gear mesh');
  assert.match(portPurpose({ type: 'spurGear' }, port), /separate.*shaft|independently/i);
  assert.match(portPurpose({ type: 'spurGear' }, port), /stay|move/i);
});
