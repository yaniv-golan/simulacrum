import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpringLauncher } from '../src/model/fixtures/spring-launcher.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { rotateVector } from '../src/model/transforms.mjs';

test('powered contact gate holds and releases separate spring projectile with powerless and jam controls', async () => {
  for (const variant of ['release', 'hold', 'no-spring', 'no-power', 'jam']) {
    let bp = createSpringLauncher();
    if (variant === 'jam') {
      const bar = createPart('beam', 'jam-bar', [100, 2, 0]);
      bar.authoredMaterial.body = 'rubber';
      bp.parts.push(bar);
      const a = { part: 'crossbar-end', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } };
      const b = { part: 'jam-bar', surface: { region: 'left', u: 0, v: 0, twist: 0 } };
      bp = snapConnection(bp, a, b);
      bp.connections.push({ id: 'jam-bracket', kind: 'fixed', a, b });
    }
    if (variant === 'no-spring') bp.parts.find((p) => p.id === 'guide').parameters.stiffness = 0;
    if (variant === 'no-power') bp.connections = bp.connections.filter((c) => c.kind !== 'power');
    assert.ok(!bp.connections.some((c) => [c.a.part, c.b.part].includes('projectile')));
    const compiled = compileAssembly(bp);
    assert.ok(compiled.connections.every((c) => c.reasonCode === 'OK'));
    const s = await createSession(compiled.configuration);
    const projectile = bp.parts.findIndex((p) => p.id === 'projectile');
    const receiver = bp.parts.findIndex((p) => p.id === 'release');
    const carriage = bp.parts.findIndex((p) => p.id === 'carriage'),
      base = bp.parts.findIndex((p) => p.id === 'base');
    const pushers = new Set([carriage]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const joint of compiled.configuration.joints)
        if (joint.kind !== 'spring' && (pushers.has(joint.a) || pushers.has(joint.b)))
          for (const body of [joint.a, joint.b])
            if (!pushers.has(body)) {
              pushers.add(body);
              changed = true;
            }
    }
    let transferImpulse = 0,
      relativeMin = Infinity,
      launchSpeed = 0;
    let heldMin = Infinity,
      heldMax = -Infinity,
      releasedMin = Infinity,
      before,
      jamImpulse = 0,
      commandedCurrent = 0;
    try {
      for (let t = 0; t < 600; t++) {
        if (t === 240) {
          before = s.observe().frames[0];
          s.act({
            type: 'receiver',
            node: receiver,
            duty: variant === 'hold' ? 0 : 1,
          });
        }
        s.step();
        const f = s.observe().frames[0],
          x = f.physics[projectile].position[0];
        assert.equal(f.status, 'ready');
        assert.equal(f.contacts.available, true);
        assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-5);
        if (t < 240) {
          heldMin = Math.min(heldMin, x);
          heldMax = Math.max(heldMax, x);
        } else {
          commandedCurrent = Math.max(commandedCurrent, Math.abs(f.power.motors[0].current));
          if (variant === 'jam') {
            const bar = bp.parts.findIndex((p) => p.id === 'jam-bar');
            const drop = bp.parts.findIndex((p) => p.id === 'gate-drop');
            for (const contact of f.contacts.rows)
              if ([contact.a, contact.b].includes(bar) && [contact.a, contact.b].includes(drop))
                jamImpulse += Math.hypot(...contact.normalImpulse);
          }
          releasedMin = Math.min(releasedMin, x);
          relativeMin = Math.min(relativeMin, x - f.physics[base].position[0]);
          launchSpeed = Math.max(
            launchSpeed,
            f.physics[base].velocity[0] - f.physics[projectile].velocity[0],
          );
          for (const contact of f.contacts.rows)
            if (
              [contact.a, contact.b].includes(projectile) &&
              (pushers.has(contact.a) || pushers.has(contact.b)) &&
              contact.normalImpulse
            ) {
              const impulse = Math.abs(contact.normalImpulse[0]);
              transferImpulse += impulse;
              if (variant === 'release' && t >= 540)
                assert.ok(impulse < 1e-8, 'released projectile separates from carriage');
            }
        }
      }
      const f = s.observe().frames[0],
        distance = before.physics[projectile].position[0] - releasedMin;
      if (variant === 'no-power') {
        assert.equal(commandedCurrent, 0, 'a disconnected cell cannot fund gate actuation');
        assert.equal(f.power.motors[0].shaftWorkJ, 0);
      } else {
        assert.ok(
          heldMax - heldMin < 0.01,
          'retention motion stays below one quarter of gate thickness',
        );
        if (variant === 'release') {
          assert.ok(distance > 0.4, 'projectile clears the entire launcher bed');
          assert.ok(
            before.physics[projectile].position[0] -
              before.physics[base].position[0] -
              relativeMin >
              0.4,
            'projectile clears relative to the launcher, not only world coordinates',
          );
          assert.ok(transferImpulse > 0, 'post-release carriage contact transfers axial impulse');
          assert.ok(launchSpeed > 0, 'projectile gains outward velocity relative to its launcher');
          assert.ok(
            before.energy.springPotentialJ - f.energy.springPotentialJ > 1,
            'release spends stored elastic energy',
          );
        } else assert.ok(distance < 0.02, `${variant} is not a launch`);
        if (variant === 'jam') {
          assert.ok(jamImpulse > 0, 'ordinary blocker physically opposes the commanded gate');
          assert.ok(commandedCurrent > 0, 'jammed actuator is actually powered');
        }
      }
    } finally {
      s.dispose();
    }
  }
});

