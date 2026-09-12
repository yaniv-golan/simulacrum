import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { assertRejectedEditUnchanged, assertEditRoundTrip } from './contracts/editing.mjs';

import { machine, configuration } from './fixtures/linear-machine.mjs';
const frame = (s) => s.observe().frames[0];

test('linear catalog compiles an ordinary passive slide with funded axial drive; edits are atomic', async () => {
  const b = machine(),
    c = compileAssembly(b).configuration;
  assert.equal(c.joints[0].stiffness, 0);
  assert.equal(c.joints[0].damping, 0);
  assert.equal(c.power.motors[0].coordinate, 'linear');
  assert.equal(loadSave(b).ok, true);
  const w = await createWorkshop(b);
  try {
    await assertRejectedEditUnchanged(w, {
      type: 'parameter',
      id: 'drive',
      key: 'minLength',
      value: 0.39,
    });
    await assertEditRoundTrip(w, { type: 'parameter', id: 'drive', key: 'currentLimit', value: 1 });
  } finally {
    w.dispose();
  }
  const renamed = structuredClone(b);
  renamed.name = 'Different machine';
  renamed.parts.forEach((p) => {
    p.name = `Unrelated ${p.id}`;
    const old = p.id;
    p.id = `renamed-${old}`;
    renamed.connections.forEach((e) => {
      for (const side of ['a', 'b']) if (e[side].part === old) e[side].part = p.id;
    });
  });
  assert.deepEqual(compileAssembly(renamed).configuration, c);
  const changed = structuredClone(b);
  changed.parts[0].authoredMaterial.body = 'aluminium';
  const material = compileAssembly(changed).configuration;
  assert.ok(material.bodies[0].mass < c.bodies[0].mass);
  assert.deepEqual(material.power, c.power);
});

test('loaded extension, reverse, powerless fall and overload are distinct physical outcomes', async () => {
  for (const [options, direction] of [
    [{}, 1],
    [{ duty: -1 }, -1],
    [{ powered: false }, -1],
    [{ mass: 20 }, -1],
  ]) {
    const s = await createSession(configuration(options));
    try {
      const initial = frame(s).springs[0].length;
      s.step(30);
      assert.equal(frame(s).status, 'ready');
      assert.ok(
        (frame(s).springs[0].length - initial) * direction > 0.005,
        JSON.stringify(options),
      );
      if (options.powered === false) {
        assert.equal(frame(s).power.motors[0].torque, 0);
        assert.equal(frame(s).power.cells[0].heatJ, 0);
      } else assert.ok(frame(s).power.motors[0].heatJ > 0);
    } finally {
      s.dispose();
    }
  }
});

test('finite stroke stops motion under drive while consuming energy; off does not latch', async () => {
  const c = configuration(),
    s = await createSession(c);
  try {
    s.step(400);
    assert.equal(frame(s).status, 'ready');
    assert.ok(Math.abs(frame(s).springs[0].length - 0.4) < 0.001);
    assert.ok(Math.abs(frame(s).springs[0].speed) < 0.001);
    const charge = frame(s).power.cells[0].energyJ;
    s.step(60);
    assert.ok(frame(s).power.cells[0].energyJ < charge);
    const cp = s.checkpoint();
    s.step(23);
    const expected = frame(s);
    s.restore(cp);
    s.step(23);
    assert.deepEqual(frame(s).physics, expected.physics);
    assert.deepEqual(frame(s).power, expected.power);
    assert.ok(Math.abs(frame(s).energy.balanceResidualJ) < 0.002);
  } finally {
    s.dispose();
  }
});

test('free endpoints react equally and discrete actuator work funds kinetic energy', async () => {
  const c = configuration({ fixed: false, gravity: 0 });
  c.bodies[0].mass = 1;
  const s = await createSession(c);
  try {
    s.step(1);
    const f = frame(s),
      a = f.physics[0],
      b = f.physics[1];
    assert.ok(a.velocity[1] < 0 && b.velocity[1] > 0);
    assert.ok(Math.abs(a.velocity[1] + b.velocity[1]) < 1e-8);
    const kinetic = (a.velocity[1] ** 2 + b.velocity[1] ** 2) / 2;
    assert.ok(Math.abs(kinetic - f.power.motors[0].mechanicalEnergy) < 1e-6);
    assert.ok(f.power.motors[0].electricalEnergy >= kinetic);
    assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-6);
  } finally {
    s.dispose();
  }
});

