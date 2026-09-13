import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { rotateVector } from '../src/model/transforms.mjs';

const DT = 1 / 120;
const Q = [0, 0, 0, 1];
// Independent volume-times-density oracle for the planned aluminium cell body.
const CELL_MASS = 0.12 * 0.04 * 0.04 * 2700;
const box = (position, mass = 1, fixed = false, halfExtents = [0.1, 0.1, 0.1]) => ({
  shape: 'box',
  position,
  mass,
  fixed,
  halfExtents,
  rotation: [...Q],
  velocity: [0, 0, 0],
  friction: 0,
  restitution: 0,
});
const fixed = (a, b, anchorA, anchorB) => ({
  kind: 'fixed',
  a,
  b,
  anchorA,
  anchorB,
  rotationA: [...Q],
  rotationB: [...Q],
});
function fixture(mass = 1, gravity = 9.81, reverseSupport = false) {
  return {
    gravity: [reverseSupport ? -gravity : gravity, 0, 0],
    bodies: [
      box([-0.16, 3, 0], mass, !reverseSupport),
      box([0, 3, 0], CELL_MASS, false, [0.06, 0.02, 0.02]),
      box([0.16, 3, 0], mass, reverseSupport),
    ],
    joints: [fixed(0, 1, [0.1, 0, 0], [-0.06, 0, 0]), fixed(1, 2, [0.06, 0, 0], [-0.1, 0, 0])],
  };
}
function receipt(world, index = 1) {
  const r = world.jointReaction(index);
  assert.equal(r.status, 'ok');
  assert.ok(Number.isInteger(r.tick) && r.tick > 0);
  assert.equal(r.impulse.length, 3);
  assert.ok(r.impulse.every(Number.isFinite));
  return r.impulse;
}
function near(actual, expected, tolerance, context) {
  assert.ok(
    Math.hypot(...actual.map((x, k) => x - expected[k])) <= tolerance,
    JSON.stringify({ context, actual, expected, tolerance }),
  );
}
function contactImpulse(world, indices) {
  const sample = world.contacts();
  assert.ok(sample.available);
  const out = [0, 0, 0];
  for (const row of sample.rows) {
    const sign = Number(indices.includes(row.b)) - Number(indices.includes(row.a));
    if (!sign) continue;
    for (let k = 0; k < 3; k++)
      out[k] += sign * ((row.normalImpulse?.[k] ?? 0) + (row.frictionImpulse?.[k] ?? 0));
  }
  return out;
}
function momentum(states, config, indices) {
  return [0, 1, 2].map((k) =>
    indices.reduce((sum, i) => sum + config.bodies[i].mass * states[i].velocity[k], 0),
  );
}
function oracle(world, config, indices, before) {
  const prior = momentum(before, config, indices),
    after = momentum(world.read(), config, indices);
  const contacts = contactImpulse(world, indices);
  const mass = indices.reduce((sum, i) => sum + config.bodies[i].mass, 0);
  return after.map((x, k) => x - prior[k] - mass * config.gravity[k] * DT - contacts[k]);
}
function tick(world, drive = null) {
  world.prepareConstraints();
  world.prepareSprings();
  world.applyPreparedConstraints();
  world.applySprings();
  drive?.(world);
  world.applyGears();
  world.step();
}

test('joint reactions start unavailable, copy completed values and restore without another solve', async () => {
  const w = await createPhysicsWorld(fixture());
  try {
    assert.deepEqual(w.jointReaction(1), { tick: 0, status: 'initializing' });
    assert.throws(() => w.jointReaction(-1));
    tick(w);
    const expected = w.jointReaction(1),
      copy = w.jointReaction(1),
      checkpoint = w.snapshot();
    copy.impulse[0] = 999;
    assert.deepEqual(w.jointReaction(1), expected);
    tick(w);
    const later = w.jointReaction(1);
    w.restore(checkpoint);
    assert.deepEqual(w.jointReaction(1), expected);
    tick(w);
    assert.deepEqual(w.jointReaction(1), later);
  } finally {
    w.dispose();
  }
});

test('hanging force uses the measured boundary including own weight only when B supports', async () => {
  for (const mass of [0.1, 1, 5])
    for (const gravity of [0, 9.81])
      for (const reversed of [false, true]) {
        const c = fixture(mass, gravity, reversed),
          w = await createPhysicsWorld(c);
        try {
          const expected = [-(mass + (reversed ? c.bodies[1].mass : 0)) * gravity, 0, 0];
          for (let k = 0; k < 360; k++) {
            tick(w);
            if (k >= 240)
              near(
                receipt(w).map((x) => x / DT),
                expected,
                Math.max(0.05, 0.02 * Math.hypot(...expected)),
                { mass, gravity, reversed, k },
              );
          }
        } finally {
          w.dispose();
        }
      }
});

