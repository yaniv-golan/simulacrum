import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CATALOG } from '../src/model/catalog.mjs';
import { createSensorDetails } from '../src/presentation/part-visuals/sensors.mjs';

function withCanvas(run) {
  const original = globalThis.document,
    drawings = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const calls = [];
      drawings.push(calls);
      const context = new Proxy(
        {},
        {
          set(target, key, value) {
            target[key] = value;
            calls.push(['set', key, value]);
            return true;
          },
          get(target, key) {
            return target[key] ?? ((...args) => calls.push([key, ...args]));
          },
        },
      );
      return { getContext: () => context };
    },
  };
  try {
    return run(drawings);
  } finally {
    globalThis.document = original;
  }
}
const sensors = Object.keys(CATALOG).filter((type) => type.endsWith('Sensor'));
const options = (type) => ({
  type,
  halfExtents: CATALOG[type].primitives[0].halfExtents,
  parameters: { axis: 0 },
});

test('all authored sensors receive three bounded, unpickable face coatings, other parts decline', () =>
  withCanvas(() => {
    assert.equal(sensors.length, 8);
    assert.equal(createSensorDetails(options('beam')), null);
    for (const type of sensors) {
      const spec = options(type),
        before = structuredClone(spec),
        group = createSensorDetails(spec);
      assert.deepEqual(spec, before);
      assert.equal(group.children.length, 3);
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(box.max.getComponent(axis) <= spec.halfExtents[axis] + 0.0007 + 1e-8);
        assert.ok(box.min.getComponent(axis) >= -spec.halfExtents[axis] - 0.0007 - 1e-8);
      }
      const front = group.children[0];
      assert.ok(Math.abs(front.position.z - spec.halfExtents[2] - 0.0005) < 1e-12);
      assert.deepEqual(front.rotation.toArray().slice(0, 3), [0, 0, 0]);
      const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
      assert.equal(ray.intersectObject(group, true).length, 0);
      // Wrong control: restoring ordinary mesh picking must hit its face.
      front.raycast = THREE.Mesh.prototype.raycast;
      assert.ok(ray.intersectObject(group, true).length > 0);
      for (const mesh of group.children) {
        assert.equal(mesh.geometry.type, 'PlaneGeometry');
        assert.equal(mesh.material.emissive.getHex(), 0);
        assert.equal(mesh.material.map.colorSpace, THREE.SRGBColorSpace);
        let freed = 0;
        for (const resource of [mesh.geometry, mesh.material, mesh.material.map])
          resource.addEventListener('dispose', () => freed++);
        mesh.geometry.dispose();
        mesh.material.map.dispose();
        mesh.material.dispose();
        assert.equal(freed, 3);
      }
    }
  }));

test('instrument graphics distinguish measurement identity without optical or live-value inventions', () =>
  withCanvas((drawings) => {
    const expected = {
      rangeSensor: 'RANGE +Z',
      contactSensor: 'TOUCH / LOAD',
      targetSensor: 'PAIRED CENTRES',
      linearMotionSensor: 'LOCAL VELOCITY',
      tiltSensor: 'GRAVITY / RATE',
      jointAngleSensor: 'BOUND JOINT',
      rotationSensor: 'LOCAL X RATE',
      travelSensor: 'BOUND SPRING',
    };
    const signatures = [];
    for (const type of sensors) {
      const start = drawings.length;
      createSensorDetails(options(type));
      const commands = drawings.slice(start).flat();
      const words = commands.filter((c) => c[0] === 'fillText').map((c) => c[1]);
      assert.ok(words.includes(expected[type]), type);
      assert.ok(!words.some((x) => /\b(?:GPS|COMPASS|LIVE|ON|OFF|camera)\b/i.test(x)));
      assert.ok(
        commands.filter((c) => ['lineTo', 'arc', 'strokeRect', 'fillRect'].includes(c[0])).length >
          10,
      );
      signatures.push(JSON.stringify(commands));
    }
    assert.equal(new Set(signatures).size, sensors.length);
  }));

test('angular-rate axis coating follows authored selection and is stable for unchanged inputs', () =>
  withCanvas((drawings) => {
    const images = [];
    for (const axis of [0, 1, 2, 2]) {
      const start = drawings.length;
      createSensorDetails({ ...options('rotationSensor'), parameters: { axis } });
      images.push(JSON.stringify(drawings.slice(start)));
    }
    assert.notEqual(images[0], images[1]);
    assert.notEqual(images[1], images[2]);
    assert.equal(images[2], images[3]);
  }));

