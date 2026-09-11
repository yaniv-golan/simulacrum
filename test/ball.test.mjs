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

test('default ball launcher enters and remains in its ordinary catcher for two seconds', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  const bp = createSpringLauncher(),
    cfg = compileAssembly(bp).configuration;
  const session = await createSession(cfg),
    i = bp.parts.findIndex((p) => p.id === 'projectile');
  const receiver = bp.parts.findIndex((p) => p.id === 'release');
  let contact = false,
    retained = 0;
  try {
    for (let tick = 1; tick <= 840; tick++) {
      if (tick === 241) session.act({ type: 'receiver', node: receiver, duty: 1 });
      session.step();
      const f = session.observe().frames[0],
        p = f.physics[i].position;
      contact ||= f.contacts.rows.some(
        (c) =>
          c.available &&
          c.solved &&
          [c.a, c.b].includes(i) &&
          [c.a, c.b].some((n) => bp.parts[n]?.id.startsWith('catcher-')),
      );
      if (contact && p[0] > -1.85 && p[0] < -1.34 && p[2] > -0.31 && p[2] < 0.21 && p[1] < 0.22)
        retained++;
      else retained = 0;
      if (retained >= 240) break;
    }
    assert.equal(contact, true);
    assert.ok(retained >= 240, 'retention is consecutive completed ticks, not passing the opening');
  } finally {
    session.dispose();
  }
});

test('ball launch energy exceeds all accounted non-spring sources without creating energy', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { launchTrial, assertReleaseEnergy } = await import('./contracts/launcher-energy.mjs');
  const trial = await launchTrial(createSpringLauncher());
  assertReleaseEnergy(trial);
  assert.ok(trial.transfer > 0);
  // Energy is measured at one second. The heavier sphere stays on the pusher longer;
  // independently require separation within the existing journey's 2.5-second bound.
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  const bp = createSpringLauncher(),
    session = await createSession(compileAssembly(bp).configuration);
  const ball = bp.parts.findIndex((p) => p.id === 'projectile'),
    pusher = bp.parts.findIndex((p) => p.id === 'pusher-roller'),
    receiver = bp.parts.findIndex((p) => p.id === 'release');
  try {
    for (let tick = 1; tick <= 570; tick++) {
      if (tick === 241) session.act({ type: 'receiver', node: receiver, duty: 1 });
      session.step();
      if (tick >= 540) {
        const f = session.observe().frames[0];
        assert.ok(f.physics[pusher].position[0] - f.physics[ball].position[0] > 0.15);
        assert.ok(
          !f.contacts.rows.some(
            (c) =>
              c.available &&
              c.solved &&
              [c.a, c.b].includes(ball) &&
              [c.a, c.b].includes(pusher) &&
              Math.hypot(...c.normalImpulse) > 1e-8,
          ),
        );
      }
    }
  } finally {
    session.dispose();
  }
  assert.throws(() => assertReleaseEnergy({ ...trial, alternative: trial.gain }), /alternative/);
});

test('ball side guides retain a held projectile; removing them permits sideways escape', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  for (const guided of [true, false]) {
    const bp = createSpringLauncher();
    if (!guided) {
      bp.parts = bp.parts.filter((p) => !p.id.startsWith('ball-guide-'));
      bp.connections = bp.connections.filter(
        (c) => !c.a.part.startsWith('ball-guide-') && !c.b.part.startsWith('ball-guide-'),
      );
    }
    const s = await createSession(compileAssembly(bp).configuration),
      i = bp.parts.findIndex((p) => p.id === 'projectile'),
      base = bp.parts.findIndex((p) => p.id === 'base');
    const start = bp.parts[i].position[0] - bp.parts[base].position[0];
    let escaped = false;
    try {
      for (let tick = 1; tick <= 2400; tick++) {
        s.step();
        const f = s.observe().frames[0];
        escaped ||= Math.abs(f.physics[i].position[0] - f.physics[base].position[0] - start) > 0.02;
        if (escaped) break;
      }
      assert.equal(escaped, !guided, 'twenty-second hold needs actual lateral support');
    } finally {
      s.dispose();
    }
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

test('an ordinary preload edit repairs a real shortfall after moving the catcher farther', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  for (const [restLength, expectCatch] of [
    [0.25, false],
    [0.3, true],
  ]) {
    const bp = createSpringLauncher();
    for (const part of bp.parts) if (part.id.startsWith('catcher-')) part.position[0] -= 0.1;
    bp.parts.find((p) => p.id === 'guide').parameters.restLength = restLength;
    const s = await createSession(compileAssembly(bp).configuration),
      ball = bp.parts.findIndex((p) => p.id === 'projectile'),
      receiver = bp.parts.findIndex((p) => p.id === 'release');
    let contact = false,
      retained = 0,
      caught = false;
    try {
      for (let tick = 1; tick <= 1440; tick++) {
        if (tick === 241) s.act({ type: 'receiver', node: receiver, duty: 1 });
        s.step();
        const f = s.observe().frames[0],
          p = f.physics[ball].position;
        contact ||= f.contacts.rows.some(
          (c) =>
            c.available &&
            c.solved &&
            Math.hypot(...c.normalImpulse) > 1e-8 &&
            [c.a, c.b].includes(ball) &&
            [c.a, c.b].some((n) => bp.parts[n]?.id.startsWith('catcher-')),
        );
        if (contact && p[0] > -1.95 && p[0] < -1.44 && p[2] > -0.31 && p[2] < 0.21 && p[1] < 0.22)
          retained++;
        else retained = 0;
        caught ||= retained >= 240;
      }
      assert.equal(caught, expectCatch, 'same farther catcher; only authored restLength changes');
    } finally {
      s.dispose();
    }
  }
});
