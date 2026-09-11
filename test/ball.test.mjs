import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileBody } from '../src/model/compile-body.mjs';
import { partPrimitives } from '../src/model/geometry.mjs';
import { solidsOverlap, surfaceRegions } from '../src/model/surfaces.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';

test('solid ball radius, volume and native inertia follow authored size/material', async () => {
  const ball = createPart('ball', 'ball', [0, 1, 0]);
  assert.deepEqual(surfaceRegions(ball), []);
  ball.parameters.diameter = 0.2;
  ball.authoredMaterial.body = 'steel';
  assert.deepEqual(partPrimitives(ball)[0].halfExtents, [0.1, 0.1, 0.1]);
  const body = compileBody(ball),
    mass = (7850 * 4 * Math.PI * 0.1 ** 3) / 3;
  assert.ok(Math.abs(body.mass - mass) < 1e-10);
  const world = await createPhysicsWorld({ gravity: [0, 0, 0], bodies: [body], joints: [] });
  try {
    for (const axis of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])
      assert.ok(
        Math.abs(world.getAxisInverseInertia(0, axis) - 1 / (0.4 * mass * 0.1 ** 2)) < 1e-8,
      );
  } finally {
    world.dispose();
  }
});

test('sphere placement uses curved surface, including rotated boxes and cylinder hulls', () => {
  const ball = createPart('ball', 'b', [0, 1, 0]);
  const other = createPart('ball', 'c', [0.1, 1, 0]);
  assert.equal(solidsOverlap(ball, other), false);
  other.position[0] -= 0.001;
  assert.equal(solidsOverlap(ball, other), true);
  const box = {
    position: [0.06, 1.06, 0],
    rotation: [0, 0, 0, 1],
    envelopeHalf: [0.02, 0.02, 0.02],
  };
  assert.equal(solidsOverlap(ball, box), false); // overlapping bounds, empty sphere corner
  box.position = [0.04, 1.04, 0];
  assert.equal(solidsOverlap(ball, box), true);
  const wheel = createPart('gripWheel', 'w', [0, 1, 0]);
  ball.position = [0, 1.15, 0];
  assert.equal(solidsOverlap(ball, wheel), false);
  ball.position[1] -= 0.001;
  assert.equal(solidsOverlap(ball, wheel), true);
  const { sin, cos, PI } = Math;
  const q = [0, 0, sin(PI / 8), cos(PI / 8)],
    c = Math.SQRT1_2;
  const turnedBox = { position: [0, 1, 0], rotation: q, envelopeHalf: [0.02, 0.02, 0.02] };
  ball.position = [0.07 * c, 1 + 0.07 * c, 0];
  assert.equal(solidsOverlap(ball, turnedBox), false, 'rotated face tangency');
  ball.position = [0.069 * c, 1 + 0.069 * c, 0];
  assert.equal(solidsOverlap(ball, turnedBox), true, 'rotated face penetration');
  ball.position = [0, 1.149, 0];
  ball.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  assert.equal(solidsOverlap(ball, wheel), true);
});

test('ball resize is atomic, undo and save/load retain authored size', async () => {
  const w = await createWorkshop();
  try {
    assert.equal(
      (await w.act({ type: 'place', partType: 'ball', id: 'b', position: [0, 1, 0] })).ok,
      true,
    );
    const before = w.observe().frames[0].metadata.blueprint;
    assert.equal(
      (await w.act({ type: 'parameter', id: 'b', key: 'diameter', value: 0.2 })).ok,
      true,
    );
    const saved = JSON.stringify(w.observe().frames[0].metadata.blueprint);
    await w.act({ type: 'undo' });
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, before);
    assert.equal((await w.act({ type: 'load', save: saved })).ok, true);
    assert.equal(
      (await w.act({ type: 'parameter', id: 'b', key: 'diameter', value: 0 })).ok,
      false,
    );
  } finally {
    w.dispose();
  }
});

test('launcher supplies an ordinary loose ball, not a wheel projectile', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const bp = createSpringLauncher();
  assert.equal(bp.parts.find((p) => p.id === 'projectile').type, 'ball');
  assert.ok(!bp.connections.some((c) => [c.a.part, c.b.part].includes('projectile')));
});

