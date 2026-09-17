import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import fc from 'fast-check';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
const part = (id, type = 'beam') => ({
  id,
  type,
  name: id,
  position: [id === 'b' ? 1 : 0, 0, 0],
  rotation: [0, 0, 0, 1],
  authoredMaterial: {},
  parameters: {},
});
const blueprint = () => ({
  version: 4,
  id: 'machine',
  name: 'Machine',
  parts: [part('a'), part('b')],
  connections: [],
});
const ports = () => ['left', 'right'];
test('compiler derives mass and contact coefficients only from catalog material', () => {
  const bp = blueprint(),
    compiled = compileAssembly(bp);
  const geometry = CATALOG.beam.primitives[0],
    material = MATERIALS[geometry.materialKey];
  assert.equal(
    compiled.configuration.bodies[0].mass,
    8 * geometry.halfExtents.reduce((x, y) => x * y, 1) * material.density,
  );
  assert.equal(compiled.configuration.bodies[0].friction, material.friction);
  assert.equal(compiled.mapping[0].part, 'a');
  assert.equal(compiled.mapping[0].materialHandle, material.handle);
  assert.equal('id' in compiled.configuration.bodies[0], false);
  bp.parts[0].position[0] = 99;
  assert.equal(compiled.configuration.bodies[0].position[0], 0);
});
test('snap authors mating port transforms and aligned connection compiles', () => {
  const bp = blueprint(),
    [pa, pb] = ports(),
    a = { part: 'a', surface: { region: pa, u: 0, v: 0, twist: 0 } },
    b = { part: 'b', surface: { region: pb, u: 0, v: 0, twist: 0 } };
  bp.parts[0].position = [2, 3, 4];
  bp.parts[0].rotation = [0, Math.sin(0.3), 0, Math.cos(0.3)];
  const snapped = snapConnection(bp, a, b);
  assert.deepEqual(bp.parts[1].position, [1, 0, 0]);
  snapped.connections.push({ id: 'joint', kind: 'fixed', a, b });
  const compiled = compileAssembly(snapped);
  assert.equal(compiled.configuration.joints.length, 1);
  assert.equal(compiled.configuration.joints[0].a, 0);
  assert.equal(compiled.configuration.joints[0].b, 1);
  snapped.parts[1].position[0] -= 0.003;
  const misaligned = compileAssembly(snapped);
  assert.equal(misaligned.configuration.joints.length, 0);
  assert.deepEqual(misaligned.connections, [{ id: 'joint', reasonCode: 'MISALIGNED' }]);
});
test('duplicate occupancy and unknown endpoints reject with paths', () => {
  const bp = blueprint(),
    [pa, pb] = ports(),
    a = { part: 'a', surface: { region: pa, u: 0, v: 0, twist: 0 } },
    b = { part: 'b', surface: { region: pb, u: 0, v: 0, twist: 0 } };
  const snapped = snapConnection(bp, a, b);
  snapped.connections = [
    { id: 'j1', kind: 'fixed', a, b },
    { id: 'j2', kind: 'fixed', a, b },
  ];
  assert.throws(
    () => compileAssembly(snapped),
    (e) => e.reasonCode === 'PORT_OCCUPIED' && e.path.length > 0,
  );
  assert.throws(
    () => snapConnection(bp, { part: 'missing', surface: { region: pa, u: 0, v: 0, twist: 0 } }, b),
    (e) => e.reasonCode === 'INVALID_ENDPOINT',
  );
});

test('renaming and rig placement never select material mass or contact properties', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1000000 }),
      fc.tuple(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
      ),
      (seed, position) => {
        const bp = blueprint(),
          before = compileAssembly(bp);
        bp.id = `machine-${seed}`;
        bp.name = `Renamed ${seed}`;
        bp.parts.forEach((p, i) => {
          p.id = `part-${seed}-${i}`;
          p.name = `Part ${seed}-${i}`;
          p.position = position.map((v, axis) => v + (axis === 0 ? i : 0));
        });
        const after = compileAssembly(bp);
        assert.deepEqual(
          after.mapping.map((m) => m.materialHandle),
          before.mapping.map((m) => m.materialHandle),
        );
        for (let i = 0; i < before.mapping.length; i++)
          for (const key of ['mass', 'friction', 'restitution', 'halfExtents'])
            assert.deepEqual(
              after.configuration.bodies[i][key],
              before.configuration.bodies[i][key],
            );
      },
    ),
    { numRuns: 100, seed: 917 },
  );
  const bp = blueprint();
  bp.parts[0].rigRole = 'support';
  assert.throws(() => compileAssembly(bp));
});
test('authored selectable material is copied without identity inference', () => {
  const bp = blueprint();
  bp.parts[0].authoredMaterial.body = 'steel';
  const result = compileAssembly(bp);
  assert.equal(result.mapping[0].materialHandle, MATERIALS.steel.handle);
  assert.ok(
    Math.abs(
      result.configuration.bodies[0].mass / result.configuration.bodies[1].mass -
        MATERIALS.steel.density / MATERIALS.aluminium.density,
    ) < 1e-12,
  );
  bp.parts[0].authoredMaterial.body = 'unknown';
  assert.throws(() => compileAssembly(bp));
});

