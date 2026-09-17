import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CATALOG, assertDimensionDefaults } from '../src/model/catalog.mjs';
import { gearFacts, meshSpacingRepair } from '../src/model/gear-geometry.mjs';
import { partPrimitives } from '../src/model/geometry.mjs';
import {
  CURRENT_SAVE_VERSION,
  createEmptyBlueprint,
  createPart,
  loadSave,
  validateBlueprint,
} from '../src/model/blueprint.mjs';
import { compileAssembly, proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';
import { mechanicalGroup } from '../src/model/connection-graph.mjs';

const gear = (id, position, parameters = {}) => {
  const part = createPart('spurGear', id, position);
  Object.assign(part.parameters, parameters);
  return part;
};

test('a spur gear resolves its radii from the authored teeth and module, and nothing else', () => {
  // The catalog row carries mesh compliance only: no tooth count, module or radius is stored,
  // so there is no second writer that could disagree with the authored parameters.
  assert.deepEqual(Object.keys(CATALOG.spurGear.gear).sort(), ['damping', 'stiffness']);
  for (const [teeth, module, pitchRadius] of [
    [12, 0.01, 0.06],
    [24, 0.01, 0.12],
    [36, 0.01, 0.18],
    [12, 0.005, 0.03],
    [36, 0.005, 0.09],
  ]) {
    const facts = gearFacts(gear('g', [0, 0, 0], { teeth, module }));
    assert.equal(facts.teeth, teeth);
    assert.equal(facts.module, module);
    assert.ok(Math.abs(facts.pitchRadius - pitchRadius) < 1e-12, `${teeth}T pitch radius`);
    assert.ok(
      Math.abs(facts.colliderRadius - (pitchRadius - module)) < 1e-12,
      `${teeth}T collider radius`,
    );
    assert.equal(facts.stiffness, 20000);
    assert.equal(facts.damping, 20);
  }
  // Absent parameters are the canonical primitive, exactly as an absent beam length is.
  const bare = { ...gear('g', [0, 0, 0]), parameters: {} };
  assert.deepEqual(gearFacts(bare), gearFacts(gear('g', [0, 0, 0])));
  assert.equal(gearFacts(bare).pitchRadius, 0.06);
  assert.deepEqual(partPrimitives(bare)[0].halfExtents, CATALOG.spurGear.primitives[0].halfExtents);
  // A part with no gear fact has no gear facts: the helper never invents them from a name.
  assert.equal(gearFacts(createPart('steelAxle', 'axle', [0, 0, 0])), undefined);
});

test('a catalog row that declares the gear capability must author both defaults, agreeing with its primitive', () => {
  // The shipped catalog is the positive control; it is asserted at import time too.
  assertDimensionDefaults(CATALOG);
  const row = (parameterDefinitions, radius = 0.05) => ({
    rigged: {
      gear: { stiffness: 20000, damping: 20 },
      parameterDefinitions,
      primitives: [{ halfExtents: [0.01, radius, radius] }],
    },
  });
  const teeth = { type: 'integer', default: 12, minimum: 12, maximum: 36 },
    module = { type: 'number', default: 0.01, minimum: 0.005, maximum: 0.01 };
  // A gear row with no authored dimensions resolves nothing, so partPrimitives would throw a
  // TypeError inside the compiler; the catalog must refuse it by name instead.
  for (const parameterDefinitions of [{}, { teeth }, { module }, { teeth: {}, module }])
    assert.throws(
      () => assertDimensionDefaults(row(parameterDefinitions)),
      /rigged: a gear row must author default teeth and module/,
      JSON.stringify(Object.keys(parameterDefinitions)),
    );
  // And defaults that do not reproduce the canonical primitive are refused by name.
  assert.throws(
    () => assertDimensionDefaults(row({ teeth, module }, 0.06)),
    /rigged: default teeth and module disagree with its canonical primitive/,
  );
  // The plausible wrong trace: the agreeing row is admitted, so the two refusals above are the
  // missing defaults and the disagreement, not a rule that rejects every gear row.
  assertDimensionDefaults(row({ teeth, module }));
});

test('spur gear parameters are strict: unknown keys, out-of-range teeth and off-menu modules fail', () => {
  const bp = createEmptyBlueprint('gears', 'Gears');
  bp.parts.push(gear('a', [0, 0, 0]), gear('b', [0, 0, 0.18], { teeth: 24 }));
  assert.equal(validateBlueprint(bp).ok, true);
  for (const parameters of [
    { ratio: 99 },
    { teeth: 11 },
    { teeth: 37 },
    { teeth: 12.5 },
    { module: 0.0075 },
    { module: 0.02 },
  ]) {
    const bad = structuredClone(bp);
    Object.assign(bad.parts[0].parameters, parameters);
    assert.equal(
      validateBlueprint(bad).ok,
      false,
      `${JSON.stringify(parameters)} must be refused by the generated validator`,
    );
  }
  // The plausible wrong trace: the bounds themselves are admitted, so the refusals above are
  // the range and the menu, not a validator that rejects every authored gear.
  for (const parameters of [{ teeth: 12 }, { teeth: 36 }, { module: 0.005 }, { module: 0.01 }]) {
    const good = structuredClone(bp);
    Object.assign(good.parts[0].parameters, parameters);
    assert.equal(validateBlueprint(good).ok, true, JSON.stringify(parameters));
  }
});

test('the collider, mass and inertia follow the authored teeth as the square of the radius', () => {
  // Steel discs of face width 20 mm: 2 pi h r^2 rho with r = m z / 2 - m.
  const mass = (teeth, module = 0.01) => {
    const bp = createEmptyBlueprint('gears', 'Gears');
    bp.parts.push(gear('g', [0, 2, 0], { teeth, module }));
    const compiled = compileAssembly(bp, { ground: null, gravity: [0, 0, 0] });
    return compiled.configuration.bodies[0].mass;
  };
  const near = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) < 0.005, `${label}: ${actual} vs ${expected}`);
  near(mass(12), 1.233, '12T steel');
  near(mass(24), 5.968, '24T steel');
  near(mass(36), 14.254, '36T steel');
  // r^2 exactly: (0.11/0.05)^2 and (0.17/0.05)^2.
  near(mass(24) / mass(12), (0.11 / 0.05) ** 2, '24T against 12T');
  near(mass(36) / mass(12), (0.17 / 0.05) ** 2, '36T against 12T');
  // The wrong trace a missing partPrimitives branch would leave: every count the same mass.
  assert.notEqual(mass(24), mass(12));
});

