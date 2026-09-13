import assert from 'node:assert/strict';
import { rotateVector } from '../../src/model/transforms.mjs';
// Test-only accounting uses authored masses and cuboid inertias. Product sensing never uses this oracle.
export const DT = 1 / 120;
const Q = [0, 0, 0, 1];
const box = (position, mass = 1, fixed = false, halfExtents = [0.02, 0.02, 0.02]) => ({
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
const mount = (a, b, anchorA, anchorB) => ({
  kind: 'fixed',
  a,
  b,
  anchorA,
  anchorB,
  rotationA: [...Q],
  rotationB: [...Q],
});
export function physicalCase(path, mode) {
  const free = mode === 'free',
    stalled = mode === 'stall';
  const c = {
    gravity: free ? [0, 0, 0] : [0, -1, 0],
    bodies: [
      box([-0.16, 3, 0], 1, !free, [0.1, 0.1, 0.1]),
      box([0, 3, 0], 0.12 * 0.04 * 0.04 * 2700, false, [0.06, 0.02, 0.02]),
      box([0.16, 3, 0], 1, false, [0.1, 0.1, 0.1]),
    ],
    joints: [mount(0, 1, [0.1, 0, 0], [-0.06, 0, 0]), mount(1, 2, [0.06, 0, 0], [-0.1, 0, 0])],
  };
  const cut = [2, 3];
  if (path === 'spring' || path === 'linear') {
    c.bodies.push(box([0.16, 3.3, 0], 0.3));
    c.bodies[3].velocity = stalled ? [0, 0, 0] : [0, 0.2, 0];
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
      stiffness: path === 'linear' && stalled ? 0 : 100,
      damping: 2,
    });
    if (path === 'linear' && stalled)
      c.bodies.push(box([0.16, 3.41, 0], 1, true, [0.08, 0.05, 0.08]));
  } else {
    c.bodies.push(box([0.16, 3.2, 0], 0.3));
    c.joints.push({
      kind: 'revolute',
      a: 2,
      b: 3,
      anchorA: [0, 0.1, 0],
      anchorB: [0, -0.1, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
      ...(stalled && path !== 'gear' ? { limits: [-0.03, 0.03] } : {}),
    });
    if (path === 'gear') {
      c.bodies.push(box([0.34, 3.2, 0], 0.2));
      cut.push(4);
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
  }
  if (path === 'gear' && stalled) c.bodies.push(box([0.08, 3.2, 0], 1, true, [0.05, 0.05, 0.05]));
  if (path === 'rotary' || path === 'gear') c.gravity = [0, 0, 0];
  if (free) {
    for (const b of c.bodies) b.position[1] += 100;
    c.bodies[3].velocity = [0.1, 0.2, 0.15];
  }
  const drive = (w, k) => {
    if (path === 'linear')
      w.applyLinearDrive(2, stalled ? 5 : 0.5 * Math.cos(2 * Math.PI * k * DT));
    else if (path !== 'spring') w.applyTorquePair(2, 3, [0, 0, 1], 0.02);
  };
  return { c, cut, drive };
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function momentum(states, c, indices) {
  return [0, 1, 2].map((k) =>
    indices.reduce((sum, i) => sum + c.bodies[i].mass * states[i].velocity[k], 0),
  );
}
// Whole free assembly: internal joint/contact impulses cancel. This is not a torque reading
// from the load cell: its bridge receipt contains linear impulse only.
function angular(states, c, orbital = true) {
  const out = [0, 0, 0];
  for (let i = 0; i < states.length; i++) {
    const s = states[i],
      b = c.bodies[i],
      h = b.halfExtents;
    const spin = rotateVector(
      s.rotation,
      rotateVector(
        [-s.rotation[0], -s.rotation[1], -s.rotation[2], s.rotation[3]],
        s.angularVelocity,
      ).map((v, k) => (v * b.mass * (h[(k + 1) % 3] ** 2 + h[(k + 2) % 3] ** 2)) / 3),
    );
    const orbit = cross(
      s.position,
      s.velocity.map((v) => v * b.mass),
    );
    for (let k = 0; k < 3; k++) out[k] += spin[k] + (orbital ? orbit[k] : 0);
  }
  return out;
}
const difference = (a, b) => a.map((x, i) => x - b[i]);
function externalContact(w, indices) {
  const rows = w.contacts();
  assert.equal(rows.available, true);
  const out = [0, 0, 0];
  for (const row of rows.rows) {
    const sign = Number(indices.includes(row.b)) - Number(indices.includes(row.a));
    for (let k = 0; k < 3; k++)
      out[k] += sign * ((row.normalImpulse?.[k] ?? 0) + (row.frictionImpulse?.[k] ?? 0));
  }
  return out;
}
const magnitude = (v) => Math.hypot(...v);
export async function runPhysicalCase(createPhysicsWorld, path, mode, { mutant = 'none' } = {}) {
  const { c, cut, drive } = physicalCase(path, mode),
    w = await createPhysicsWorld(c),
    free = mode === 'free',
    stall = mode === 'stall';
  let maxDriveAngularVelocityDelta = 0,
    maxDriveVelocityDelta = 0,
    maxLinearError = 0,
    maxAngularError = 0,
    wrongAngularTicks = 0,
    motion = 0,
    tailSpeed = 0,
    maxContactImpulse = 0,
    wrongReactionTicks = 0,
    maxReaction = 0;
  let minTailContactImpulse = Infinity;
  let tailOrigin = null,
    tailDisplacement = 0;
  const initial = w.read(),
    initialAngular = angular(initial, c),
    initialSpin = angular(initial, c, false);
  const ticks = stall ? 360 : 240;
  try {
    for (let k = 0; k < ticks; k++) {
      const before = w.read(),
        priorMomentum = momentum(before, c, cut),
        priorAngular = angular(before, c),
        priorSpin = angular(before, c, false);
      w.prepareConstraints();
      w.prepareSprings();
      w.applyPreparedConstraints();
      w.applySprings();
      // Observe the immediate physical velocity change across the drive call.
      // Initial motion and passive spring responses cannot satisfy this witness.
      const beforeDrive = path !== 'spring' ? w.read()[3] : null;
      drive(w, k);
      if (beforeDrive) {
        const afterDrive = w.read()[3];
        maxDriveVelocityDelta = Math.max(
          maxDriveVelocityDelta,
          magnitude(difference(afterDrive.velocity, beforeDrive.velocity)),
        );
        maxDriveAngularVelocityDelta = Math.max(
          maxDriveAngularVelocityDelta,
          magnitude(difference(afterDrive.angularVelocity, beforeDrive.angularVelocity)),
        );
      }
      w.applyGears();
      w.step();
      const after = w.read(),
        r = w.jointReaction(1);
      assert.equal(r.status, 'ok');
      const contacts = externalContact(w, cut),
        mass = cut.reduce((s, i) => s + c.bodies[i].mass, 0);
      // A cut around the payload and driven bodies leaves the bridge, gravity, and
      // separately observed external contacts. Motor and spring forces are internal.
      const expected = momentum(after, c, cut).map(
        (v, i) => v - priorMomentum[i] - mass * c.gravity[i] * DT - contacts[i],
      );
      const observed =
        mutant === 'zero'
          ? [0, 0, 0]
          : mutant === 'divide-substeps'
            ? r.impulse.map((x) => x / 4)
            : mutant === 'double-count'
              ? r.impulse.map((x) => x * 2)
              : r.impulse;
      const tolerance = Math.max(1e-4, 0.02 * magnitude(expected)),
        error = magnitude(difference(observed, expected));
      maxLinearError = Math.max(maxLinearError, error);
      maxReaction = Math.max(maxReaction, magnitude(r.impulse));
      maxContactImpulse = Math.max(maxContactImpulse, magnitude(contacts));
      assert.ok(
        error <= tolerance,
        'physical-force-account ' +
          JSON.stringify({ path, mode, k, error, tolerance, expected, actual: observed }),
      );
      const wrong = [0, 0, 0];
      if (magnitude(difference(wrong, expected)) > tolerance) wrongReactionTicks++;
      if (free) {
        assert.ok(
          w.contacts().rows.every((row) => row.a >= 0 && row.b >= 0),
          'free angular oracle permits only internal body contacts',
        );
        const delta = difference(angular(after, c), priorAngular),
          drift = difference(angular(after, c), initialAngular);
        const angularError = Math.max(magnitude(delta), magnitude(drift));
        maxAngularError = Math.max(maxAngularError, angularError);
        assert.ok(angularError <= 2e-6, JSON.stringify({ path, mode, k, angularError }));
        const wrongDelta = difference(angular(after, c, false), priorSpin),
          wrongDrift = difference(angular(after, c, false), initialSpin);
        if (Math.max(magnitude(wrongDelta), magnitude(wrongDrift)) > 2e-6) wrongAngularTicks++;
      }
      motion = Math.max(motion, magnitude(difference(after[3].position, initial[3].position)));
      if (k >= 240) {
        minTailContactImpulse = Math.min(minTailContactImpulse, magnitude(contacts));
        tailOrigin ??= after[3].position;
        tailDisplacement = Math.max(
          tailDisplacement,
          magnitude(difference(after[3].position, tailOrigin)),
        );
        tailSpeed = Math.max(
          tailSpeed,
          path === 'spring' || path === 'linear'
            ? magnitude(difference(after[3].velocity, after[2].velocity))
            : Math.abs(w.jointState(2).speed),
        );
      }
    }
    if (path === 'linear')
      assert.ok(
        maxDriveVelocityDelta > 0.001,
        'physical-drive-witness: linear drive must change physical velocity during its own phase',
      );
    if (path === 'rotary' || path === 'gear')
      assert.ok(
        maxDriveAngularVelocityDelta > 0.001,
        'physical-drive-witness: torque drive must change physical angular velocity during its own phase',
      );
    assert.ok(maxReaction > 1e-4, 'fixture must carry a measurable bridge force');
    if (free) assert.ok(wrongAngularTicks > 0, 'omitting orbital momentum must fail this path');
    if (!stall) assert.ok(motion > 0.001, 'moving fixture must actually move');
    else {
      // A spring settles passively; drives remain powered against a limit/contact.
      // Contact/limit solvers retain velocity residuals. Require <1 mm drift over
      // the final second as well as bounded speed; do not claim exact zero speed.
      assert.ok(tailDisplacement < 0.001, JSON.stringify({ path, tailDisplacement }));
      assert.ok(
        tailSpeed < (path === 'linear' ? 0.01 : path === 'spring' ? 0.002 : 0.1),
        JSON.stringify({ path, tailSpeed }),
      );
      if (path === 'linear' || path === 'gear')
        assert.ok(
          minTailContactImpulse > 0.0001,
          'powered stall needs sustained measured support contact throughout the final second',
        );
    }
    return {
      path,
      mode,
      ticks,
      maxDriveVelocityDelta,
      maxDriveAngularVelocityDelta,
      maxLinearError,
      maxAngularError,
      wrongAngularTicks,
      motion,
      tailSpeed,
      tailDisplacement,
      maxContactImpulse,
      minTailContactImpulse: stall ? minTailContactImpulse : null,
      wrongReactionTicks,
      maxReaction,
    };
  } finally {
    w.dispose();
  }
}
