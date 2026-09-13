// Native diagnostic contract. The build recipe resolves this static import to its just-built package.
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-deterministic-compat';
await R.init();
const dt = 1 / 120,
  identity = { x: 0, y: 0, z: 0, w: 1 };
function fixture({ mass = 1, gravity = 9.81, iterations = 4, falling = false } = {}) {
  const world = new R.World({ x: 0, y: -gravity, z: 0 });
  world.timestep = dt;
  world.integrationParameters.numSolverIterations = iterations;
  const a = world.createRigidBody(
    falling ? R.RigidBodyDesc.dynamic().setCanSleep(false) : R.RigidBodyDesc.fixed(),
  );
  if (falling) world.createCollider(R.ColliderDesc.cuboid(0.1, 0.1, 0.1).setMass(1), a);
  const b = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, -1, 0),
  );
  world.createCollider(R.ColliderDesc.cuboid(0.1, 0.1, 0.1).setMass(mass), b);
  const joint = world.createImpulseJoint(
    R.JointData.fixed({ x: 0, y: -1, z: 0 }, identity, { x: 0, y: 0, z: 0 }, identity),
    a,
    b,
    true,
  );
  return { world, a, b, joint };
}
let samples = 0;
for (const mass of [0.1, 1, 5])
  for (const gravity of [0, 9.81])
    for (const iterations of [4, 8]) {
      const { world, b, joint } = fixture({ mass, gravity, iterations });
      assert.equal(
        typeof world.impulseJoints.raw.jointAppliedLinearImpulse,
        'function',
        'complete native reaction binding must exist',
      );
      assert.equal(
        world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle),
        undefined,
        'cold reading is absent',
      );
      for (let tick = 0; tick < 360; tick++) {
        const before = b.linvel().y;
        world.step();
        const impulse = world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle);
        assert.ok(impulse && [...impulse].every(Number.isFinite));
        const oracle = -(mass * (b.linvel().y - before) + mass * gravity * dt);
        assert.ok(
          Math.abs(impulse[1] - oracle) <= Math.max(1e-4, 0.02 * Math.abs(oracle)),
          `momentum ${mass}/${gravity}/${iterations}/${tick}: ${impulse[1]} vs ${oracle}`,
        );
        if (tick >= 240) {
          assert.ok(
            Math.abs(impulse[1] / dt + mass * gravity) <= Math.max(0.05, 0.02 * mass * gravity),
          );
          assert.ok(Math.hypot(impulse[0], impulse[2]) / dt <= 0.05);
          samples++;
        }
      }
      const bytes = world.takeSnapshot();
      const first = world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle);
      first[0] = 42;
      assert.notEqual(
        world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle)[0],
        42,
        'receipt is copied',
      );
      assert.deepEqual(
        world.takeSnapshot(),
        bytes,
        'observing/mutating receipt does not change physical state',
      );
      const restored = R.World.restoreSnapshot(bytes);
      assert.equal(
        restored.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle),
        undefined,
        'native transient receipt is not checkpoint ownership',
      );
      for (let i = 0; i < 10; i++) {
        world.step();
        restored.step();
        assert.deepEqual(restored.takeSnapshot(), world.takeSnapshot());
        assert.deepEqual(
          restored.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle),
          world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle),
        );
      }
      restored.free();
      world.free();
    }
{
  const { world, joint } = fixture({ falling: true });
  for (let i = 0; i < 360; i++) {
    world.step();
    if (i >= 240)
      assert.ok(
        Math.hypot(...world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle)) / dt < 0.05,
        'free fall has no suspended weight',
      );
  }
  world.removeImpulseJoint(joint, true);
  assert.equal(
    world.impulseJoints.raw.jointAppliedLinearImpulse(joint.handle),
    undefined,
    'removed handle is absent',
  );
  world.free();
}
{
  const { world, a, b, joint } = fixture({ gravity: 0 });
  const before = world.takeSnapshot();
  const factor = world.impulseJoints.raw.prepareBilateralResponse(
    world.bodies.raw,
    new Float64Array([a.handle, b.handle]),
    new Float64Array([joint.handle]),
    world.integrationParameters.raw,
  );
  const force = new Float64Array(12);
  force[7] = -1;
  const response = factor.responseWithJointImpulses(force);
  assert.equal(response.length, 27);
  assert.deepEqual(
    [...response.slice(0, 24)],
    [...factor.response(force)],
    'diagnostics preserve body arithmetic',
  );
  assert.ok(Math.abs(response[25] + 1) < 0.02, `reaction attribution ${response[25]}`);
  assert.equal(response[24], 0);
  assert.equal(response[26], 0);
  const projection = factor.projectWithJointImpulses(force);
  assert.deepEqual([...projection.slice(0, 24)], [...factor.project(force)]);
  assert.deepEqual(world.takeSnapshot(), before, 'prepared query has no world effects');
  factor.free();
  world.free();
}
console.log(
  `Native joint reaction contract PASS (${samples} static samples plus per-tick momentum, subdivisions, free fall, copying, restore and prepared attribution).`,
);