test('gear edges do not snap or structurally connect unsupported parts', () => {
  const bp = createEmptyBlueprint('gears', 'Gears');
  bp.parts.push(gear('a', [0, 1, 0]), gear('b', [0, 1, 0.12]));
  const a = { part: 'a', port: 'mesh' },
    b = { part: 'b', port: 'mesh' };
  assert.deepEqual(snapConnection(bp, a, b), bp);
  bp.connections.push({ id: 'mesh', kind: 'gear', a, b });
  assert.deepEqual(mechanicalGroup(bp, 'a'), ['a']);
  assert.throws(() => compileAssembly(bp), /UNSUPPORTED_GEAR_TOPOLOGY/);
});

import { createGearLift } from '../src/model/fixtures/gear-lift.mjs';
import { compileGearMeshes } from '../src/model/gear-mesh.mjs';

test('ordinary supported gear lift compiles both ratios with canonical numeric descriptors', () => {
  for (const reduction of [true, false]) {
    const bp = createGearLift({ reduction });
    const { configuration: c, connections } = compileAssembly(bp);
    const g = c.joints.find((j) => j.kind === 'gear');
    assert.equal(g.radiusA, reduction ? 0.06 : 0.12);
    assert.equal(g.radiusB, reduction ? 0.12 : 0.06);
    // The positive control every existing number depends on: 12T and 24T still make a 180 mm
    // centre distance out of the two surface mounts the fixture already authored.
    const a = bp.parts[g.a],
      b = bp.parts[g.b];
    assert.ok(
      Math.abs(Math.hypot(...b.position.map((v, i) => v - a.position[i])) - 0.18) < 1e-12,
      'gear centres 180 mm apart',
    );
    assert.equal(connections.find((row) => row.id === 'gear-mesh').reasonCode, 'OK');
    assert.deepEqual(
      Object.keys(g).sort(),
      [
        'kind',
        'a',
        'b',
        'anchorA',
        'anchorB',
        'axisA',
        'axisB',
        'radiusA',
        'radiusB',
        'stiffness',
        'damping',
      ].sort(),
    );
    assert.ok(c.bodies.slice(0, bp.parts.length).every((body) => !body.fixed));
    const renamed = structuredClone(bp);
    renamed.parts.forEach((p) => (p.name = 'Ordinary mechanism'));
    assert.deepEqual(compileAssembly(renamed).configuration, c);
    const changed = structuredClone(bp);
    changed.parts.find((p) => p.id === 'output-gear').authoredMaterial.body = 'aluminium';
    assert.ok(compileAssembly(changed).configuration.bodies[g.b].mass < c.bodies[g.b].mass);
  }
});