test('complete-tick stroke and energy bounds reject unpaid lifting and allow external overspeed', async () => {
  const c = configuration(),
    s = await createSession(c);
  try {
    const y0 = frame(s).physics[1].position[1],
      charge0 = frame(s).power.cells[0].energyJ;
    const bound = (f) => {
      const b = f.physics[1],
        m = f.power.motors[0],
        cell = f.power.cells[0];
      const mechanical =
        0.5 * b.mass * b.velocity.reduce((sum, v) => sum + v * v, 0) +
        b.mass * 9.81 * (b.position[1] - y0);
      assert.ok(
        mechanical + cell.heatJ + m.heatJ + m.driverHeatJ <= charge0 - cell.energyJ + 0.002,
        'no unpaid complete-tick lift',
      );
      assert.ok(f.springs[0].length >= 0.079 && f.springs[0].length <= 0.401, 'completed stroke');
    };
    for (let i = 0; i < 600; i++) {
      s.step(1);
      bound(frame(s));
    }
    const wrong = structuredClone(frame(s));
    wrong.physics[1].position[1] += 100;
    assert.throws(() => bound(wrong), /unpaid/);
  } finally {
    s.dispose();
  }
  const back = configuration({ powered: false });
  back.bodies[1].velocity = [0, -1, 0];
  const free = await createSession(back);
  try {
    free.step(1);
    assert.ok(
      frame(free).springs[0].endpointVelocity < -0.5,
      'external motion is not speed-clamped',
    );
  } finally {
    free.dispose();
  }
});

test('travel sensor samples the powered slide on the prior completed tick and binding edits stay atomic', async () => {
  const b = machine();
  b.parts.push(createPart('travelSensor', 'sensor', [4, 1, 0]));
  b.parts.at(-1).springBinding = 'slide';
  b.connections.push({
    id: 'sensor-power',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'sensor', port: 'power' },
  });
  const c = compileAssembly(b).configuration;
  c.bodies[0].fixed = true;
  c.power.receivers[0].duty = 1;
  const s = await createSession(c);
  try {
    s.step(10);
    const previous = frame(s).springs[0].length;
    s.step(1);
    const reading = frame(s).sensors.readings.find((r) => r.node === 4);
    assert.equal(reading.channels.length.status, 'ok');
    assert.ok(Math.abs(reading.channels.length.value - previous) < 1e-9);
  } finally {
    s.dispose();
  }
  const w = await createWorkshop(b);
  try {
    await assertRejectedEditUnchanged(w, {
      type: 'parameter',
      id: 'drive',
      key: 'maxSpeed',
      value: 0,
    });
    await assertEditRoundTrip(w, { type: 'parameter', id: 'drive', key: 'maxSpeed', value: 0.1 });
  } finally {
    w.dispose();
  }
});

test('authored driven speed bounds powered acceleration and queued reversal survives checkpoint', async () => {
  const c = configuration({ gravity: 0 });
  c.power.cells[0].voltage = 240;
  c.power.motors[0].maxSpeed = 0.05;
  const s = await createSession(c);
  try {
    for (let i = 0; i < 120; i++) {
      s.step();
      assert.ok(frame(s).springs[0].endpointVelocity <= 0.050001);
    }
    assert.ok(frame(s).springs[0].length > 0.24);
    s.act({ type: 'receiver', node: 3, duty: -1 });
    const cp = s.checkpoint();
    s.step(30);
    const expected = frame(s);
    s.restore(cp);
    s.step(30);
    assert.deepEqual(frame(s).physics, expected.physics);
    assert.deepEqual(frame(s).power, expected.power);
    const before = s.checkpoint(),
      bad = structuredClone(before);
    bad.power.motors[0].heatJ = -1;
    assert.throws(() => s.restore(bad));
    assert.deepEqual(s.checkpoint(), before);
  } finally {
    s.dispose();
  }
});

