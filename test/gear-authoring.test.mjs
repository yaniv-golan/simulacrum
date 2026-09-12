import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../src/model/catalog.mjs';
import { createEmptyBlueprint, createPart, validateBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import { mechanicalGroup } from '../src/model/connection-graph.mjs';

test('spur gears have fixed physical dimensions and strict authored parameters', () => {
  assert.equal(CATALOG.gear12.gear.teeth, 12);
  assert.equal(CATALOG.gear24.gear.pitchRadius, 0.12);
  const bp = createEmptyBlueprint('gears', 'Gears');
  bp.parts.push(createPart('gear12', 'a', [0, 0, 0]), createPart('gear24', 'b', [0, 0, 0.18]));
  assert.equal(validateBlueprint(bp).ok, true);
  bp.parts[0].parameters.ratio = 99;
  assert.equal(validateBlueprint(bp).ok, false);
});
test('gear edges do not snap or structurally connect unsupported parts', () => {
  const bp = createEmptyBlueprint('gears', 'Gears');
  bp.parts.push(createPart('gear12', 'a', [0, 1, 0]), createPart('gear24', 'b', [0, 1, 0.18]));
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
    const { configuration: c } = compileAssembly(bp);
    const g = c.joints.find((j) => j.kind === 'gear');
    assert.equal(g.radiusA, reduction ? 0.06 : 0.12);
    assert.equal(g.radiusB, reduction ? 0.12 : 0.06);
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
    assert.ok(c.bodies.slice(0, bp.parts.length).every((b) => !b.fixed));
    const renamed = structuredClone(bp);
    renamed.parts.forEach((p) => (p.name = 'Ordinary mechanism'));
    assert.deepEqual(compileAssembly(renamed).configuration, c);
    const changed = structuredClone(bp);
    changed.parts.find((p) => p.id === 'output-gear').authoredMaterial.body = 'aluminium';
    assert.ok(compileAssembly(changed).configuration.bodies[g.b].mass < c.bodies[g.b].mass);
  }
});
test('gear admission rejects spacing, axial and axis errors, missing carriers, rigid joins and cycles', () => {
  const bp = createGearLift(),
    all = compileAssembly(bp).configuration.joints,
    joints = all.filter((j) => j.kind !== 'gear');
  const g = all.find((j) => j.kind === 'gear');
  for (const delta of [
    [0.005, 0, 0],
    [0, 0, 0.01],
  ]) {
    const bad = structuredClone(bp);
    bad.parts[g.b].position = bad.parts[g.b].position.map((v, i) => v + delta[i]);
    assert.throws(() => compileGearMeshes(bad, joints), /MISALIGNED/);
  }
  const tilted = structuredClone(bp);
  tilted.parts[g.b].rotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  assert.throws(() => compileGearMeshes(tilted, joints), /MISALIGNED/);
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
});

import { createWorkshop } from '../src/core/workshop.mjs';
import { assertEditRoundTrip, assertRejectedEditUnchanged } from './contracts/editing.mjs';

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

test('gear lift separates the arm plane from the gear faces with an ordinary axle', () => {
  const bp = createGearLift();
  const arm = bp.parts.find((p) => p.id === 'arm');
  const gear = bp.parts.find((p) => p.id === 'output-gear');
  assert.ok(arm.position[0] - gear.position[0] > 0.18);
  assert.equal(bp.parts.find((p) => p.id === 'arm-axle').type, 'steelAxle');
  compileAssembly(bp);
});