test('the physics door carries radii, masses and half extents, never a tooth count', () => {
  // Two tooth counts on the same authored apparatus: 12/24 as shipped, and 18/18, which keeps
  // the tooth counts adding to 36 and therefore keeps the shaft spacing the fixture fixes.
  for (const counts of [
    [12, 24],
    [18, 18],
  ]) {
    const bp = createGearLift();
    bp.parts.find((p) => p.id === 'input-gear').parameters.teeth = counts[0];
    bp.parts.find((p) => p.id === 'output-gear').parameters.teeth = counts[1];
    const { configuration, connections } = compileAssembly(bp);
    assert.equal(connections.find((row) => row.id === 'gear-mesh').reasonCode, 'OK');
    const mesh = configuration.joints.find((j) => j.kind === 'gear');
    assert.equal(mesh.radiusA, (counts[0] * 0.01) / 2);
    assert.equal(mesh.radiusB, (counts[1] * 0.01) / 2);
    for (const body of configuration.bodies)
      assert.deepEqual(
        Object.keys(body).sort(),
        [
          'shape',
          'position',
          'rotation',
          'velocity',
          'mass',
          'halfExtents',
          'fixed',
          'friction',
          'restitution',
        ].sort(),
        `${counts.join('/')} body keys`,
      );
    const serialized = JSON.stringify(configuration);
    assert.ok(!serialized.includes('teeth'), `${counts.join('/')} configuration mentions teeth`);
    assert.ok(!serialized.includes('module'), `${counts.join('/')} configuration mentions module`);
  }
});

test('gear admission refuses axial, axis, carrier, rigid-join and cycle errors', () => {
  const bp = createGearLift(),
    all = compileAssembly(bp).configuration.joints,
    joints = all.filter((j) => j.kind !== 'gear');
  const g = all.find((j) => j.kind === 'gear');
  // An axial offset along the shared axis: no authored tooth count can produce it, so it stays
  // a refusal. Its sibling, the centre distance, is the diagnostic test below.
  const offset = structuredClone(bp);
  offset.parts[g.b].position = offset.parts[g.b].position.map((v, i) => v + [0.005, 0, 0][i]);
  assert.throws(() => compileGearMeshes(offset, joints), /GEAR_MISALIGNED/);
  const tilted = structuredClone(bp);
  tilted.parts[g.b].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  assert.throws(() => compileGearMeshes(tilted, joints), /GEAR_MISALIGNED/);
  assert.throws(
    () =>
      compileGearMeshes(
        bp,
        joints.filter((j) => j.kind !== 'revolute'),
      ),
    /UNSUPPORTED_GEAR_TOPOLOGY/,
  );
  assert.throws(
    () => compileGearMeshes(bp, [...joints, { kind: 'fixed', a: g.a, b: g.b }]),
    /UNSUPPORTED_GEAR_TOPOLOGY/,
  );
  const limited = joints.map((j) => (j.kind === 'revolute' ? { ...j, limits: [-1, 1] } : j));
  assert.throws(() => compileGearMeshes(bp, limited), /UNSUPPORTED_GEAR_TOPOLOGY/);
  assert.throws(
    () => compileGearMeshes(bp, [...joints, { kind: 'spring', a: g.a, b: 0 }]),
    /UNSUPPORTED_GEAR_TOPOLOGY/,
  );
  const cycle = structuredClone(bp);
  cycle.connections.push({ ...cycle.connections.at(-1), id: 'second-mesh' });
  assert.throws(() => compileGearMeshes(cycle, joints), /UNSUPPORTED_GEAR_TOPOLOGY/);
  const detached = joints.filter(
    (j) =>
      !(j.kind === 'fixed' && [j.a, j.b].includes(bp.parts.findIndex((p) => p.id === 'bearing'))),
  );
  assert.throws(() => compileGearMeshes(bp, detached), /UNSUPPORTED_GEAR_TOPOLOGY/);
  // A gear edge between parts that are not gears is invalid authoring, not a mismatch.
  const nonGear = structuredClone(bp);
  nonGear.connections.at(-1).b = { part: 'arm-axle', port: 'right' };
  assert.throws(() => compileGearMeshes(nonGear, joints), /UNSUPPORTED_GEAR_TOPOLOGY/);
  // Whether a mesh is admitted may not depend on the authored numbers: an unsupported pair is
  // refused whether or not its tooth sizes match and whether or not it is correctly spaced.
  for (const parameters of [{}, { module: 0.005 }, { teeth: 36 }]) {
    const unsupported = createEmptyBlueprint('mesh', 'Mesh');
    unsupported.parts.push(gear('a', [0, 1, 0]), gear('b', [0, 1, 0.12], parameters));
    unsupported.connections.push({
      id: 'mesh',
      kind: 'gear',
      a: { part: 'a', port: 'mesh' },
      b: { part: 'b', port: 'mesh' },
    });
    assert.throws(
      () => compileGearMeshes(unsupported, []),
      /UNSUPPORTED_GEAR_TOPOLOGY/,
      `unsupported rotors with ${JSON.stringify(parameters)} must still be refused`,
    );
  }
});

