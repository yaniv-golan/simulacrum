import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { gearCapacityFixture } from './fixtures/gear-capacity.mjs';

test('ordinary revolute tree and redundant loop survive gradual underflow without state clamps', async () => {
  for (const redundant of [false, true]) {
    const source = gearCapacityFixture({ meshes: 0 }),
      configuration = {
        gravity: source.gravity,
        bodies: source.bodies.slice(0, 3),
        joints: source.joints.slice(0, 2),
      };
    if (redundant) configuration.joints.push(structuredClone(configuration.joints[1]));
    const world = await createPhysicsWorld(configuration);
    let primary;
    try {
      // 0.72 + (0.18 - 0.72) differs from 0.18 by one rounding step. The
      // supported displacement decays into subnormal velocities by native tick8.
      for (let i = 0; i < 32; i++) {
        world.prepareConstraints();
        world.applyPreparedConstraints();
        world.step();
      }
      const state = world.read();
      assert.ok(
        state
          .flatMap((b) => [...b.position, ...b.velocity, ...b.angularVelocity])
          .every(Number.isFinite),
      );
      assert.ok(Math.abs(state[2].position[2] - 0.18) < 1e-12);
      const cp = world.snapshot();
      world.prepareConstraints();
      world.applyPreparedConstraints();
      world.step();
      const expected = world.snapshot();
      world.restore(cp);
      world.prepareConstraints();
      world.applyPreparedConstraints();
      world.step();
      assert.deepEqual(world.snapshot(), expected);
    } catch (error) {
      primary = error;
      throw error;
    } finally {
      try {
        world.dispose();
      } catch (cleanup) {
        if (!primary) throw cleanup;
      }
    }
  }
});
