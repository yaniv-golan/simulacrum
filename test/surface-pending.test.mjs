import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSurfaceControls } from '../src/presentation/surface-controls.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';

// Minimal DOM for this direct production-controller test; geometry and lifecycle
// are real. Rendering appearance remains the browser verifier's responsibility.
class Element extends EventTarget {
  children = [];
  dataset = {};
  style = {};
  attributes = {};
  value = '';
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
function fixture() {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const blueprint = {
    ...createEmptyBlueprint('pending', 'Pending'),
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
  const mesh = () =>
    new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial());
  const meshes = new Map(blueprint.parts.map((part) => [part.id, mesh()]));
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const commands = [],
    messages = [],
    interactions = [],
    orbit = { enabled: true };
  const controls = createSurfaceControls({
    scene,
    camera,
    renderer: { domElement: canvas },
    orbit,
    getFrame: () => frame,
    getMeshes: () => meshes,
    createMesh: mesh,
    send: (command) => {
      commands.push(command);
      return pending;
    },
    onMessage: (message) => messages.push(message),
    onInteraction: (...args) => interactions.push(args),
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
    resolve,
    commands,
    messages,
    interactions,
    scene,
    meshes,
    orbit,
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
test('pending surface command refuses cancellation and replacement until its real completion', async () => {
  const f = fixture();
  try {
    const result = f.controls.commit();
    assert.equal(f.commands.length, 1);
    f.controls.cancel();
    assert.equal(f.controls.read().phase, 'committing');
    assert.match(f.messages.at(-1), /being applied/);
    assert.equal(f.controls.start('base'), false, 'start cannot replace a dispatched edit');
    assert.equal(f.controls.read().part, 'motor');
    assert.equal(await f.controls.commit(), false, 'no second dispatch');
    f.resolve({ ok: true });
    assert.equal(await result, true);
    assert.equal(f.controls.active(), false);
    assert.equal(f.commands.length, 1);
    assert.equal(f.interactions.filter(([kind]) => kind === 'surface-committed').length, 1);
  } finally {
    f.resolve({ ok: true });
    f.cleanup();
  }
});
test('disposing a pending surface command releases previews and ignores its late completion', async () => {
  const f = fixture();
  try {
    const result = f.controls.commit();
    assert.equal(f.meshes.get('motor').visible, false);
    f.controls.dispose();
    assert.equal(f.controls.active(), false, 'disposal releases retained placement state');
    assert.equal(f.scene.children.length, 0);
    assert.ok([...f.meshes.values()].every((mesh) => mesh.visible));
    assert.equal(f.orbit.enabled, true);
    const messageCount = f.messages.length;
    f.resolve({ ok: true });
    assert.equal(await result, false);
    assert.equal(f.messages.length, messageCount, 'late completion cannot notify a disposed view');
    assert.equal(f.controls.start('base'), false, 'disposed controller cannot restart');
  } finally {
    f.resolve({ ok: true });
    f.cleanup();
  }
});