test('mis-spaced and mismatched gear meshes are per-edge diagnostics that emit no joint', () => {
  // A minimal authored apparatus: one carrier and two rotors, each on its own coaxial bearing,
  // so the centre distance is the only thing these cases vary.
  const apparatus = ({ separation = 0.12, teeth = [12, 12], modules = [0.01, 0.01] } = {}) => {
    const bp = createEmptyBlueprint('mesh', 'Mesh');
    bp.parts.push(
      createPart('chassis', 'carrier', [0, 1, 0]),
      gear('a', [0.5, 1, 0], { teeth: teeth[0], module: modules[0] }),
      gear('b', [0.5, 1, separation], { teeth: teeth[1], module: modules[1] }),
    );
    bp.connections.push({
      id: 'mesh',
      kind: 'gear',
      a: { part: 'a', port: 'mesh' },
      b: { part: 'b', port: 'mesh' },
    });
    const bearing = (node, offset) => ({
      kind: 'revolute',
      a: 0,
      b: node,
      anchorA: [0.5, 0, offset],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
    });
    return [bp, [bearing(1, 0), bearing(2, separation)]];
  };
  // Positive control: the derived spacing compiles one joint with the derived radii.
  const [good, supports] = apparatus();
  const ok = compileGearMeshes(good, supports);
  assert.equal(ok.joints.length, 1);
  assert.equal(ok.joints[0].radiusA, 0.06);
  assert.equal(ok.joints[0].radiusB, 0.06);
  assert.deepEqual(ok.diagnostics, [{ id: 'mesh', reasonCode: 'OK' }]);
  // A millimetre of slack is inside the authoring tolerance; five millimetres are not.
  for (const [error, reasonCode] of [
    [0.0009, 'OK'],
    [-0.0009, 'OK'],
    [0.005, 'GEAR_MISALIGNED'],
    [-0.005, 'GEAR_MISALIGNED'],
  ]) {
    const [bp, joints] = apparatus();
    bp.parts[2].position[2] += error;
    const { joints: emitted, diagnostics } = compileGearMeshes(bp, joints);
    assert.deepEqual(diagnostics, [{ id: 'mesh', reasonCode }], `${error} m of spacing error`);
    assert.equal(emitted.length, reasonCode === 'OK' ? 1 : 0);
  }
  // An authored tooth count that no longer fits the shaft spacing is the same diagnostic.
  const [grown, grownJoints] = apparatus({ teeth: [12, 24] });
  assert.deepEqual(compileGearMeshes(grown, grownJoints).diagnostics, [
    { id: 'mesh', reasonCode: 'GEAR_MISALIGNED' },
  ]);
  // Different tooth sizes: its own reason code, and no joint for that edge.
  const [mismatched, mismatchedJoints] = apparatus({ modules: [0.01, 0.005] });
  const { joints: emitted, diagnostics } = compileGearMeshes(mismatched, mismatchedJoints);
  assert.deepEqual(diagnostics, [{ id: 'mesh', reasonCode: 'GEAR_TOOTH_SIZE_MISMATCH' }]);
  assert.equal(emitted.length, 0, 'a mismatched pair transmits nothing');
});