test('push, transverse load and rotated serialization retain physical side and vector sign', async () => {
  for (const direction of [
    [9.81, 0, 0],
    [-9.81, 0, 0],
    [0, -9.81, 0],
  ])
    for (const swap of [false, true])
      for (const rotated of [false, true]) {
        const c = fixture(),
          q = rotated ? [0, 0, Math.sin(0.37), Math.cos(0.37)] : Q;
        c.gravity = rotateVector(q, direction);
        for (const b of c.bodies) {
          b.position = rotateVector(q, b.position);
          b.rotation = [...q];
        }
        if (swap)
          for (const j of c.joints) {
            [j.a, j.b] = [j.b, j.a];
            [j.anchorA, j.anchorB] = [j.anchorB, j.anchorA];
          }
        const w = await createPhysicsWorld(c);
        try {
          for (let k = 0; k < 360; k++) {
            tick(w);
            if (k >= 240)
              near(
                receipt(w).map((x) => x / DT),
                c.gravity.map((x) => x * (swap ? 1 : -1)),
                0.1962,
                { direction, swap, rotated, k },
              );
          }
        } finally {
          w.dispose();
        }
      }
});

test('free fall has zero attachment force despite nonzero weight', async () => {
  const c = fixture(5);
  c.gravity = [0, -9.81, 0];
  c.bodies.forEach((b) => {
    b.fixed = false;
    b.position[1] += 100;
  });
  const w = await createPhysicsWorld(c);
  try {
    for (let k = 0; k < 360; k++) {
      tick(w);
      near(receipt(w), [0, 0, 0], 0.05 * DT, k);
    }
  } finally {
    w.dispose();
  }
});

test('contact support changes B force and closes an independent per-tick momentum account', async () => {
  const c = fixture();
  c.gravity = [0, -9.81, 0];
  c.bodies[0].fixed = false;
  c.bodies[0].mass = 0.1;
  c.bodies[2].halfExtents = [0.5, 0.1, 0.5];
  c.bodies.push(box([0.16, 2.8, 0], 1, true, [1, 0.1, 1]));
  const w = await createPhysicsWorld(c);
  let contactSeen = false,
    reduced = false;
  try {
    for (let k = 0; k < 360; k++) {
      const before = w.read();
      tick(w);
      const expected = oracle(w, c, [2], before);
      near(receipt(w), expected, Math.max(1e-4, 0.02 * Math.hypot(...expected)), k);
      contactSeen ||= Math.hypot(...contactImpulse(w, [2])) > 0.001;
      if (k >= 240) reduced ||= Math.hypot(...receipt(w)) < 0.9 * 9.81 * DT;
    }
    assert.ok(contactSeen && reduced, 'support must carry a measurable share of the load');
  } finally {
    w.dispose();
  }
});

test('a bypass invalidates only its joint while a separate bridge remains measurable', async () => {
  const c = fixture(),
    other = fixture(5);
  other.bodies.forEach((b) => {
    b.position[2] += 5;
  });
  c.bodies.push(...other.bodies);
  c.joints.push(...other.joints.map((j) => ({ ...j, a: j.a + 3, b: j.b + 3 })));
  c.joints.push(fixed(0, 2, [0.32, 0, 0], [0, 0, 0]));
  const w = await createPhysicsWorld(c);
  try {
    tick(w);
    assert.equal(w.jointReaction(1).status, 'unavailable');
    assert.equal(Object.hasOwn(w.jointReaction(1), 'impulse'), false);
    for (let k = 0; k < 360; k++) tick(w);
    near(receipt(w, 3), [-5 * 9.81 * DT, 0, 0], 0.02 * 5 * 9.81 * DT);
  } finally {
    w.dispose();
  }
});