test('launcher preload is reconstructible through ordinary Build commands and Undo', async () => {
  const bp = createSpringLauncher(),
    w = await createWorkshop(createEmptyBlueprint('empty', 'Empty'));
  const configuration = compileAssembly(bp).configuration;
  const spring = configuration.joints.find((joint) => joint.kind === 'spring');
  const point = (body, anchor) =>
    rotateVector(body.rotation, anchor).map((v, i) => v + body.position[i]);
  const a = configuration.bodies[spring.a],
    b = configuration.bodies[spring.b];
  const pointA = point(a, spring.anchorA),
    pointB = point(b, spring.anchorB);
  const initialLength = rotateVector(a.rotation, spring.axisA).reduce(
    (sum, v, i) => sum + v * (pointB[i] - pointA[i]),
    0,
  );
  const storedEnergy = 0.5 * spring.stiffness * (spring.restLength - initialLength) ** 2;
  assert.ok(storedEnergy > 1, 'an authored compressed spring stores useful energy before Run');
  try {
    for (const original of bp.parts) {
      const part = structuredClone(original);
      if (part.id === 'guide') part.parameters.restLength = initialLength;
      assert.equal((await w.act({ type: 'insert', part })).ok, true, part.id);
    }
    for (const c of bp.connections)
      assert.equal((await w.act({ type: 'connect', id: c.id, a: c.a, b: c.b })).ok, true, c.id);
    assert.equal(
      (await w.act({ type: 'parameter', id: 'guide', key: 'restLength', value: spring.restLength }))
        .ok,
      true,
    );
    assert.ok(Math.abs(w.observe().frames[0].energy.springPotentialJ - storedEnergy) < 1e-9);
    await w.act({ type: 'undo' });
    assert.ok(w.observe().frames[0].energy.springPotentialJ < 1e-15);
    await w.act({ type: 'redo' });
    assert.ok(Math.abs(w.observe().frames[0].energy.springPotentialJ - storedEnergy) < 1e-9);
  } finally {
    w.dispose();
  }
});

test('passive pin mating admits axial articulation while rejecting tilt and rigid-shaft twist', () => {
  for (const type of ['passiveBearing', 'steelAxle']) {
    let bp = createEmptyBlueprint('pin', 'Pin');
    bp.parts = [createPart(type, 'pin', [0, 2, 0]), createPart('shaftMount', 'adapter', [1, 2, 0])];
    const a = { part: 'pin', port: type === 'passiveBearing' ? 'shaft' : 'right' };
    const b = { part: 'adapter', port: 'shaft' };
    bp = snapConnection(bp, a, b);
    bp.connections.push({ id: 'pin-joint', kind: 'shaft', a, b });
    bp.parts[1].rotation = [Math.sin(0.2), 0, 0, Math.cos(0.2)];
    assert.equal(
      compileAssembly(bp).connections[0].reasonCode,
      type === 'passiveBearing' ? 'OK' : 'MISALIGNED',
    );
    bp.parts[1].rotation = [0, Math.sin(0.02), 0, Math.cos(0.02)];
    assert.throws(() => compileAssembly(bp), /SURFACE_OVERLAP/);
  }
});
