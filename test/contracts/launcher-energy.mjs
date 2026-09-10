import assert from 'node:assert/strict';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { createPhysicsWorld } from '../../src/simulation/physics/world.mjs';
import { rotateVector, multiplyQuaternion } from '../../src/model/transforms.mjs';

// Frozen before redesign: a wheel must travel at least one diameter per second.
// 10% separates useful launch energy from the accounted non-spring sources; the
// per-impulse 1e-8 J oracle bound is also exercised by powered-hinge controls.
// For one motor and 360 ticks this allocates 3.6e-6 J; the 1e-5 J final
// noncreation bar leaves 6.4e-6 J for independent finite-sum roundoff. It is
// an acceptance bound, not a proof of exact per-stage energy conservation.
const LAUNCH_SPEED = 0.2,
  WORK_ERROR_PER_IMPULSE = 1e-8;
const NONCREATION_ERROR_J = 1e-5;
const inverseRotation = (q) => [-q[0], -q[1], -q[2], q[3]];
export const rotationDistance = (a, b) => {
  const q = multiplyQuaternion(inverseRotation(a), b);
  return 2 * Math.atan2(Math.hypot(...q.slice(0, 3)), Math.abs(q[3]));
};
// Independent arithmetic on authored shape parameters and completed samples.
// Cylinders have canonical solid-cylinder inertia; their 64-sided mesh is only
// collision geometry (world.mjs explicitly sets mass properties).
export function launchMechanicalEnergy(configuration, states, reference) {
  let kinetic = 0,
    gravity = 0,
    elastic = 0;
  for (const [i, body] of configuration.bodies.entries()) {
    if (body.fixed) continue;
    assert.ok(
      ['box', 'cylinder'].includes(body.shape),
      'independent inertia oracle requires a qualified primitive',
    );
    const state = states[i],
      [x, y, z] = body.halfExtents,
      mass = body.mass;
    const inertia =
      body.shape === 'box'
        ? [(mass * (y * y + z * z)) / 3, (mass * (x * x + z * z)) / 3, (mass * (x * x + y * y)) / 3]
        : [
            (mass * y * y) / 2,
            (mass * (3 * y * y + 4 * x * x)) / 12,
            (mass * (3 * y * y + 4 * x * x)) / 12,
          ];
    const angular = rotateVector(inverseRotation(state.rotation), state.angularVelocity);
    kinetic += (mass * state.velocity.reduce((sum, value) => sum + value * value, 0)) / 2;
    kinetic += angular.reduce((sum, value, axis) => sum + inertia[axis] * value * value, 0) / 2;
    gravity -=
      mass *
      configuration.gravity.reduce(
        (sum, value, axis) => sum + value * (state.position[axis] - reference[i].position[axis]),
        0,
      );
  }
  for (const joint of configuration.joints)
    if (joint.kind === 'spring') {
      const a = states[joint.a],
        b = states[joint.b];
      const pointA = rotateVector(a.rotation, joint.anchorA).map(
        (value, axis) => value + a.position[axis],
      );
      const pointB = rotateVector(b.rotation, joint.anchorB).map(
        (value, axis) => value + b.position[axis],
      );
      const axis = rotateVector(a.rotation, joint.axisA);
      const length = axis.reduce((sum, value, i) => sum + value * (pointB[i] - pointA[i]), 0);
      elastic += (joint.stiffness * (length - joint.restLength) ** 2) / 2;
    }
  const total = kinetic + gravity + elastic;
  assert.ok([kinetic, gravity, elastic, total].every(Number.isFinite));
  return { kinetic, gravity, elastic, total };
}
export function assertNoCreation(trial) {
  assert.ok(
    trial.uncertainty <= NONCREATION_ERROR_J,
    'impulse error allocation must fit the frozen bound',
  );
  assert.ok(
    trial.noncreation <= NONCREATION_ERROR_J,
    `independent final mechanical energy creation ${trial.noncreation} J exceeds ${NONCREATION_ERROR_J} J`,
  );
}
async function launchTrial(blueprint) {
  const config = compileAssembly(blueprint).configuration;
  assert.deepEqual(
    config.gravity,
    [0, -9.81, 0],
    'this fixed launch trial uses terrestrial gravity',
  );
  const session = await createSession(config);
  const shadow = await createPhysicsWorld({
    gravity: config.gravity,
    bodies: config.bodies,
    joints: config.joints,
  });
  const index = (id) => blueprint.parts.findIndex((p) => p.id === id);
  const projectile = index('projectile'),
    base = index('base'),
    carriage = index('carriage');
  const pushers = new Set([carriage]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const joint of config.joints)
      if (joint.kind !== 'spring' && (pushers.has(joint.a) || pushers.has(joint.b)))
        for (const body of [joint.a, joint.b])
          if (!pushers.has(body)) {
            pushers.add(body);
            changed = true;
          }
  }
  try {
    let previous = session.observe().frames[0];
    const initial = previous,
      minY = initial.physics.map((p) => p.position[1]);
    // All nominal and counterexample bodies start at rest: this independently
    // includes rotational as well as translational initial kinetic energy.
    assert.ok(
      initial.physics.every((p) => [...p.velocity, ...p.angularVelocity].every((v) => v === 0)),
    );
    let positiveWork = 0,
      positiveConstraintWork = 0,
      externalWork = 0,
      uncertainty = 0;
    const initialRelative =
      initial.physics[projectile].position[0] - initial.physics[base].position[0];
    let holdMin = initialRelative,
      holdMax = initialRelative;
    const motor = config.power.motors[0],
      limits = motor.positionControl;
    const target =
      motor.defaultDuty * (motor.defaultDuty >= 0 ? limits.upperLimit : -limits.lowerLimit);
    const stroke = Math.abs(limits.upperLimit - target);
    assert.ok(stroke > 0 && Number.isFinite(stroke));
    const mechanicalInitial = launchMechanicalEnergy(config, initial.physics, initial.physics);
    let transfer = 0,
      lastContact = null;
    const gates = [],
      losses = [],
      recoil = [];
    for (let tick = 1; tick <= 360; tick++) {
      const checkpoint = session.checkpoint();
      if (tick === 241) session.act({ type: 'receiver', node: index('release'), duty: 1 });
      session.step();
      const frame = session.observe().frames[0];
      assert.equal(frame.status, 'ready');
      assert.equal(frame.contacts.available, true);
      // This shadow independently checks impulse-work bookkeeping. It shares
      // the production response solver and does not qualify that response law.
      shadow.restore(Uint8Array.from(checkpoint.physics));
      shadow.prepareConstraints();
      shadow.prepareSprings();
      shadow.applyPreparedConstraints();
      shadow.applySprings();
      for (const [i, motor] of config.power.motors.entries()) {
        const torque = frame.power.motors[i].torque;
        const axis = rotateVector(previous.physics[motor.body].rotation, motor.axis);
        const speed = (states) =>
          axis.reduce(
            (sum, v, k) =>
              sum +
              v * (states[motor.rotor].angularVelocity[k] - states[motor.body].angularVelocity[k]),
            0,
          );
        const before = speed(shadow.read());
        shadow.applyTorquePair(motor.body, motor.rotor, axis, torque);
        const work = ((torque / 120) * (before + speed(shadow.read()))) / 2;
        const recorded = frame.power.motors[i].shaftWorkJ - previous.power.motors[i].shaftWorkJ;
        assert.ok(
          Math.abs(recorded - work) <= WORK_ERROR_PER_IMPULSE,
          `independent impulse work ${tick}: ${recorded} / ${work}`,
        );
        positiveWork += Math.max(0, recorded);
        uncertainty += WORK_ERROR_PER_IMPULSE;
      }
      positiveConstraintWork += Math.max(0, frame.energy.constraintWorkJ);
      externalWork += Math.max(0, frame.energy.externalWorkJ);
      frame.physics.forEach((p, i) => (minY[i] = Math.min(minY[i], p.position[1])));
      const relative = frame.physics[projectile].position[0] - frame.physics[base].position[0];
      if (tick <= 240) {
        holdMin = Math.min(holdMin, relative);
        holdMax = Math.max(holdMax, relative);
      }
      for (const c of frame.contacts.rows)
        if (
          [c.a, c.b].includes(projectile) &&
          (pushers.has(c.a) || pushers.has(c.b)) &&
          c.normalImpulse &&
          Math.hypot(...c.normalImpulse) > 1e-10
        ) {
          if (tick > 240)
            transfer += Math.max(0, (c.a === projectile ? 1 : -1) * c.normalImpulse[0]);
          lastContact = tick;
        }
      gates.push(
        multiplyQuaternion(
          inverseRotation(frame.physics[motor.body].rotation),
          frame.physics[index('gate')].rotation,
        ),
      );
      losses.push({
        integration: frame.energy.integrationDeltaJ,
        damping: frame.energy.dampingWorkJ,
        constraint: frame.energy.constraintWorkJ,
      });
      recoil.push(frame.physics[base].velocity[0]);
      previous = frame;
    }
    const gravityDrop = initial.physics.reduce(
      (sum, p, i) => sum + p.mass * 9.81 * Math.max(0, p.position[1] - minY[i]),
      0,
    );
    const final = previous,
      speed = -final.physics[projectile].velocity[0];
    const gain = 0.5 * final.physics[projectile].mass * Math.max(0, speed) ** 2;
    const alternative =
      positiveWork + positiveConstraintWork + gravityDrop + externalWork + uncertainty;
    const mechanicalFinal = launchMechanicalEnergy(config, final.physics, initial.physics);
    // Deliberately conservative: retain all positive actuator/reaction inputs,
    // and do not credit measured integrationDelta or dissipative losses.
    const noncreation =
      mechanicalFinal.total -
      mechanicalInitial.total -
      positiveWork -
      positiveConstraintWork -
      externalWork;
    return {
      initial,
      final,
      speed,
      relativeSpeed: final.physics[base].velocity[0] - final.physics[projectile].velocity[0],
      gain,
      alternative,
      positiveWork,
      positiveConstraintWork,
      mechanicalInitial,
      mechanicalFinal,
      noncreation,
      stroke,
      gravityDrop,
      externalWork,
      uncertainty,
      hold: holdMax - holdMin,
      gates,
      transfer,
      lastContact,
      losses,
      recoil,
    };
  } finally {
    shadow.dispose();
    session.dispose();
  }
}
export function assertReleaseEnergy(trial) {
  assertNoCreation(trial);
  assert.ok(
    trial.gain > 0 && trial.speed >= LAUNCH_SPEED,
    'useful forward speed at exactly one second',
  );
  assert.ok(trial.relativeSpeed > 0, 'projectile moves outward relative to the recoiling launcher');
  assert.equal(trial.externalWork, 0);
  assert.ok(
    trial.alternative <= 0.1 * trial.gain,
    `release energy: alternative ${trial.alternative} J exceeds 10% of ${trial.gain} J`,
  );
}
export async function launchControls(factory) {
  const blueprint = factory(),
    configuration = compileAssembly(blueprint).configuration;
  const initialSession = await createSession(configuration);
  const length = initialSession.observe().frames[0].springs[0].length;
  initialSession.dispose();
  const results = [];
  for (const variant of ['loaded', 'zero-preload', 'zero-kc']) {
    const bp = factory(),
      guide = bp.parts.find((p) => p.id === 'guide');
    if (variant === 'zero-preload') guide.parameters.restLength = length;
    if (variant === 'zero-kc') Object.assign(guide.parameters, { stiffness: 0, damping: 0 });
    results.push(await launchTrial(bp));
  }
  return results;
}