test('a diagnosed mesh is stamped on its own connection row without disturbing the others', () => {
  const bp = createGearLift();
  bp.parts.find((p) => p.id === 'output-gear').parameters.module = 0.005;
  const compiled = compileAssembly(bp);
  assert.equal(
    compiled.connections.find((row) => row.id === 'gear-mesh').reasonCode,
    'GEAR_TOOTH_SIZE_MISMATCH',
  );
  assert.equal(
    compiled.configuration.joints.some((j) => j.kind === 'gear'),
    false,
    'a diagnosed mesh emits no joint',
  );
  // Authored order is preserved and every other row is untouched.
  assert.deepEqual(
    compiled.connections.map((row) => row.id),
    bp.connections.map((c) => c.id),
  );
  assert.deepEqual(
    compiled.connections.filter((row) => row.id !== 'gear-mesh').map((row) => row.reasonCode),
    compileAssembly(createGearLift())
      .connections.filter((row) => row.id !== 'gear-mesh')
      .map((row) => row.reasonCode),
  );
});

import { createWorkshop } from '../src/core/workshop.mjs';
import { assertEditRoundTrip, assertRejectedEditUnchanged } from './contracts/editing.mjs';

test('editing the teeth of a meshed pair is accepted and diagnosed, never refused', async () => {
  const bp = createGearLift();
  const workshop = await createWorkshop(bp);
  const row = () =>
    workshop
      .observe()
      .frames.at(-1)
      .metadata.connections.find((connection) => connection.id === 'gear-mesh');
  try {
    assert.equal(row().reasonCode, 'OK', 'the fixture starts meshed');
    const applied = await workshop.act({
      type: 'parameter',
      id: 'output-gear',
      key: 'teeth',
      value: 18,
    });
    assert.equal(applied.ok, true, applied.reasonCode);
    assert.equal(
      workshop
        .observe()
        .frames.at(-1)
        .metadata.blueprint.parts.find((p) => p.id === 'output-gear').parameters.teeth,
      18,
    );
    // 12 and 18 pitch radii no longer add to the 180 mm the shafts are fixed at, so the mesh is
    // diagnosed instead of refusing the edit.
    assert.equal(row().reasonCode, 'GEAR_MISALIGNED');
    // And the player repairs it by matching the counts, as an ordinary undoable edit.
    await assertEditRoundTrip(workshop, {
      type: 'parameter',
      id: 'input-gear',
      key: 'teeth',
      value: 18,
    });
    assert.equal(row().reasonCode, 'OK', '18 and 18 still add to 36');
    // The plausible wrong trace: an out-of-range count is still refused atomically.
    await assertRejectedEditUnchanged(workshop, {
      type: 'parameter',
      id: 'input-gear',
      key: 'teeth',
      value: 99,
    });
    // And a count that would grow the disc into a neighbour is refused by placement, not drawn
    // through it: the model owns that refusal, not the inspector.
    const grown = await workshop.act({
      type: 'parameter',
      id: 'output-gear',
      key: 'teeth',
      value: 36,
    });
    assert.equal(grown.ok, false);
    assert.equal(grown.reasonCode, 'SURFACE_OVERLAP');
  } finally {
    workshop.dispose();
  }
});