test('renaming preserves authored body and joint indexing', () => {
  const bp = blueprint(),
    [pa, pb] = ports(),
    a = { part: 'a', surface: { region: pa, u: 0, v: 0, twist: 0 } },
    b = { part: 'b', surface: { region: pb, u: 0, v: 0, twist: 0 } };
  const snapped = snapConnection(bp, a, b);
  snapped.connections.push({ id: 'j', kind: 'fixed', a, b });
  const expected = compileAssembly(snapped).configuration;
  snapped.parts[0].id = 'z';
  snapped.parts[1].id = 'c';
  snapped.connections[0].a.part = 'z';
  snapped.connections[0].b.part = 'c';
  snapped.connections[0].id = 'renamed';
  assert.deepEqual(compileAssembly(snapped).configuration, expected);
});
test('ordinary power wire and shaft compile independently of connection geometry', async () => {
  const { createEmptyBlueprint, createPart } = await import('../src/model/blueprint.mjs');
  let bp = createEmptyBlueprint('powered', 'Powered');
  bp.parts = [
    createPart('powerCell', 'cell', [5, 0, 0]),
    createPart('poweredMotor', 'motor', [0, 0, 0]),
    createPart('gripWheel', 'wheel', [1, 0, 0]),
  ];
  bp = snapConnection(bp, { part: 'motor', port: 'shaft' }, { part: 'wheel', port: 'axle' });
  bp.connections = [
    {
      id: 'wire',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'motor', port: 'power' },
    },
    {
      id: 'shaft',
      kind: 'shaft',
      a: { part: 'motor', port: 'shaft' },
      b: { part: 'wheel', port: 'axle' },
    },
  ];
  const out = compileAssembly(bp);
  assert.deepEqual(out.configuration.power.wires, [[0, 1]]);
  assert.equal(out.configuration.joints[0].kind, 'revolute');
  assert.equal(out.configuration.power.motors[0].rotor, 2);
  assert.equal(out.configuration.power.motors[0].joint, 0);
  assert.equal(out.configuration.power.motors[0].defaultDuty, 1);
  bp.parts[2].position[1] += 0.003;
  const bad = compileAssembly(bp);
  assert.equal(bad.configuration.joints.length, 0);
  assert.equal(bad.configuration.power.motors[0].rotor, -1);
  assert.equal(bad.connections[1].reasonCode, 'MISALIGNED');
});
test('default workshop environment appends an unmapped fixed ground body', () => {
  const bp = blueprint(),
    compiled = compileAssembly(bp);
  assert.equal(compiled.configuration.bodies.length, compiled.mapping.length + 1);
  assert.equal(compiled.mapping.length, bp.parts.length);
  const ground = compiled.configuration.bodies.at(-1);
  assert.equal(ground.fixed, true);
  assert.equal(ground.position[1] + ground.halfExtents[1], 0);
  assert.equal(
    compiled.mapping.some((entry) => entry.part === 'ground'),
    false,
  );
  const analytical = compileAssembly(bp, { gravity: [0, 0, 0], ground: null });
  assert.equal(analytical.configuration.bodies.length, bp.parts.length);
});
test('wheel geometry compiles as a local-X cylinder with analytical material mass', async () => {
  const { createEmptyBlueprint, createPart } = await import('../src/model/blueprint.mjs');
  const bp = createEmptyBlueprint('wheel-mass', 'Wheel mass');
  bp.parts = [createPart('gripWheel', 'wheel', [0, 1, 0])];
  const compiled = compileAssembly(bp),
    body = compiled.configuration.bodies[0];
  assert.equal(CATALOG.gripWheel.primitives[0].kind, 'cylinder');
  assert.equal(body.shape, 'cylinder');
  assert.ok(
    Math.abs(body.mass - 2 * Math.PI * 0.025 * 0.1 ** 2 * MATERIALS.rubber.density) < 1e-12,
  );
  assert.equal(compiled.configuration.bodies.at(-1).shape, 'box');
  bp.id = 'renamed';
  bp.parts[0].id = 'different';
  bp.parts[0].name = 'Support';
  bp.parts[0].position = [9, 2, 4];
  const renamed = compileAssembly(bp).configuration.bodies[0];
  assert.equal(renamed.shape, body.shape);
  assert.equal(renamed.mass, body.mass);
  bp.parts[0].authoredMaterial.body = 'steel';
  assert.ok(
    Math.abs(
      compileAssembly(bp).configuration.bodies[0].mass / body.mass -
        MATERIALS.steel.density / MATERIALS.rubber.density,
    ) < 1e-12,
  );
});
test('explicit ground configuration is copied, bounded and strictly validated', () => {
  const ground = {
    position: [0, -0.25, 0],
    halfExtents: [3, 0.25, 3],
    friction: 0.4,
    restitution: 0,
  };
  const compiled = compileAssembly(blueprint(), { ground });
  ground.position[1] = 99;
  assert.equal(compiled.configuration.bodies.at(-1).position[1], -0.25);
  for (const patch of [
    { halfExtents: [1, 0, 1] },
    { friction: -1 },
    { restitution: 2 },
    { position: [0, Infinity, 0] },
    { hidden: true },
  ])
    assert.throws(
      () =>
        compileAssembly(blueprint(), {
          ground: {
            position: [0, -0.1, 0],
            halfExtents: [1, 0.1, 1],
            friction: 0.5,
            restitution: 0,
            ...patch,
          },
        }),
      (error) => error.reasonCode === 'INVALID_GROUND',
    );
});
test('default ground physically stops a falling ordinary beam', async () => {
  const { createSession } = await import('../src/simulation/session.mjs');
  const bp = blueprint();
  bp.parts = bp.parts.slice(0, 1);
  bp.parts[0].position = [0, 1, 0];
  const session = await createSession(compileAssembly(bp).configuration);
  try {
    session.step(240);
    const frame = session.observe().frames[0];
    assert.ok(Math.abs(frame.physics[0].position[1] - 0.02) < 0.003);
    assert.ok(Math.abs(frame.physics[0].velocity[1]) < 0.01);
    assert.ok(Math.abs(frame.physics[1].position[1] + 0.1) < 1e-7);
  } finally {
    session.dispose();
  }
});
test('surface mounts face outward and snapping moves the complete mechanical group', async () => {
  const { createEmptyBlueprint, createPart } = await import('../src/model/blueprint.mjs');
  let bp = createEmptyBlueprint('surface', 'Surface');
  bp.parts = [
    createPart('powerCell', 'cell', [0, 1, 0]),
    createPart('poweredMotor', 'motor', [1, 1, 0]),
    createPart('gripWheel', 'wheel', [2, 1, 0]),
  ];
  bp = snapConnection(bp, { part: 'motor', port: 'shaft' }, { part: 'wheel', port: 'axle' });
  bp.connections.push({
    id: 'shaft',
    kind: 'shaft',
    a: { part: 'motor', port: 'shaft' },
    b: { part: 'wheel', port: 'axle' },
  });
  assert.ok(Math.abs(bp.parts[2].position[0] - bp.parts[1].position[0] - 0.145) < 1e-12);
  bp = snapConnection(
    bp,
    { part: 'cell', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    { part: 'motor', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
  );
  assert.ok(Math.abs(bp.parts[1].position[0]) >= 0.18 - 1e-12);
  assert.equal(compileAssembly(bp).connections[0].reasonCode, 'OK');
  bp.connections.push({
    id: 'mount',
    kind: 'fixed',
    a: { part: 'cell', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    b: { part: 'motor', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
  });
  assert.equal(compileAssembly(bp).configuration.joints.length, 2);
  const wired = snapConnection(
    bp,
    { part: 'cell', port: 'power' },
    { part: 'motor', port: 'power' },
  );
  assert.deepEqual(wired, bp);
  assert.throws(
    () =>
      snapConnection(
        bp,
        { part: 'cell', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
        { part: 'wheel', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      ),
    (error) => error.reasonCode === 'INCOMPATIBLE_CONNECTION_LOOP',
  );
});