import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { proposeMirroredAssembly } from '../src/model/mirror-assembly.mjs';
import { assertCopiedGraph } from './contracts/copied-graph.mjs';
test('linear module copy and library insertion preserve authored settings and independent wired graphs', async () => {
  const b = machine();
  Object.assign(b.parts[0].parameters, {
    forceConstant: 53,
    resistance: 7,
    currentLimit: 1.3,
    maxSpeed: 0.17,
    minLength: 0.1,
    maxLength: 0.35,
  });
  b.parts[0].authoredMaterial.body = 'aluminium';
  const ids = b.parts.map((p) => p.id),
    beforeCapture = structuredClone(b);
  const unchanged = (actual, before) =>
    assert.deepEqual(actual, before, 'operation preserves its input');
  const pose = (part, position, rotation) => {
    assert.ok(
      Math.hypot(...part.position.map((v, i) => v - position[i])) < 1e-9,
      'independent copied position',
    );
    const same = Math.hypot(...part.rotation.map((v, i) => v - rotation[i]));
    const opposite = Math.hypot(...part.rotation.map((v, i) => v + rotation[i]));
    assert.ok(Math.min(same, opposite) < 1e-9, 'independent copied rotation');
  };
  const { definition } = captureAssembly(b, {
    name: 'Sliding module',
    ids,
    ports: [{ name: 'Supply', endpoint: { part: 'drive', port: 'power' } }],
  });
  unchanged(b, beforeCapture);
  const beforeInsert = structuredClone(b),
    beforeDefinition = structuredClone(definition);
  const mutatedSource = structuredClone(beforeCapture);
  mutatedSource.parts[0].parameters.resistance = 8;
  assert.throws(() => unchanged(mutatedSource, beforeCapture), /preserves its input/);
  const inserted = insertAssembly(b, definition, [6, 1, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
  unchanged(b, beforeInsert);
  unchanged(definition, beforeDefinition);
  const insertedPoses = (result) => {
    for (const original of beforeDefinition.parts) {
      assert.deepEqual(original.rotation, [0, 0, 0, 1], 'fixture starts axis aligned');
      const [x, y, z] = original.position;
      pose(
        result.blueprint.parts.find((p) => p.id === result.idMap[original.id]),
        [6 - (y - 1), 1 + x, z],
        [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      );
    }
  };
  insertedPoses(inserted);
  const unrotated = insertAssembly(b, definition, [6, 1, 0], [0, 0, 0, 1]);
  unchanged(b, beforeInsert);
  unchanged(definition, beforeDefinition);
  assert.throws(() => insertedPoses(unrotated), /independent copied/);
  const check = (result) =>
    assertCopiedGraph({
      source: beforeInsert,
      copied: result.blueprint,
      partIds: ids,
      idMap: result.idMap,
      connectionIdMap: result.connectionIdMap,
    });
  check(inserted);
  const wrong = structuredClone(inserted);
  wrong.blueprint.parts.find((p) => p.id === wrong.idMap.drive).parameters.currentLimit = 2;
  assert.throws(() => check(wrong), /authored/);
  const c = compileAssembly(loadSave(inserted.blueprint).blueprint).configuration;
  assert.equal(c.power.motors.length, 2);
  for (const m of c.power.motors) {
    assert.equal(m.torqueConstant, 53);
    assert.equal(m.resistance, 7);
    assert.equal(m.currentLimit, 1.3);
    assert.equal(m.maxSpeed, 0.17);
  }
  const mirroredSource = structuredClone(b);
  mirroredSource.parts.push(createPart('chassis', 'reference', [-3, 0.02, 0]));
  const beforeMirror = structuredClone(mirroredSource);
  const mirrored = proposeMirroredAssembly(mirroredSource, {
    ids,
    referenceId: 'reference',
    axis: 'x',
  });
  unchanged(mirroredSource, beforeMirror);
  const mirroredPoses = (result) => {
    for (const id of ids) {
      const original = beforeMirror.parts.find((p) => p.id === id);
      const [x, y, z] = original.position;
      pose(
        result.blueprint.parts.find((p) => p.id === result.idMap[id]),
        [-6 - x, y, z],
        [0, 1, 0, 0],
      );
    }
  };
  mirroredPoses(mirrored);
  const untranslated = structuredClone(mirrored);
  untranslated.blueprint.parts.find((p) => p.id === untranslated.idMap.drive).position = [
    ...beforeMirror.parts[0].position,
  ];
  assert.throws(() => mirroredPoses(untranslated), /independent copied position/);
  const unmirrored = structuredClone(mirrored);
  unmirrored.blueprint.parts.find((p) => p.id === unmirrored.idMap.drive).rotation = [0, 0, 0, 1];
  assert.throws(() => mirroredPoses(unmirrored), /independent copied rotation/);
  assertCopiedGraph({
    source: beforeMirror,
    copied: mirrored.blueprint,
    partIds: ids,
    idMap: mirrored.idMap,
    connectionIdMap: mirrored.connectionIdMap,
  });
  assert.equal(compileAssembly(mirrored.blueprint).configuration.power.motors.length, 2);
  const w = await createWorkshop(b);
  try {
    await assertEditRoundTrip(w, {
      type: 'insert-assembly',
      definition,
      position: [6, 1, 0],
      rotation: [0, 0, 0, 1],
    });
    unchanged(definition, beforeDefinition);
    unchanged(b, beforeInsert);
    const saved = w.save(),
      copy = saved.parts.find((p) => p.type === 'linearActuator' && p.id !== 'drive');
    await assertEditRoundTrip(w, {
      type: 'parameter',
      id: copy.id,
      key: 'currentLimit',
      value: 0.9,
    });
    assert.equal(w.save().parts.find((p) => p.id === 'drive').parameters.currentLimit, 1.3);
    assert.equal(definition.parts[0].parameters.currentLimit, 1.3);
    const config = compileAssembly(w.save()).configuration;
    config.gravity = [0, 0, 0];
    config.power.receivers[0].duty = 1;
    config.power.receivers[1].duty = 0;
    const s = await createSession(config);
    try {
      const initial = frame(s).springs.map((row) => row.length);
      s.step(20);
      assert.ok(frame(s).springs[0].length > initial[0] + 0.001);
      assert.ok(Math.abs(frame(s).springs[1].length - initial[1]) < 1e-6);
      assert.equal(frame(s).power.motors[1].current, 0);
    } finally {
      s.dispose();
    }
  } finally {
    w.dispose();
  }
});
