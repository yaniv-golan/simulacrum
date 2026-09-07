import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
test('wheel diameter changes physical radius and mass without moving its axle; undo and load preserve it', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'gripWheel', id: 'wheel', position: [0, 1, 0] });
    const before = w.observe().frames[0];
    const result = await w.act({ type: 'parameter', id: 'wheel', key: 'diameter', value: 0.4 });
    assert.equal(result.ok, true);
    const after = w.observe().frames[0],
      bp = after.metadata.blueprint;
    assert.deepEqual(bp.parts[0].position, before.metadata.blueprint.parts[0].position);
    assert.ok(Math.abs(after.physics[0].mass / before.physics[0].mass - 4) < 1e-5);
    assert.deepEqual(compileAssembly(bp).configuration.bodies[0].halfExtents, [0.025, 0.2, 0.2]);
    const physical = (blueprint) => {
      const { gravity, bodies, joints } = compileAssembly(blueprint).configuration;
      return { gravity, bodies, joints };
    };
    const small = await createPhysicsWorld(physical(before.metadata.blueprint));
    const large = await createPhysicsWorld(physical(bp));
    try {
      assert.ok(
        Math.abs(
          small.getAxisInverseInertia(0, [1, 0, 0]) / large.getAxisInverseInertia(0, [1, 0, 0]) -
            16,
        ) < 1e-5,
      );
    } finally {
      small.dispose();
      large.dispose();
    }
    const saved = JSON.stringify(bp);
    await w.act({ type: 'undo' });
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, before.metadata.blueprint);
    assert.equal((await w.act({ type: 'load', save: saved })).ok, true);
    assert.equal(w.observe().frames[0].metadata.blueprint.parts[0].parameters.diameter, 0.4);
    assert.equal(
      (await w.act({ type: 'parameter', id: 'wheel', key: 'diameter', value: 4 })).ok,
      false,
    );
    await w.act({ type: 'place', partType: 'beam', id: 'obstacle', position: [0, 1.3, 0] });
    assert.equal(
      (await w.act({ type: 'parameter', id: 'wheel', key: 'diameter', value: 0.8 })).reasonCode,
      'SURFACE_OVERLAP',
    );
    assert.equal(w.observe().frames[0].metadata.blueprint.parts[0].parameters.diameter, 0.4);
  } finally {
    w.dispose();
  }
});