test('prepared spring damping and powered linear motion close the bridge cut momentum account', async () => {
  for (const drive of [0, 5]) {
    const c = fixture();
    c.gravity = [0, -1, 0];
    c.bodies.push(box([0.16, 3.3, 0], 0.3, false, [0.02, 0.02, 0.02]));
    c.bodies[3].velocity = [0, 0.2, 0];
    c.joints.push({
      kind: 'spring',
      a: 2,
      b: 3,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [0, 1, 0],
      axisB: [0, 1, 0],
      limits: [0.08, 0.4],
      restLength: 0.3,
      stiffness: 100,
      damping: 2,
    });
    const w = await createPhysicsWorld(c);
    let dynamicEvidence = 0;
    try {
      for (let k = 0; k < 240; k++) {
        const before = w.read();
        tick(w, drive ? (x) => x.applyLinearDrive(2, drive) : null);
        const expected = oracle(w, c, [2, 3], before);
        near(receipt(w), expected, Math.max(1e-4, 0.02 * Math.hypot(...expected)), { drive, k });
        dynamicEvidence = Math.max(dynamicEvidence, Math.abs(expected[1] - 1.3 * DT));
      }
      assert.ok(dynamicEvidence > 0.001, 'fixture must distinguish a static weight estimate');
    } finally {
      w.dispose();
    }
  }
});

