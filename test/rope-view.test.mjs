import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRopeView } from '../src/presentation/rope-view.mjs';
test('rope mesh vertices follow completed node endpoints and resources are retained and disposed', () => {
  const scene = new THREE.Scene(),
    view = createRopeView(scene),
    rows = [
      {
        id: 'r',
        diameter: 0.02,
        points: [
          [0, 1, 0],
          [0.5, 0.5, 0],
          [1, 1, 0],
        ],
        selected: false,
      },
    ];
  view.update(rows);
  const objects = [...scene.children];
  let ends = view.readRenderedEndpoints();
  assert.equal(ends.length, 2);
  assert.ok(Math.hypot(...ends[0].a.map((v, i) => v - rows[0].points[0][i])) < 1e-6);
  assert.ok(Math.hypot(...ends[1].b.map((v, i) => v - rows[0].points[2][i])) < 1e-6);
  rows[0].points[1] = [0.5, 0.2, 0.1];
  view.update(rows);
  assert.deepEqual(scene.children, objects);
  ends = view.readRenderedEndpoints();
  assert.ok(Math.hypot(...ends[0].b.map((v, i) => v - rows[0].points[1][i])) < 1e-6);
  view.dispose();
  assert.equal(scene.children.length, 0);
});
