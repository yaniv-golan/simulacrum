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
    Array.from(cable.geometry.attributes.position.array),
    spec.ends.flatMap((p) => p.toArray()),
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

import {
  materialFinish,
  createPortHardware,
  portCueRadius,
} from '../src/presentation/part-finish.mjs';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
test('selectable finishes separate satin aluminium, steel and nonmetal rubber without material mutation', () => {
  const before = JSON.stringify(MATERIALS);
  const finishes = Object.fromEntries(
    Object.keys(MATERIALS).map((key) => [key, materialFinish(key)]),
  );
  assert.ok(finishes.steel.roughness < finishes.aluminium.roughness);
  assert.ok(finishes.steel.metalness > finishes.aluminium.metalness);
  assert.equal(finishes.rubber.metalness, 0);
  assert.ok(finishes.rubber.roughness > finishes.aluminium.roughness);
  assert.equal(JSON.stringify(MATERIALS), before);
});
test('every electrical socket stays on its authored endpoint and fits its nearest connector clearance', () => {
  for (const definition of Object.values(CATALOG)) {
    const ports = definition.ports.filter((p) => ['power', 'signal'].includes(p.kind));
    const before = JSON.stringify(ports);
    for (const port of ports) {
      const hardware = createPortHardware(port, ports, definition.primitives[0].halfExtents);
      assert.deepEqual(hardware.position.toArray(), port.position);
      assert.ok(hardware.children.some((child) => child.geometry?.type === 'RingGeometry'));
      hardware.updateMatrixWorld(true);
      const hit = hardware.children.find((child) => child.material?.visible === false);
      assert.ok(hit, 'retain the previous invisible picking sphere');
      assert.ok(
        Math.abs(hit.getWorldQuaternion(new THREE.Quaternion()).w) > 1 - 1e-12,
        'socket orientation must not rotate the original tessellated picking sphere',
      );
      const bounds = new THREE.Box3();
      hardware.traverse((o) => {
        if (o.isMesh && o.material.visible) bounds.union(new THREE.Box3().setFromObject(o));
      });
      const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      for (const other of ports.filter((p) => p !== port)) {
        const distance = new THREE.Vector3(...port.position).distanceTo(
          new THREE.Vector3(...other.position),
        );
        assert.ok(2 * radius < distance, `${definition.type}/${port.id}: overlapping hardware`);
      }
      hardware.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
    }
    assert.equal(JSON.stringify(ports), before);
  }
});

test('dense authoring highlights remain separate without enlarging sparse markers', () => {
  for (const definition of Object.values(CATALOG)) {
    const ports = definition.ports.filter((p) => ['power', 'signal'].includes(p.kind));
    for (const port of ports) {
      const radius = portCueRadius(port, ports);
      assert.ok(radius > 0 && radius <= 0.012);
      for (const other of ports.filter((p) => p !== port)) {
        const distance = new THREE.Vector3(...port.position).distanceTo(
          new THREE.Vector3(...other.position),
        );
        assert.ok(
          radius + portCueRadius(other, ports) < distance,
          `${definition.type}/${port.id}: overlapping authoring cues`,
        );
      }
    }
  }
  assert.equal(portCueRadius({ position: [0, 0, 0] }, []), 0.012);
});

test('assembly previews include authored wires and spring coils and release their resources', async () => {
  const { createAssemblyConnections } = await import('../src/presentation/assembly-thumbnails.mjs');
  const group = new THREE.Group();
  const parts = [
    { id: 'cell', type: 'powerCell', position: [1, 2, 3], rotation: [0, 0, 0, 1] },
    { id: 'motor', type: 'poweredMotor', position: [-1, 2, 3], rotation: [0, 0, 0, 1] },
    { id: 'guide', type: 'springGuide', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    { id: 'rod', type: 'springCarriage', position: [0.3, 0, 0], rotation: [0, 0, 0, 1] },
  ];
  const endpoint = (part, kind) => ({
    part: part.id,
    port: CATALOG[part.type].ports.find((p) => p.kind === kind).id,
  });
  const definition = {
    parts,
    connections: [
      { id: 'wire', kind: 'power', a: endpoint(parts[0], 'power'), b: endpoint(parts[1], 'power') },
      {
        id: 'coil',
        kind: 'spring',
        a: endpoint(parts[2], 'spring'),
        b: endpoint(parts[3], 'spring'),
      },
    ],
  };
  const before = structuredClone(definition);
  const view = createAssemblyConnections(group, definition);
  const lines = [];
  group.traverse((o) => {
    if (o.isLine && !o.isLineSegments) lines.push(o);
  });
  assert.equal(lines.length, 1);
  const expected = CATALOG.powerCell.ports
    .find((p) => p.kind === 'power')
    .position.map((v, i) => v + parts[0].position[i]);
  assert.ok(
    new THREE.Vector3()
      .fromBufferAttribute(lines[0].geometry.attributes.position, 0)
      .distanceTo(new THREE.Vector3(...expected)) < 1e-6,
  );
  assert.equal(view.readRenderedSpringEndpoints().length, 1);
  assert.deepEqual(definition, before);
  let released = 0;
  group.traverse((o) => o.geometry?.addEventListener('dispose', () => released++));
  view.dispose();
  assert.ok(released > 0);
  assert.equal(group.children.length, 0);
});
