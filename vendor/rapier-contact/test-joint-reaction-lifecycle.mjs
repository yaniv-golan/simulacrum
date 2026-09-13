// Raw generational-handle lifecycle witness; no runtime physics behavior is changed.
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-deterministic-compat';
await R.init();
const world = new R.World({ x: 0, y: -9.81, z: 0 });
world.timestep = 1 / 120;
const q = { x: 0, y: 0, z: 0, w: 1 };
const a = world.createRigidBody(R.RigidBodyDesc.fixed());
const b = world.createRigidBody(
  R.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, -1, 0),
);
world.createCollider(R.ColliderDesc.cuboid(0.05, 0.05, 0.05).setMass(1), b);
const create = () =>
  world.createImpulseJoint(
    R.JointData.fixed({ x: 0, y: -1, z: 0 }, q, { x: 0, y: 0, z: 0 }, q),
    a,
    b,
    true,
  );
const read = (handle) => world.impulseJoints.raw.jointAppliedLinearImpulse(handle);
const slot = (handle) => {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, handle, true);
  return bytes.getUint32(0, true);
};
let current = create();
try {
  for (let cycle = 0; cycle < 4; cycle++) {
    world.gravity = { x: 0, y: -9.81, z: 0 };
    for (let tick = 0; tick < 240; tick++) world.step();
    const oldHandle = current.handle,
      retained = [...read(oldHandle)];
    assert.ok(Math.abs(retained[1]) > 0.05, 'old occupant must carry a real load');
    world.removeImpulseJoint(current, true);
    assert.equal(read(oldHandle), undefined);
    world.gravity = { x: 0, y: 0, z: 0 };
    b.setTranslation({ x: 0, y: -1, z: 0 }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    current = create();
    assert.equal(slot(current.handle), slot(oldHandle), 'fixture must reuse the native arena slot');
    assert.notEqual(current.handle, oldHandle, 'generation must distinguish the new joint');
    const checkCold = (value) =>
      assert.equal(value, undefined, 'a reused slot has no completed interval');
    checkCold(read(current.handle));
    assert.throws(
      () => checkCold(retained),
      assert.AssertionError,
      'a slot-only cache must fail the same cold-state check',
    );
    assert.equal(read(oldHandle), undefined, 'the old generation stays absent after replacement');
    world.step();
    const fresh = [...read(current.handle)];
    const checkFresh = (value) =>
      assert.ok(Math.hypot(...value) < 1e-9, 'new unloaded joint must not inherit the old load');
    checkFresh(fresh);
    assert.throws(() => checkFresh(retained), assert.AssertionError);
    assert.equal(read(oldHandle), undefined);
  }
  console.log(
    JSON.stringify({
      cycles: 4,
      reusedSlots: 4,
      oldGenerationRejected: true,
      staleReceiptControlsRejected: true,
    }),
  );
} finally {
  world.free();
}
