import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceCache, partAppearanceKey } from '../src/presentation/resource-cache.mjs';

test('resource ownership retains harmless edits and disposes changed or removed appearances exactly once', () => {
  const created = [],
    disposed = [];
  const cache = createResourceCache({
    create: (item) => {
      const resource = { id: item.id };
      created.push(resource);
      return resource;
    },
    dispose: (resource) => disposed.push(resource),
    key: partAppearanceKey,
  });
  const motor = {
    id: 'motor',
    type: 'poweredMotor',
    name: 'Motor',
    authoredMaterial: { housing: 'steel' },
    parameters: { defaultDuty: 1 },
    position: [0, 0, 0],
  };
  cache.reconcile([motor]);
  const original = cache.values.get('motor');
  cache.reconcile([
    { ...motor, name: 'Renamed', parameters: { defaultDuty: 0 }, position: [1, 0, 0] },
  ]);
  assert.equal(cache.values.get('motor'), original);
  assert.equal(created.length, 1);
  assert.equal(disposed.length, 0);
  cache.reconcile([{ ...motor, authoredMaterial: { housing: 'aluminium' } }]);
  assert.notEqual(cache.values.get('motor'), original);
  assert.deepEqual(disposed, [original]);
  cache.reconcile([]);
  assert.equal(disposed.length, 2);
  cache.dispose();
  assert.equal(disposed.length, 2);
});

import * as THREE from 'three';
import { createConnectionView } from '../src/presentation/connection-view.mjs';
test('unchanged and moved connection endpoints retain GPU resources and match schematic line endpoints', () => {
  const parent = new THREE.Group(),
    view = createConnectionView(parent),
    spec = {
      id: 'wire',
      visible: true,
      kind: 'power',
      exploded: false,
      highlighted: false,
      failed: false,
      ends: [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)],
    };
  view.update([spec]);
  const resource = view.resources.get('wire'),
    cable = resource.group.children[0],
    geometry = cable.geometry,
    position = geometry.attributes.position,
    material = cable.material;
  let disposals = 0;
  geometry.addEventListener('dispose', () => disposals++);
  const version = position.version;
  for (let i = 0; i < 120; i++) view.update([spec]);
  assert.equal(position.version, version);
  assert.equal(disposals, 0);
  spec.ends[1].set(2, 0.5, -0.25);
  view.update([spec]);
  assert.equal(view.resources.get('wire'), resource);
  assert.equal(cable.geometry, geometry);
  assert.equal(geometry.attributes.position, position);
  assert.equal(cable.material, material);
  assert.equal(disposals, 0);
  assert.ok(position.version > version);
  assert.ok(cable instanceof THREE.Line);
  assert.deepEqual(
    [...position.array],
    spec.ends.flatMap((p) => p.toArray()),
  );
  for (let i = 0; i < 30; i++) view.update([{ ...spec, visible: i % 2 === 0 }]);
  assert.equal(cable.geometry, geometry);
  assert.equal(cable.material, material);
  assert.equal(disposals, 0);
  assert.deepEqual(
    resource.group.children.slice(1).map((m) => m.position.toArray()),
    spec.ends.map((p) => p.toArray()),
  );
  view.update([{ ...spec, exploded: true }]);
  assert.equal(disposals, 1);
  assert.notEqual(view.resources.get('wire'), resource);
  assert.equal(parent.children.length, 1);
  view.dispose();
  assert.equal(parent.children.length, 0);
});

test('reordering authored items preserves output order without replacing resources', () => {
  const cache = createResourceCache({
    key: partAppearanceKey,
    create: (part) => ({ id: part.id }),
    dispose: () => assert.fail('reorder cannot dispose'),
  });
  const a = { id: 'a', type: 'powerCell' },
    b = { id: 'b', type: 'poweredMotor' };
  cache.reconcile([a, b]);
  const original = [...cache.values.values()];
  cache.reconcile([b, a]);
  assert.deepEqual([...cache.values.values()], [original[1], original[0]]);
});