test('gear connect/disconnect use ordinary undo save/load and atomic rejected edits without snapping', async () => {
  const bp = createGearLift();
  const mesh = bp.connections.pop();
  const workshop = await createWorkshop(bp);
  try {
    const command = { type: 'connect', id: mesh.id, a: mesh.a, b: mesh.b };
    await assertRejectedEditUnchanged(workshop, { ...command, b: { part: 'base', port: 'mesh' } });
    await assertEditRoundTrip(workshop, command);
    assert.deepEqual(
      workshop.observe().frames[0].metadata.blueprint.parts,
      bp.parts,
      'mesh preserves authored transforms and materials',
    );
    await assertRejectedEditUnchanged(workshop, { ...command, id: 'redundant-mesh' });
    await assertRejectedEditUnchanged(workshop, {
      type: 'disconnect',
      id: 'bearing-shaft',
    });
    await assertEditRoundTrip(workshop, { type: 'disconnect', id: mesh.id });
  } finally {
    workshop.dispose();
  }
});

test('authored teeth and module survive save, load, compile and re-save', () => {
  const bp = createEmptyBlueprint('gears', 'Gears');
  bp.parts.push(gear('g', [0, 2, 0], { teeth: 30, module: 0.005 }));
  const loaded = loadSave(JSON.stringify(bp));
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.blueprint.parts[0].parameters, { teeth: 30, module: 0.005 });
  const compiled = compileAssembly(loaded.blueprint, { ground: null, gravity: [0, 0, 0] });
  const radius = ((30 - 2) * 0.005) / 2;
  assert.deepEqual(compiled.configuration.bodies[0].halfExtents, [0.01, radius, radius]);
  const resaved = loadSave(JSON.stringify(loaded.blueprint));
  assert.deepEqual(resaved.blueprint, loaded.blueprint);
  // A save from before the gear became parametric is refused by version, not by part type.
  assert.equal(
    loadSave({ ...structuredClone(bp), version: CURRENT_SAVE_VERSION - 1 }).reasonCode,
    'SAVE_VERSION_UNSUPPORTED_OLD',
  );
});

test('gear identity is not physics: renaming holds the compiled body, editing teeth does not', () => {
  const identifiers = fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/);
  fc.assert(
    fc.property(
      identifiers,
      identifiers,
      fc.integer({ min: 12, max: 36 }),
      fc.constantFrom('steel', 'aluminium'),
      (blueprintId, name, teeth, material) => {
        const build = (id, partName, count) => {
          const bp = createEmptyBlueprint(id, 'Gears');
          const part = gear('g', [0, 2, 0], { teeth: count });
          part.name = partName;
          part.authoredMaterial.body = material;
          bp.parts.push(part);
          return compileAssembly(bp, { ground: null, gravity: [0, 0, 0] }).configuration;
        };
        const canonical = build('gears', 'Spur gear', teeth);
        // Identity perturbed, authored physical choices held: the body is byte-identical.
        assert.deepEqual(build(blueprintId, name, teeth), canonical);
        // And the wrong trace: perturbing the authored tooth count must change the body.
        const other = teeth === 36 ? 12 : teeth + 1;
        assert.notEqual(
          build('gears', 'Spur gear', other).bodies[0].mass,
          canonical.bodies[0].mass,
        );
      },
    ),
    { seed: 19471, numRuns: 50 },
  );
});

test('gear lift separates the arm plane from the gear faces with an ordinary axle', () => {
  const bp = createGearLift();
  const arm = bp.parts.find((p) => p.id === 'arm');
  const gearPart = bp.parts.find((p) => p.id === 'output-gear');
  assert.ok(arm.position[0] - gearPart.position[0] > 0.18);
  assert.equal(bp.parts.find((p) => p.id === 'arm-axle').type, 'steelAxle');
  compileAssembly(bp);
});

