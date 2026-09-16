import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSurfaceControls } from '../src/presentation/surface-controls.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { BUILD_ENVIRONMENT } from '../src/model/environment.mjs';
import { surfaceRegions } from '../src/model/surfaces.mjs';
import { CATALOG } from '../src/model/catalog.mjs';

/** Minimal DOM for the production controller; the scene, geometry and rays are real.
 * Appearance stays the browser verifier's job — these assert the numbers behind the drawing. */
class Element extends EventTarget {
  children = [];
  dataset = {};
  style = {};
  attributes = {};
  value = '';
  hidden = false;
  textContent = '';
  // infer() sizes its snap radius in screen pixels from the canvas height; without these the
  // pixel size is NaN, every comparison is false and no snap is ever held.
  clientWidth = 800;
  clientHeight = 600;
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
  }
  get lastElementChild() {
    return this.children.at(-1);
  }
  append(...items) {
    for (const item of items) {
      item.remove();
      item.parentElement = this;
      this.children.push(item);
      if (this.tagName === 'SELECT' && this.children.length === 1) this.value = item.value;
    }
  }
  replaceChildren(...items) {
    for (const item of [...this.children]) item.remove();
    this.append(...items);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
    this.parentElement = null;
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  }
}
const all = (root) => [root, ...root.children.flatMap(all)];
const GROUND_TOP = BUILD_ENVIRONMENT.ground.position[1] + BUILD_ENVIRONMENT.ground.halfExtents[1];

function fixture() {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const blueprint = {
    ...createEmptyBlueprint('feedback', 'Feedback'),
    parts: [
      createPart('chassis', 'base', [0, 0.35, 0]),
      createPart('poweredMotor', 'motor', [0.45, 0.35, 0]),
    ],
  };
  const frame = { metadata: { blueprint, mode: 'build' } };
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera();
  const host = new Element('div'),
    canvas = new Element('canvas');
  host.append(canvas);
  // Unlike the pending fixture these sit where their parts are AND match their extent. A
  // landing ray is only meaningful against a mesh that occupies the part's real surface: a
  // generic 0.1 box puts the mount point inside the mesh, where a front-facing ray starting
  // within a closed box finds nothing and the test would prove nothing either way.
  const mesh = (part) => {
    const half = part ? CATALOG[part.type].primitives[0].halfExtents : [0.05, 0.05, 0.05];
    return new THREE.Mesh(
      new THREE.BoxGeometry(half[0] * 2, half[1] * 2, half[2] * 2),
      new THREE.MeshBasicMaterial(),
    );
  };
  const meshes = new Map(
    blueprint.parts.map((part) => {
      const m = mesh(part);
      m.position.fromArray(part.position);
      m.userData.partId = part.id;
      m.updateMatrixWorld(true);
      scene.add(m);
      return [part.id, m];
    }),
  );
  const messages = [],
    orbit = { enabled: true };
  const controls = createSurfaceControls({
    scene,
    camera,
    renderer: { domElement: canvas },
    orbit,
    getFrame: () => frame,
    getMeshes: () => meshes,
    createMesh: mesh,
    send: () => Promise.resolve({ ok: true }),
    onMessage: (message) => messages.push(message),
    onInteraction: () => {},
  });
  assert.equal(controls.start('motor'), true);
  const target = all(controls.panel).find(
    (item) => item.attributes['aria-label'] === 'Target surface',
  );
  target.value = JSON.stringify(['base', 'top']);
  target.dispatchEvent(new Event('change'));
  assert.equal(controls.read().phase, 'preview', 'real geometry admits the preview');
  return {
    controls,
    scene,
    meshes,
    camera,
    canvas,
    retarget: () => target.dispatchEvent(new Event('change')),
    faceCentre() {
      const base = blueprint.parts.find((p) => p.id === 'base');
      const region = surfaceRegions(base).find((r) => r.id === 'top');
      return new THREE.Vector3(...region.position)
        .applyQuaternion(new THREE.Quaternion(...base.rotation))
        .add(new THREE.Vector3(...base.position));
    },
    cleanup() {
      controls.dispose();
      for (const value of meshes.values()) {
        value.geometry.dispose();
        value.material.dispose();
      }
      globalThis.document = previousDocument;
    },
  };
}

