import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArticulatedSuspensionBench,
  createManualActiveSuspensionBench,
  createActiveSuspensionBench,
  createPinEndedStrut,
} from '../src/model/fixtures/articulated-suspension.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { CATALOG } from '../src/model/catalog.mjs';
import { rotateVector, solidsOverlap, placementEnvelopes } from '../src/model/surfaces.mjs';
import {
  configuration,
  sample,
  supportFor,
  supported,
  tracking,
  automatic,
  worldPoint,
  checkPinFrames,
  swivelled,
  pinRotation,
  bothPinsMove,
  loadRejection,
  recovered,
  clearanceChecker,
} from './contracts/suspension.mjs';

test('ordinary pin-ended suspension carries wheel load through its real foot and tire', async () => {
  const bp = createArticulatedSuspensionBench(),
    s = await createSession(configuration(bp));
  try {
    const rows = [];
    for (let t = 0; t < 600; t++) {
      s.step();
      if (t >= 360) rows.push(sample(s, bp));
    }
    supported(rows);
    assert.ok(rows.every((r) => r.length > 0.29 && r.length < 0.31));
    const wrong = structuredClone(rows);
    wrong[0].support['lower-adapter'] = 1;
    assert.throws(() => supported(wrong), /unexpected support/);
    const unsupportedFoot = structuredClone(rows);
    for (const row of unsupportedFoot) delete row.support.foot;
    assert.throws(() => supported(unsupportedFoot), /foot carries load/);
  } finally {
    s.dispose();
  }
});

test('upper rocker has loaded manual authority over the common target interval', async () => {
  for (const material of ['rubber', 'aluminium', 'steel']) {
    const bp = createManualActiveSuspensionBench();
    bp.parts.find((p) => p.id === 'arm').authoredMaterial.body = material;
    const node = bp.parts.findIndex((p) => p.id === 'rocker-receiver'),
      s = await createSession(configuration(bp));
    try {
      const endpoints = [];
      for (const duty of [0, 0.2, -0.2]) {
        assert.ok(s.act({ type: 'receiver', node, duty }).ok);
        const rows = [];
        for (let t = 0; t < 300; t++) {
          s.step();
          if (t >= 180) rows.push(sample(s, bp));
        }
        supported(rows);
        endpoints.push(rows);
      }
      assert.ok(endpoints[1].every((r) => r.length < 0.26 && r.length > 0.08));
      assert.ok(endpoints[2].every((r) => r.length > 0.33 && r.length < 0.4));
      assert.ok(
        endpoints[2].at(-1).cell < endpoints[0][0].cell,
        'powered motion consumes cell energy',
      );
    } finally {
      s.dispose();
    }
  }
});

test('ordinary commands author the articulated loop and preload it after closure', async () => {
  const source = createManualActiveSuspensionBench(),
    spring = source.connections.find((c) => c.kind === 'spring'),
    g = source.parts.find((p) => p.id === spring.a.part),
    c = source.parts.find((p) => p.id === spring.b.part);
  const point = (p) =>
    rotateVector(p.rotation, CATALOG[p.type].ports.find((p) => p.id === 'slide').position).map(
      (v, i) => v + p.position[i],
    );
  const a = point(g),
    z = point(c),
    axis = rotateVector(g.rotation, [0, 1, 0]),
    length = z.reduce((n, v, i) => n + (v - a[i]) * axis[i], 0),
    rest = g.parameters.restLength;
  for (const wrongOrder of [false, true]) {
    const w = await createWorkshop(createEmptyBlueprint('authored', 'Authored suspension'));
    try {
      for (const part of source.parts) {
        const p = structuredClone(part);
        if (p.id === g.id && !wrongOrder) p.parameters.restLength = length;
        assert.ok((await w.act({ type: 'insert', part: p })).ok);
      }
      for (const edge of source.connections.filter((c) => c.kind !== 'spring'))
        assert.ok((await w.act({ type: 'connect', id: edge.id, a: edge.a, b: edge.b })).ok);
      const result = await w.act({ type: 'connect', id: spring.id, a: spring.a, b: spring.b });
      if (wrongOrder) {
        assert.equal(result.reasonCode, 'INCOMPATIBLE_CONNECTION_LOOP');
        continue;
      }
      assert.ok(result.ok);
      assert.ok((await w.act({ type: 'parameter', id: g.id, key: 'restLength', value: rest })).ok);
      assert.equal(w.save().parts.find((p) => p.id === g.id).parameters.restLength, rest);
      assert.equal(configuration(w.save()).joints.length, configuration(source).joints.length);
    } finally {
      w.dispose();
    }
  }
});

