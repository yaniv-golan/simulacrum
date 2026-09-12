import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CATALOG } from '../src/model/catalog.mjs';
import { createElectronicsDetails } from '../src/presentation/part-visuals/electronics.mjs';

const types = [
  'logicController',
  'learningController',
  'commandReceiver',
  'positionRegulator',
  'distributionBus',
  'powerCell',
];
function canvasDocument() {
  return {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const calls = [];
      const context = new Proxy(
        {},
        {
          get(target, key) {
            return key in target ? target[key] : (...args) => calls.push([key, ...args]);
          },
        },
      );
      return { calls, getContext: () => context };
    },
  };
}
const input = (type) => ({
  type,
  halfExtents: CATALOG[type].primitives[0].halfExtents,
  ports: CATALOG[type].ports,
});

test('electronics paint stays at authored faces, keeps sockets untouched and never intercepts picking', () => {
  const previous = globalThis.document;
  globalThis.document = canvasDocument();
  try {
    for (const type of types) {
      const authored = input(type),
        before = JSON.stringify(authored),
        group = createElectronicsDetails(authored);
      assert.ok(group instanceof THREE.Group, type);
      assert.equal(group.children.length, 3, `${type} bounded three-surface construction`);
      const box = new THREE.Box3().setFromObject(group);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(box.max.getComponent(axis) <= authored.halfExtents[axis] + 0.0007);
        assert.ok(box.min.getComponent(axis) >= -authored.halfExtents[axis] - 0.0007);
      }
      for (const face of group.children) {
        const hits = [];
        face.raycast(new THREE.Raycaster(), hits);
        assert.deepEqual(hits, []);
        assert.ok(face.material.map instanceof THREE.CanvasTexture);
        assert.equal(face.userData.finishOnly, true);
      }
      assert.equal(JSON.stringify(authored), before);
    }
    assert.equal(createElectronicsDetails({ type: 'beam' }), null);
  } finally {
    globalThis.document = previous;
  }
});

test('bank paint follows real endpoint directions and positions including altered authored ports', () => {
  const previous = globalThis.document;
  globalThis.document = canvasDocument();
  try {
    for (const type of types) {
      const authored = input(type),
        group = createElectronicsDetails(authored);
      const painted = group.children.flatMap((face) => face.userData.portMarks);
      assert.equal(painted.length, authored.ports.length, type);
      assert.deepEqual(painted.map((p) => p.id).sort(), authored.ports.map((p) => p.id).sort());
      for (const mark of painted)
        assert.deepEqual(mark.position, authored.ports.find((p) => p.id === mark.id).position);
    }
    const altered = {
      ...input('logicController'),
      ports: [{ id: 'custom', kind: 'signal', direction: 'input', position: [0.013, 0, -0.03] }],
    };
    const marks = createElectronicsDetails(altered).children.flatMap((f) => f.userData.portMarks);
    assert.deepEqual(marks, [{ id: 'custom', position: [0.013, 0, -0.03] }]);
    const texts = types.map((type) =>
      createElectronicsDetails(input(type))
        .children[0].material.map.image.calls.filter((c) => c[0] === 'fillText')
        .map((c) => c[1])
        .join('|'),
    );
    assert.equal(new Set(texts).size, types.length, 'distinct module identities');
    assert.equal(
      createElectronicsDetails(input('distributionBus')).children.flatMap(
        (f) => f.userData.portMarks,
      ).length,
      1,
    );
  } finally {
    globalThis.document = previous;
  }
});

test('each surface owns separately disposable texture material and geometry', () => {
  const previous = globalThis.document;
  globalThis.document = canvasDocument();
  try {
    const group = createElectronicsDetails(input('logicController'));
    const resources = group.children.flatMap((f) => [f.geometry, f.material, f.material.map]);
    assert.equal(new Set(resources).size, 9);
    let released = 0;
    resources.forEach((resource) => resource.addEventListener('dispose', () => released++));
    group.traverse((object) => {
      object.geometry?.dispose();
      object.material?.map?.dispose();
      object.material?.dispose();
    });
    assert.equal(released, 9);
  } finally {
    globalThis.document = previous;
  }
});
