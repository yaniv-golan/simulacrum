import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
function configuration(damping) {
  const bp = createEmptyBlueprint('cord-energy', 'Cord energy');
  bp.parts = [createPart('beam', 'a', [0, 1, 0]), createPart('plate', 'b', [0, 0.6, 0])];
  bp.connections = [
    {
      id: 'c',
      kind: 'cord',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      cord: {
        restLength: 0.3,
        stiffness: 300,
        damping,
        diameter: 0.008,
        segments: 4,
        material: 'rubber',
      },
    },
  ];
  const compiled = compileAssembly(bp, { ground: null });
  compiled.configuration.bodies[0].fixed = true;
  delete compiled.configuration.power;
  return compiled.configuration;
}
function step(w) {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  w.applyRopes();
  w.step();
}
const total = (w) => {
  const e = w.mechanicalEnergy();
  return e.kineticJ + e.potentialJ + e.ropePotentialJ;
};
test('a damped cord never increases mechanical energy and settles the load it carries', async () => {
  const w = await createPhysicsWorld(configuration(20));
  try {
    const initial = total(w);
    let peak = initial;
    for (let i = 0; i < 1200; i++) {
      step(w);
      const now = total(w);
      // Mechanical energy of a passive elastic element may only leave. The bound
      // is 1 mJ against a ~3 J gravitational swing, so a pumping element fails it.
      assert.ok(now <= peak + 1e-3, `tick ${i}: ${now} exceeds ${peak}`);
      peak = Math.max(peak, now);
    }
    assert.ok(total(w) < initial - 0.1, `${total(w)} vs ${initial}`);
    assert.ok(Math.abs(w.read()[1].velocity[1]) < 0.02, 'the damped load settles');
    assert.ok(w.ropes().every((r) => r.potentialJ >= 0));
  } finally {
    w.dispose();
  }
});
/** Swings whose peak speed passes 0.05 m/s, counted with hysteresis so that the
 * zero crossings of one oscillation are not read as separate swings. */
function swings(w, ticks) {
  let count = 0,
    armed = 0,
    last = 0;
  for (let i = 0; i < ticks; i++) {
    step(w);
    const v = w.read()[1].velocity[1];
    if (Math.abs(v) > 0.05) {
      if (armed !== 0 && Math.sign(v) !== armed) count++;
      armed = Math.sign(v);
    }
    last = v;
  }
  return { count, last };
}
test('an undamped cord keeps swinging while the damped control settles', async () => {
  const free = await createPhysicsWorld(configuration(0));
  const damped = await createPhysicsWorld(configuration(20));
  try {
    const undamped = swings(free, 1200);
    // The wrong trace this excludes is an implicit projection that quietly removes
    // motion: with no damper authored the load must still be swinging at ten
    // seconds, and only the authored damper may stop it.
    assert.ok(undamped.count >= 6, `only ${undamped.count} swings`);
    assert.ok(Math.abs(undamped.last) > 0.01, `${undamped.last}`);
    const settled = swings(damped, 1200);
    assert.ok(Math.abs(settled.last) < 0.001, `${settled.last}`);
    assert.ok(settled.count < undamped.count);
  } finally {
    free.dispose();
    damped.dispose();
  }
});