test('support rejects reversed normal and a single incidental touch', () => {
  const rows = Array.from({ length: 100 }, (_, tick) => ({ tick, support: { wheel: 1, foot: 1 } }));
  supported(rows);
  const bp = { parts: [{ id: 'wheel' }, { id: 'foot' }] };
  const contacts = [0, 1].map((a) => ({ a, b: 2, normalImpulse: [0, -1 / 120, 0] }));
  assert.deepEqual(supportFor(contacts, 2, bp), rows[0].support);
  const reversed = contacts.map((c) => ({ ...c, normalImpulse: [0, 1 / 120, 0] }));
  assert.throws(() => supported([{ support: supportFor(reversed, 2, bp) }]), /carries load/);
  const wall = contacts.map((c) => ({ ...c, normalImpulse: [1 / 120, 0, 0] }));
  assert.throws(() => supported([{ support: supportFor(wall, 2, bp) }]), /carries load/);
  const stale = structuredClone(rows);
  stale[50].tick = 49;
  assert.throws(() => supported(stale), /consecutive/);
  const intermittent = structuredClone(rows);
  for (const row of intermittent.slice(1)) row.support = {};
  assert.throws(() => supported(intermittent), /sustained/);
});

test('support floor separates a calibrated resting mass from unloaded touching geometry', async () => {
  for (const gravity of [-9.81, 0]) {
    const body = (position, fixed) => ({
      shape: 'box',
      halfExtents: [0.1, 0.1, 0.1],
      position,
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      mass: 1,
      fixed,
      friction: 0,
      restitution: 0,
    });
    const w = await createPhysicsWorld({
      joints: [],
      gravity: [0, gravity, 0],
      bodies: [body([0, 0.1, 0], false), body([0, -0.1, 0], true)],
    });
    try {
      let impulse = 0;
      for (let tick = 0; tick < 360; tick++) {
        w.step();
        if (tick >= 240) {
          const contacts = w.contacts();
          assert.equal(contacts.available, true);
          const force = supportFor(contacts.rows, 1, { parts: [{ id: 'wheel' }] }).wheel ?? 0;
          impulse += force / 120;
        }
      }
      if (gravity)
        assert.ok(
          Math.abs(impulse - 9.81) < 0.01,
          'one kilogram carries its independently known weight',
        );
      else assert.equal(impulse, 0, 'unloaded touching is not support');
    } finally {
      w.dispose();
    }
  }
});

test('authored pin-ended topology preserves endpoint frames while the entire strut swivels', async () => {
  const bp = createManualActiveSuspensionBench(),
    config = configuration(bp),
    s = await createSession(config);
  try {
    const start = s.observe().frames[0];
    let moving;
    // Exercise real articulation through the ordinary manual rocker. A balanced
    // passive bench need not swivel spontaneously when its contacts settle.
    assert.ok(
      s.act({
        type: 'receiver',
        node: bp.parts.findIndex((part) => part.id === 'rocker-receiver'),
        duty: 0.2,
      }).ok,
    );
    for (let tick = 0; tick < 600; tick++) {
      s.step();
      const f = s.observe().frames[0];
      checkPinFrames(f, config.joints);
      if (tick === 100) moving = f;
    }
    swivelled(start, moving);
    assert.throws(() => swivelled(start, start), /must swivel/);
    const stale = structuredClone(moving);
    stale.springs[0].pointA = start.springs[0].pointA;
    assert.throws(() => checkPinFrames(stale, config.joints), /endpoint follows/);
    const drift = structuredClone(moving);
    drift.physics[2].position[1] += 0.001;
    assert.throws(() => checkPinFrames(drift, config.joints), /anchors coincide/);
  } finally {
    s.dispose();
  }
});