test('a mis-spaced mesh names the one mount that can restore its centre distance', () => {
  // 12 and 26 pitch radii add to 190 mm; the shafts are bolted 180 mm apart, so the mesh is
  // diagnosed. The repair is a mount offset, not a gear pose: an admitted mesh needs one shared
  // rigid carrier, so both gears always sit in one mechanical group and moving either of them
  // moves the other with it.
  const bp = createGearLift();
  bp.parts.find((p) => p.id === 'output-gear').parameters.teeth = 26;
  assert.ok(
    mechanicalGroup(bp, 'input-gear').includes('output-gear'),
    'a supported pair is one mechanical group, which is why no transform can space it',
  );
  assert.equal(
    compileAssembly(bp).connections.find((row) => row.id === 'gear-mesh').reasonCode,
    'GEAR_MISALIGNED',
  );
  const repair = meshSpacingRepair(bp, 'gear-mesh');
  assert.equal(repair.moving, 'output-gear', 'the driven shaft is the datum the player built');
  assert.equal(repair.connection, 'mount-bearing-spacer');
  assert.equal(repair.part, 'bearing-spacer');
  assert.equal(repair.targetPart, 'carrier');
  assert.equal(repair.targetRegion, 'bottom');
  assert.ok(Math.abs(repair.centreDistance - 0.19) < 1e-12);
  // The mount slides 10 mm further along the axis the two shafts are separated on, and on no other.
  assert.ok(Math.abs(repair.v - 0.1) < 1e-12, `v = ${repair.v}`);
  assert.equal(repair.u, 0);
  assert.equal(repair.twist, 0);
  // Applying it restores the mesh, and the positive control is that nothing else was needed.
  const spaced = proposeSurfaceMount(bp, {
    ...repair,
    id: repair.connection,
    replaceConnection: repair.connection,
  }).blueprint;
  assert.equal(
    compileAssembly(spaced).connections.find((row) => row.id === 'gear-mesh').reasonCode,
    'OK',
  );
  // A repair that would drive the moved side into another part is refused by the same surface
  // admission every mount edit passes through, not by a special case for gears.
  const tight = createGearLift();
  tight.parts.find((p) => p.id === 'output-gear').parameters.teeth = 18;
  const closer = meshSpacingRepair(tight, 'gear-mesh');
  assert.ok(Math.abs(closer.v - 0.06) < 1e-12);
  assert.throws(
    () =>
      proposeSurfaceMount(tight, {
        ...closer,
        id: closer.connection,
        replaceConnection: closer.connection,
      }),
    (error) => error.reasonCode === 'SURFACE_OVERLAP' && error.obstructingPartId === 'motor',
  );
  // Wrong traces: an already meshed pair has nothing to repair, and a tooth-size mismatch is a
  // different diagnosis that spacing cannot fix.
  assert.equal(meshSpacingRepair(createGearLift(), 'gear-mesh'), undefined);
  const mismatched = createGearLift();
  mismatched.parts.find((p) => p.id === 'output-gear').parameters.module = 0.005;
  assert.equal(meshSpacingRepair(mismatched, 'gear-mesh'), undefined);
  assert.equal(meshSpacingRepair(bp, 'power'), undefined, 'only a gear edge has a centre distance');
});

test('mesh spacing repair is offered only where a mount can express it, and never from identity', () => {
  // No surface mount separates these rotors, so nothing is offered rather than a command that
  // would move both gears together and leave the same diagnosis.
  const bare = createEmptyBlueprint('mesh', 'Mesh');
  bare.parts.push(gear('a', [0, 1, 0]), gear('b', [0, 1, 0.2], { teeth: 24 }));
  bare.connections.push({
    id: 'mesh',
    kind: 'gear',
    a: { part: 'a', port: 'mesh' },
    b: { part: 'b', port: 'mesh' },
  });
  assert.equal(meshSpacingRepair(bare, 'mesh'), undefined);
  // Identity may not choose the moving side: renaming every part and the blueprint leaves the
  // same mount, the same offset and the same moving gear.
  const renamed = createGearLift();
  renamed.parts.find((p) => p.id === 'output-gear').parameters.teeth = 26;
  renamed.id = 'renamed';
  for (const part of renamed.parts) part.name = `X-${part.name}`;
  const plain = createGearLift();
  plain.parts.find((p) => p.id === 'output-gear').parameters.teeth = 26;
  assert.deepEqual(meshSpacingRepair(renamed, 'gear-mesh'), meshSpacingRepair(plain, 'gear-mesh'));
  // And the wrong trace: the repair follows the authored teeth, not the mount it happens to find.
  const coarser = createGearLift();
  coarser.parts.find((p) => p.id === 'output-gear').parameters.teeth = 28;
  assert.ok(Math.abs(meshSpacingRepair(coarser, 'gear-mesh').centreDistance - 0.2) < 1e-12);
});