test('eccentric rotary and gear drives retain prepared bridge reaction contributions', async () => {
  for (const gears of [false, true]) {
    const c = fixture();
    c.gravity = [0, 0, 0];
    c.bodies.push(box([0.16, 3.2, 0], 0.3, false, [0.02, 0.02, 0.02]));
    c.joints.push({
      kind: 'revolute',
      a: 2,
      b: 3,
      anchorA: [0, 0.1, 0],
      anchorB: [0, -0.1, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
    });
    if (gears) {
      c.bodies.push(box([0.34, 3.2, 0], 0.2, false, [0.02, 0.02, 0.02]));
      c.joints.push({
        kind: 'revolute',
        a: 2,
        b: 4,
        anchorA: [0.18, 0.1, 0],
        anchorB: [0, -0.1, 0],
        axisA: [0, 0, 1],
        axisB: [0, 0, 1],
      });
      c.joints.push({
        kind: 'gear',
        a: 3,
        b: 4,
        anchorA: [0, -0.1, 0],
        anchorB: [0, -0.1, 0],
        axisA: [0, 0, 1],
        axisB: [0, 0, 1],
        radiusA: 0.06,
        radiusB: 0.12,
        stiffness: 20000,
        damping: 20,
      });
    }
    const w = await createPhysicsWorld(c),
      cut = gears ? [2, 3, 4] : [2, 3];
    let nonzero = 0;
    try {
      for (let k = 0; k < 240; k++) {
        const before = w.read();
        tick(w, (x) => x.applyTorquePair(2, 3, [0, 0, 1], 0.02));
        const expected = oracle(w, c, cut, before);
        near(receipt(w), expected, Math.max(1e-4, 0.02 * Math.hypot(...expected)), { gears, k });
        nonzero = Math.max(nonzero, Math.hypot(...expected));
      }
      assert.ok(nonzero > 0.001, 'eccentric drives must create measurable force, not only torque');
    } finally {
      w.dispose();
    }
  }
});

test('pure applied torque does not masquerade as translational attachment force', async () => {
  const c = fixture();
  c.gravity = [0, 0, 0];
  c.bodies.push(box([10, 10, 10], 1, true));
  const w = await createPhysicsWorld(c);
  try {
    for (let k = 0; k < 240; k++) {
      tick(w, (x) => x.applyTorquePair(3, 2, [0, 0, 1], 0.2));
      near(receipt(w), [0, 0, 0], 0.05 * DT, k);
    }
  } finally {
    w.dispose();
  }
});

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function angularMomentum(states, config, includeOrbital = true) {
  const total = [0, 0, 0];
  for (let i = 0; i < states.length; i++) {
    const s = states[i],
      b = config.bodies[i],
      h = b.halfExtents;
    const conjugate = [-s.rotation[0], -s.rotation[1], -s.rotation[2], s.rotation[3]];
    const localSpin = rotateVector(conjugate, s.angularVelocity);
    const spin = rotateVector(
      s.rotation,
      localSpin.map((v, k) => (v * b.mass * (h[(k + 1) % 3] ** 2 + h[(k + 2) % 3] ** 2)) / 3),
    );
    const orbital = cross(
      s.position,
      s.velocity.map((v) => v * b.mass),
    );
    for (let k = 0; k < 3; k++) total[k] += spin[k] + (includeOrbital ? orbital[k] : 0);
  }
  return total;
}

test('a free offset driven spring assembly conserves independently calculated total angular momentum', async () => {
  const c = fixture();
  c.gravity = [0, 0, 0];
  c.bodies.forEach((b) => {
    b.fixed = false;
    b.position[1] += 100;
  });
  c.bodies.push(box([0.36, 103.3, 0], 0.3, false, [0.02, 0.02, 0.02]));
  c.bodies[3].velocity = [0, 0.2, 0.15];
  c.joints.push({
    kind: 'spring',
    a: 2,
    b: 3,
    anchorA: [0.1, 0, 0],
    anchorB: [-0.1, 0, 0],
    axisA: [0, 1, 0],
    axisB: [0, 1, 0],
    limits: [0.08, 0.4],
    restLength: 0.3,
    stiffness: 100,
    damping: 2,
  });
  const w = await createPhysicsWorld(c);
  try {
    assert.equal(w.jointReaction(1).status, 'initializing');
    const initial = angularMomentum(w.read(), c);
    let omittedOrbitalError = 0;
    for (let k = 0; k < 240; k++) {
      tick(w, (x) => x.applyLinearDrive(2, 0.5));
      const states = w.read();
      assert.equal(w.contacts().rows.length, 0);
      near(angularMomentum(states, c), initial, 2e-6, k);
      omittedOrbitalError = Math.max(
        omittedOrbitalError,
        Math.hypot(...angularMomentum(states, c, false).map((x, i) => x - initial[i])),
      );
    }
    assert.ok(
      omittedOrbitalError > 0.01,
      'dropping orbital angular momentum must violate the same oracle',
    );
  } finally {
    w.dispose();
  }
});

import { spawnSync } from 'node:child_process';

test('zeroing only prepared joint diagnostics preserves motion but falsifies the force oracle', () => {
  const c = fixture();
  c.gravity = [0, -1, 0];
  c.bodies.push(box([0.16, 3.3, 0], 0.3, false, [0.02, 0.02, 0.02]));
  c.bodies[3].velocity = [0, 0.2, 0];
  c.joints.push({
    kind: 'spring',
    a: 2,
    b: 3,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axisA: [0, 1, 0],
    axisB: [0, 1, 0],
    limits: [0.08, 0.4],
    restLength: 0.3,
    stiffness: 100,
    damping: 2,
  });
  const nativeUrl = new URL('../src/simulation/physics/native-response.mjs', import.meta.url).href;
  const worldUrl = new URL('../src/simulation/physics/world.mjs', import.meta.url).href;
  const run = (mutant) => {
    const source = `
      import { registerHooks } from 'node:module';
      import { readFileSync } from 'node:fs';
      if (${mutant}) registerHooks({load(url, context, nextLoad) {
        if (url !== ${JSON.stringify(nativeUrl)}) return nextLoad(url, context);
        const original = readFileSync(new URL(url), 'utf8').replace('export function readNativeResponse(', 'function originalReadNativeResponse(');
        return {format:'module', shortCircuit:true, source:original + \`
          export function readNativeResponse(...args) {
            const original = originalReadNativeResponse(...args);
            const omit = (result) => ({...result, jointImpulses:result.jointImpulses.map(() => 0)});
            return { ...original, project(value) { return omit(original.project(value)); }, response(value) { return omit(original.response(value)); } };
          }
        \`};
      }});
      const { createPhysicsWorld } = await import(${JSON.stringify(worldUrl)});
      const c = ${JSON.stringify(c)}, DT = 1/120;
      ${contactImpulse.toString()}
      ${momentum.toString()}
      ${oracle.toString()}
      ${tick.toString()}
      const assert = (await import('node:assert/strict')).default;
      const world = await createPhysicsWorld(c), states = [], receipts = [];
      try {
        for (let k=0;k<240;k++) {
          const before = world.read(); tick(world, (w) => w.applyLinearDrive(2,5));
          const expected = oracle(world,c,[2,3],before), reaction = world.jointReaction(1);
          assert.equal(reaction.status,'ok');
          receipts.push({expected, impulse:reaction.impulse}); states.push(world.read());
        }
        process.stdout.write(JSON.stringify({states,receipts}));
      } finally { world.dispose(); }
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  const control = run(false),
    mutant = run(true);
  assert.deepEqual(
    mutant.states,
    control.states,
    'diagnostic omission must not alter mechanical trajectories',
  );
  let rejectedTicks = 0,
    largestExcess = 0;
  control.receipts.forEach(({ expected, impulse }, k) => {
    const tolerance = Math.max(1e-4, 0.02 * Math.hypot(...expected));
    near(impulse, expected, tolerance, k);
    const residual = Math.hypot(...mutant.receipts[k].impulse.map((x, i) => x - expected[i]));
    if (residual > tolerance) rejectedTicks++;
    largestExcess = Math.max(largestExcess, residual - tolerance);
  });
  assert.ok(
    rejectedTicks > 0 && largestExcess > 1e-4,
    JSON.stringify({ rejectedTicks, largestExcess }),
  );
});