test('contact membrane covers the full active +Z face; other faces only identify it', () =>
  withCanvas((drawings) => {
    const group = createSensorDetails(options('contactSensor'));
    const front = group.children[0];
    assert.equal(front.geometry.parameters.width, 0.05);
    assert.equal(front.geometry.parameters.height, 0.03);
    const hasPad = (calls) =>
      calls.some(
        (c, i) =>
          JSON.stringify(c) === JSON.stringify(['set', 'fillStyle', '#70634f']) &&
          JSON.stringify(calls[i + 1]) === JSON.stringify(['fillRect', 0, 0, 512, 256]),
      );
    assert.equal(hasPad(drawings[0]), true);
    assert.equal(hasPad(drawings[1]), false);
    assert.equal(hasPad(drawings[2]), false);
    assert.ok(drawings[1].some((c) => c[0] === 'fillText' && c[1] === 'FRONT +Z'));
    assert.throws(() => assert.equal(front.geometry.parameters.width * 0.96, 0.05));
  }));

test('range lens is centred at the sensing ray origin and remains visible after the socket band', () =>
  withCanvas((drawings) => {
    const group = createSensorDetails(options('rangeSensor'));
    const front = group.children[0],
      calls = drawings[0];
    const lens = calls.findIndex((c) => c[0] === 'arc' && c[3] === 29);
    assert.ok(lens >= 0);
    const [, x, y] = calls[lens];
    const local = [
      (x / 512 - 0.5) * front.geometry.parameters.width,
      (0.5 - y / 256) * front.geometry.parameters.height,
    ];
    assert.deepEqual(local, [0, 0]);
    const band = calls.findIndex(
      (c) => JSON.stringify(c) === JSON.stringify(['fillRect', 25, 103, 462, 47]),
    );
    assert.ok(band < lens);
    assert.throws(() => assert.deepEqual([0, (0.5 - 63 / 256) * 0.03], [0, 0]));
  }));

test('authored angular axis oracle rejects fixed-X artwork for Y and Z selections', () =>
  withCanvas((drawings) => {
    const matches = (commands, axis) =>
      commands.some((c) => c[0] === 'fillText' && c[1] === `LOCAL ${axis} RATE`);
    for (const axis of [0, 1, 2]) {
      const start = drawings.length;
      createSensorDetails({ ...options('rotationSensor'), parameters: { axis } });
      const commands = drawings.slice(start).flat();
      assert.ok(matches(commands, ['X', 'Y', 'Z'][axis]));
      if (axis > 0) assert.throws(() => assert.ok(matches(commands, 'X')));
    }
  }));

test('tilt uses a distinct gravity graticule, not the linear-motion triad', () =>
  withCanvas((drawings) => {
    createSensorDetails(options('tiltSensor'));
    const tilt = drawings.flat(),
      words = tilt.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    assert.ok(words.includes('g REF'));
    assert.ok(!words.includes('X') && !words.includes('Y') && !words.includes('Z'));
    const start = drawings.length;
    createSensorDetails(options('linearMotionSensor'));
    const motion = drawings
      .slice(start)
      .flat()
      .filter((c) => c[0] === 'fillText')
      .map((c) => c[1]);
    assert.ok(['X', 'Y', 'Z'].every((axis) => motion.includes(axis)));
    assert.throws(() => assert.ok(motion.includes('g REF')));
  }));

test('side range direction and motion axes match each coated face local frame', () =>
  withCanvas((drawings) => {
    createSensorDetails(options('rangeSensor'));
    const sideRange = drawings[1];
    assert.ok(sideRange.some((c) => JSON.stringify(c) === JSON.stringify(['moveTo', 345, 62])));
    assert.ok(sideRange.some((c) => JSON.stringify(c) === JSON.stringify(['lineTo', 183, 62])));
    const start = drawings.length;
    createSensorDetails(options('linearMotionSensor'));
    const [front, side] = drawings.slice(start);
    const textAt = (calls, label, x, y) =>
      calls.some((c) => JSON.stringify(c) === JSON.stringify(['fillText', label, x, y]));
    assert.ok(textAt(front, 'X', 370, 86));
    assert.ok(textAt(front, 'Z', 286, 91));
    assert.ok(textAt(side, 'Z', 142, 86));
    assert.ok(textAt(side, 'X', 286, 91));
    assert.ok(textAt(front, 'Y', 256, 24) && textAt(side, 'Y', 256, 24));
    assert.throws(() => assert.ok(textAt(side, 'X', 370, 86)));
  }));

test('top identity emblems distinguish every sensor without color and clear the real power socket', () =>
  withCanvas((drawings) => {
    const signatures = [];
    for (const type of sensors) {
      const start = drawings.length;
      const group = createSensorDetails(options(type));
      const top = group.children[2];
      assert.ok(top);
      assert.ok(Math.abs(top.position.y - 0.015 - 0.0005) < 1e-12);
      assert.equal(top.rotation.x, -Math.PI / 2);
      const calls = drawings[start + 2];
      // Emblems flank the central 0.014 m diameter socket: no painted top lens/pad.
      assert.ok(
        calls.some((c) => JSON.stringify(c) === JSON.stringify(['clearRect', 170, 170, 172, 172])),
      );
      signatures.push(JSON.stringify(calls.filter((c) => c[0] !== 'fillText')));
    }
    assert.equal(new Set(signatures).size, sensors.length);
    assert.throws(() => assert.equal(new Set([signatures[0], signatures[0]]).size, 2));
  }));