test('manual rocker motion exercises both ordinary spring-end pins', async () => {
  const manual = createManualActiveSuspensionBench(),
    mc = configuration(manual),
    ms = await createSession(mc);
  try {
    const start = ms.observe().frames[0],
      pins = mc.joints.filter(
        (j) => j.kind === 'revolute' && ['upper-pin', 'lower-pin'].includes(manual.parts[j.a].id),
      );
    assert.equal(pins.length, 2);
    const motion = [0, 0];
    assert.ok(
      ms.act({
        type: 'receiver',
        node: manual.parts.findIndex((p) => p.id === 'rocker-receiver'),
        duty: 0.2,
      }).ok,
    );
    for (let t = 0; t < 600; t++) {
      ms.step();
      const f = ms.observe().frames[0];
      pins.forEach((j, i) => (motion[i] = Math.max(motion[i], pinRotation(start, f, j))));
    }
    bothPinsMove(motion);
    for (let frozen = 0; frozen < 2; frozen++) {
      const wrong = [...motion];
      wrong[frozen] = 0;
      assert.throws(() => bothPinsMove(wrong), /both spring-end/);
    }
  } finally {
    ms.dispose();
  }
});

test('pin-ended strut inserts with two real mounts and preserves its pin joints after save and rotation', async () => {
  const definition = createPinEndedStrut();
  assert.deepEqual(
    definition.assemblies[0].ports.map((p) => p.name),
    ['Upper pin mount', 'Lower pin mount'],
  );
  for (const rotation of [
    [0, 0, 0, 1],
    [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  ]) {
    const workshop = await createWorkshop(createEmptyBlueprint('pin-module', 'Pin module'));
    try {
      assert.ok(
        (await workshop.act({ type: 'insert-assembly', definition, position: [0, 2, 0], rotation }))
          .ok,
      );
      const group = workshop.save().assemblies[0];
      for (const [index, portName] of ['Upper pin mount', 'Lower pin mount'].entries()) {
        const part = createPart('beam', `mount-${index}`, [3 + index, 2, 0]);
        assert.ok((await workshop.act({ type: 'insert', part })).ok);
        assert.ok(
          (
            await workshop.act({
              type: 'connect-assembly',
              id: group.id,
              portName,
              target: { part: part.id, surface: { region: 'left', u: 0, v: 0, twist: 0 } },
              connectionId: `external-${index}`,
            })
          ).ok,
        );
      }
      const saved = workshop.save(),
        loaded = loadSave(JSON.stringify(saved));
      assert.ok(loaded.ok);
      assert.equal(
        compileAssembly(loaded.blueprint).configuration.joints.filter((j) => j.kind === 'revolute')
          .length,
        2,
      );
      const captured = captureAssembly(saved, {
        name: 'Edited pin module',
        ids: saved.parts.map((p) => p.id),
        ports: saved.assemblies[0].ports,
      }).definition;
      const copied = insertAssembly(
        createEmptyBlueprint('copy', 'Copy'),
        captured,
        [0, 3, 0],
        rotation,
      ).blueprint;
      assert.equal(
        compileAssembly(copied).configuration.joints.filter((j) => j.kind === 'revolute').length,
        2,
      );
      const noPins = structuredClone(copied);
      noPins.connections = noPins.connections.filter((c) => c.kind !== 'shaft');
      assert.notEqual(
        compileAssembly(noPins).configuration.joints.filter((j) => j.kind === 'revolute').length,
        2,
      );
    } finally {
      workshop.dispose();
    }
  }
});