const find = (scene, predicate) => {
  let found = null;
  scene.traverse((object) => {
    if (!found && predicate(object)) found = object;
  });
  return found;
};
const dropLine = (scene) => find(scene, (o) => o.userData?.dropLine === true);
const ghostBox = (scene) => {
  const box = new THREE.Box3();
  let any = false;
  scene.traverse((o) => {
    if (o.isMesh && o.userData?.surfacePreview) {
      box.expandByObject(o);
      any = true;
    }
  });
  return any ? box : null;
};
const points = (line) => {
  const array = line.geometry.getAttribute('position');
  return Array.from({ length: array.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(array, i),
  );
};

test('the placement ghost drops a line from its lowest point to the floor', () => {
  const f = fixture();
  try {
    const line = dropLine(f.scene);
    assert.ok(line, 'a placement ghost draws a drop-line to the floor');
    const ghost = ghostBox(f.scene);
    assert.ok(ghost, 'the ghost meshes are in the preview group');
    const ends = points(line);
    assert.equal(ends.length >= 2, true, 'the drop-line has two ends');
    const top = ends[0],
      floor = ends.at(-1);
    assert.ok(
      Math.abs(floor.y - GROUND_TOP) < 1e-6,
      `the line lands on the floor top ${GROUND_TOP}, got ${floor.y}`,
    );
    // Line positions are stored as float32, so the comparison is to that precision.
    assert.ok(
      Math.abs(top.y - ghost.min.y) < 1e-6,
      `the line starts at the ghost's lowest point ${ghost.min.y}, got ${top.y}`,
    );
    const centre = ghost.getCenter(new THREE.Vector3());
    assert.ok(
      Math.abs(floor.x - centre.x) < 1e-6 && Math.abs(floor.z - centre.z) < 1e-6,
      'the landing point sits under the ghost centre',
    );
  } finally {
    f.cleanup();
  }
});

test('the ghost casts a shadow so contact is visible without orbiting', () => {
  const f = fixture();
  try {
    const ghosts = [];
    f.scene.traverse((o) => {
      if (o.isMesh && o.userData?.surfacePreview) ghosts.push(o);
    });
    assert.ok(ghosts.length, 'the preview contains ghost meshes');
    assert.ok(
      ghosts.every((o) => o.castShadow),
      'every ghost mesh casts the key-light shadow (it was suppressed before)',
    );
    // The flag alone is not the mechanism. three's depth material ignores `opacity`, so the
    // lighter shadow comes from a stipple on a dedicated shadow-pass material — and three
    // samples the GREEN channel of alphaMap, so a texture whose green is all zero (a
    // RedFormat one, say) casts no shadow whatever the flag says.
    for (const ghost of ghosts) {
      const depth = ghost.customDepthMaterial;
      assert.ok(depth, 'the ghost owns a shadow-pass material');
      assert.ok(depth.alphaTest > 0, 'that material discards part of the shadow');
      assert.ok(depth.alphaMap?.image?.data, 'it carries a stipple texture');
      const green = [];
      for (let i = 1; i < depth.alphaMap.image.data.length; i += 4)
        green.push(depth.alphaMap.image.data[i] / 255);
      assert.ok(
        green.some((value) => value > depth.alphaTest),
        'some texels pass alphaTest on the channel three samples, so a shadow is cast at all',
      );
      assert.ok(
        green.some((value) => value <= depth.alphaTest),
        'and some do not, so the shadow reads lighter than a placed part',
      );
    }
  } finally {
    f.cleanup();
  }
});

test('read() reports the held centre or edge inference', () => {
  const f = fixture();
  try {
    const before = f.controls.read();
    assert.ok(before.inference, 'read() exposes the held inference for the probe');
    assert.deepEqual(
      { u: before.inference.u, v: before.inference.v },
      { u: null, v: null },
      'nothing is held before the pointer moves',
    );
    // Aim off-axis at the target face's centre: straight down with up=+Y is a degenerate
    // lookAt and yields a NaN ray, which would make this pass or fail for the wrong reason.
    const face = f.faceCentre();
    f.camera.position.set(face.x + 0.4, face.y + 0.9, face.z + 0.4);
    f.camera.lookAt(face.x, face.y, face.z);
    f.camera.updateMatrixWorld(true);
    f.controls.point({ clientX: 400, clientY: 300, buttons: 0 });
    const held = f.controls.read();
    assert.equal(held.inference.u, 0, 'the centre snap is held and reported on u');
    assert.equal(held.inference.v, 0, 'the centre snap is held and reported on v');
  } finally {
    f.cleanup();
  }
});

test('the landing ray ignores the part being moved', () => {
  const f = fixture();
  try {
    // Put the moving part's own hidden mesh directly across the ray, just above the receiving
    // face. An unfiltered ray hits that first and reports a nonsense contact with itself; three
    // does not skip invisible meshes, so hiding the original is not protection.
    const motor = f.meshes.get('motor');
    motor.geometry.dispose();
    motor.geometry = new THREE.BoxGeometry(0.2, 0.004, 0.2);
    const face = f.faceCentre();
    motor.position.set(face.x, face.y + 0.005, face.z);
    motor.updateMatrixWorld(true);
    f.retarget();
    const landing = f.controls.read().landing;
    assert.ok(landing, 'read() exposes what the pad is aimed at and how far away it is');
    assert.equal(
      landing.part,
      'base',
      'the ray reports the receiving part, never the moving part whose meshes are merely hidden',
    );
    assert.equal(
      typeof landing.gap,
      'number',
      'the gap is a number of metres for the read-out chip',
    );
    assert.ok(landing.gap >= 0, 'a gap is never negative');
  } finally {
    f.cleanup();
  }
});