test('contact overrides inherit, preserve custom zero, reset and survive copy/load on any part', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'beam', id: 'beam', position: [0, 1, 0] });
    const change = (property, value) =>
      w.act({ type: 'contactProperty', id: 'beam', primitive: 'body', property, value });
    assert.equal((await change('restitution', 0)).ok, true);
    await w.act({ type: 'material', id: 'beam', primitive: 'body', material: 'rubber' });
    let bp = w.observe().frames[0].metadata.blueprint;
    assert.equal(compileBody(bp.parts[0]).restitution, 0);
    assert.equal(compileBody(bp.parts[0]).friction, 0.9);
    const { captureAssembly, insertAssembly } = await import(
      '../src/model/reusable-assemblies.mjs'
    );
    const { proposeMirroredAssembly } = await import('../src/model/mirror-assembly.mjs');
    const source = structuredClone(bp);
    source.parts.push(createPart('chassis', 'reference', [-2, 1, 0]));
    const mirrored = proposeMirroredAssembly(source, {
      ids: ['beam'],
      referenceId: 'reference',
      axis: 'x',
    });
    assert.deepEqual(mirrored.blueprint.parts.at(-1).authoredContact, { body: { restitution: 0 } });
    const { definition } = captureAssembly(bp, { name: 'Loose beam', ids: ['beam'], ports: [] });
    const inserted = insertAssembly(bp, definition, [3, 1, 0], [0, 0, 0, 1]);
    assert.deepEqual(inserted.blueprint.parts.at(-1).authoredContact, { body: { restitution: 0 } });
    inserted.blueprint.parts.at(-1).authoredContact.body.restitution = 0.8;
    assert.equal(definition.parts[0].authoredContact.body.restitution, 0);
    const saved = JSON.stringify(bp);
    assert.equal((await change('restitution', null)).ok, true);
    assert.equal(compileBody(w.observe().frames[0].metadata.blueprint.parts[0]).restitution, 0.2);
    assert.equal((await w.act({ type: 'load', save: saved })).ok, true);
    for (const [property, value] of [
      ['restitution', 1.1],
      ['friction', -1],
      ['unknown', 0],
      ['friction', Infinity],
    ])
      assert.equal((await change(property, value)).ok, false);
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, bp);
    const copy = structuredClone(bp.parts[0]);
    copy.id = 'copy';
    copy.position = [1, 1, 0];
    assert.equal((await w.act({ type: 'insert', part: copy })).ok, true);
    copy.authoredContact.body.restitution = 0.7;
    assert.equal(
      w.observe().frames[0].metadata.blueprint.parts.find((p) => p.id === 'copy').authoredContact
        .body.restitution,
      0,
    );
    await w.act({ type: 'undo' });
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, bp);
    await w.act({ type: 'redo' });
    assert.equal(w.observe().frames[0].metadata.blueprint.parts.length, 2);
  } finally {
    w.dispose();
  }
});

test('empty contact overrides canonicalize on load and ordinary insertion', async () => {
  const { loadSave } = await import('../src/model/blueprint.mjs');
  const bp = createEmptyBlueprint('empty-contact', 'Empty contact');
  const ball = createPart('ball', 'ball', [0, 1, 0]);
  ball.authoredContact = { body: {} };
  bp.parts.push(ball);
  const loaded = loadSave(bp);
  assert.equal(loaded.ok, true);
  assert.equal('authoredContact' in loaded.blueprint.parts[0], false);
  assert.deepEqual(ball.authoredContact, { body: {} }, 'input stays untouched');
  ball.authoredContact.body.restitution = 0;
  assert.deepEqual(loadSave(bp).blueprint.parts[0].authoredContact, { body: { restitution: 0 } });
  const w = await createWorkshop();
  try {
    ball.authoredContact = {};
    assert.equal((await w.act({ type: 'insert', part: ball })).ok, true);
    assert.equal('authoredContact' in w.save().parts[0], false);
  } finally {
    w.dispose();
  }
});
