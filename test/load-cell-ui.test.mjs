import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sensorInspector, updateSensorInspector } from '../src/presentation/sensor-controls.mjs';
import { createSensorView } from '../src/presentation/sensor-view.mjs';
import { portLabel } from '../src/presentation/port-wording.mjs';
import { PART_HELP } from '../src/presentation/part-help-content.mjs';
class Element {
  children = [];
  dataset = {};
  textContent = '';
  style = {};
  append(...items) {
    this.children.push(...items);
  }
  setAttribute() {}
  querySelector(selector) {
    const find = (e) =>
      e.className === selector.slice(1) ? e : e.children.map(find).find(Boolean);
    return find(this);
  }
}
const part = {
  type: 'loadCellSensor',
  id: 'cell',
  parameters: {},
  position: [99, 99, 99],
  rotation: [0, 0, 0, 1],
};
const frame = (status) => ({
  metadata: { blueprint: { parts: [part], connections: [] } },
  sensors: {
    bodies: [{ position: [1, 2, 3], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
    readings: [
      {
        node: 0,
        channels: {
          axialForce: { status, ...(status === 'ok' ? { value: -12 } : {}) },
          load: { status, ...(status === 'ok' ? { value: 13 } : {}) },
        },
      },
    ],
  },
});
test('load cell inspector names signed force, keeps invalid values absent and explains deliberate rearm', () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  try {
    const right = new Element();
    sensorInspector({
      part,
      blueprint: frame('ok').metadata.blueprint,
      right,
      editable: true,
      send() {
        throw Error('readout must not write');
      },
    });
    const text = (e) => [e.textContent, ...e.children.map(text)].join(' ');
    updateSensorInspector(frame('initializing'), right);
    assert.match(text(right), /first completed/);
    assert.doesNotMatch(text(right), /second compatible/);
    assert.match(text(right), /A.*support/);
    assert.match(text(right), /Automatic/);
    assert.match(text(right), /Off/);
    updateSensorInspector(frame('ok'), right);
    assert.match(text(right), /Axial force.*-12.000 N/);
    assert.match(text(right), /Attachment force.*13.000 N/);
    for (const status of ['disconnected', 'unavailable', 'no-power']) {
      updateSensorInspector(frame(status), right);
      assert.doesNotMatch(
        right.querySelector('.sensor-live').textContent,
        /0\.000 N|13\.000|-12\.000/,
      );
    }
    assert.match(text(right), /If another connection bypasses/);
  } finally {
    globalThis.document = prior;
  }
});
test('selected load cell axis follows completed pose and stays A to B under compression', () => {
  const scene = new THREE.Scene(),
    view = createSensorView(scene);
  try {
    view.update(frame('ok'), 'cell');
    const group = scene.getObjectByName('sensor-measurement-preview');
    assert.equal(group.visible, true);
    assert.deepEqual(group.position.toArray(), [1, 2, 3]);
    const arrows = group.children.filter((x) => x instanceof THREE.ArrowHelper && x.visible);
    assert.equal(arrows.length, 1);
    const direction = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(arrows[0].quaternion)
      .applyQuaternion(group.quaternion);
    assert.ok(direction.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-12);
    view.update(frame('unavailable'), 'cell');
    assert.equal(group.visible, true, 'axis is geometry, not a claimed valid force');
    view.update(frame('ok'), 'missing');
    assert.equal(group.visible, false);
  } finally {
    view.dispose();
  }
  assert.equal(scene.children.length, 0);
});
test('load cell channels and help distinguish magnitude from signed force without capacity promises', () => {
  assert.equal(
    portLabel(part, { kind: 'signal', id: 'axialForce' }),
    'Axial force (+ pull / − push) (N)',
  );
  assert.equal(portLabel(part, { kind: 'signal', id: 'load' }), 'Attachment force (N)');
  const help = PART_HELP.loadCellSensor;
  assert.ok(help);
  const text = JSON.stringify(help);
  assert.match(text, /torque/);
  assert.match(text, /peak/);
  assert.match(text, /Automatic/);
});
