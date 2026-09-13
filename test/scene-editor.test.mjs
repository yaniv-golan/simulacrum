import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSceneEditor } from '../src/presentation/scene-editor.mjs';
import { createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { sceneLayout } from '../src/model/environment.mjs';
// Minimal DOM; the production editor, geometry and Three transform controls are real.
class Element extends EventTarget {
  children = [];
  style = {};
  attributes = {};
  value = '';
  hidden = false;
  classList = { add() {}, remove() {} };
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
  }
  get firstElementChild() {
    return this.children[0];
  }
  get nextElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1];
  }
  append(...items) {
    for (const item of items) {
      item.remove();
      item.parentElement = this;
      this.children.push(item);
    }
  }
  replaceChildren(...items) {
    for (const item of [...this.children]) item.remove();
    this.append(...items);
  }
  remove() {
    if (this.parentElement)
      this.parentElement.children = this.parentElement.children.filter((n) => n !== this);
    this.parentElement = null;
  }
  setAttribute(k, v) {
    this.attributes[k] = v;
  }
}
const all = (root) => [root, ...root.children.flatMap(all)];
function fixture(t) {
  const old = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const left = new Element('div'),
    right = new Element('div'),
    canvas = new Element('canvas');
  const scene = new THREE.Scene(),
    committed = new THREE.Group();
  scene.add(committed);
  const frame = {
    metadata: {
      blueprint: {
        ...createEmptyBlueprint('scene-test', 'Test'),
        environment: sceneLayout('hill'),
      },
      mode: 'build',
    },
    cursor: { session: 'a', revision: 0, epoch: 0, tick: 0 },
  };
  const editor = createSceneEditor({
    getFrame: () => frame,
    send: async () => ({ ok: false }),
    left,
    rightPanel: right,
    scene,
    camera: new THREE.PerspectiveCamera(),
    canvas,
    orbit: { enabled: true },
    meshes: () => committed,
    library: { list: () => [] },
    exportScene() {},
    onContext() {},
    onBusy() {},
    invalidate() {},
  });
  const controls = scene.children.find((n) => n.isTransformControlsRoot).controls;
  const click = (name) => {
    const button = [...all(left), ...all(right)].find(
      (n) => n.textContent === name && n.tagName === 'BUTTON',
    );
    assert.ok(button, name);
    return button.onclick();
  };
  t.after(() => {
    editor.dispose();
    globalThis.document = old;
  });
  editor.enter();
  click('Straight ramp');
  return { editor, controls, committed, click, frame, canvas };
}
test('scene Move uses translation and manipulates only an unapplied proposal', (t) => {
  const f = fixture(t),
    original = structuredClone(f.frame.metadata.blueprint);
  f.editor.setTool('translate');
  assert.equal(f.controls.getMode(), 'translate');
  f.controls.dragging = true;
  f.controls.object.position.x = 3;
  f.controls.dispatchEvent({ type: 'objectChange' });
  f.controls.dragging = false;
  assert.deepEqual(f.frame.metadata.blueprint, original);
  f.click('Cancel preview');
  assert.equal(f.controls.object, undefined);
});
test('scene tool shortcuts switch tools and leave text editing native', (t) => {
  const f = fixture(t);
  const key = (value, target = f.canvas) =>
    f.editor.key({ key: value, target, preventDefault() {} });
  key('w');
  assert.equal(f.controls.getMode(), 'translate');
  key('e');
  assert.equal(f.controls.getMode(), 'rotate');
  key('w', new Element('input'));
  assert.equal(f.controls.getMode(), 'rotate');
  key('v');
  assert.equal(f.controls.object, undefined);
});
test('scene preview hides replaced committed geometry and cancellation restores it', (t) => {
  const f = fixture(t);
  assert.equal(f.committed.visible, false);
  f.click('Delete object');
  assert.equal(f.committed.visible, false, 'deleted objects stay absent in preview');
  f.click('Cancel preview');
  assert.equal(f.committed.visible, true);
  f.click('Straight ramp');
  f.editor.dispose();
  assert.equal(f.committed.visible, true, 'disposal restores committed visibility');
});

import { createPrimitiveGeometry } from '../src/presentation/primitive-geometry.mjs';
import { sceneMesh } from '../src/presentation/scene-editor.mjs';
import { sceneObjectDescriptors } from '../src/model/environment.mjs';
test('recording and workshop reconstruct identical canonical cylinder surfaces', () => {
  const descriptor = sceneObjectDescriptors('rounded-bump')[0];
  const workshop = sceneMesh(descriptor),
    review = createPrimitiveGeometry({
      kind: descriptor.shape,
      halfExtents: descriptor.halfExtents,
    });
  try {
    assert.deepEqual(
      [...review.attributes.position.array],
      [...workshop.geometry.attributes.position.array],
    );
    assert.deepEqual(
      [...review.attributes.normal.array],
      [...workshop.geometry.attributes.normal.array],
    );
    const wrong = new THREE.CylinderGeometry(0.03, 0.03, 2, 24).rotateZ(-Math.PI / 2);
    assert.notDeepEqual(
      [...wrong.attributes.position.array],
      [...workshop.geometry.attributes.position.array],
    );
    wrong.dispose();
  } finally {
    review.dispose();
    workshop.geometry.dispose();
    workshop.material.dispose();
  }
});
