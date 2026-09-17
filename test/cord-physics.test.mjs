import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
const DT = 1 / 120;
const CORD_MASS = 1100 * ((Math.PI * 0.008 ** 2) / 4) * 0.3;
/** Beam bottom face at y = 0.98, plate top face at y = 0.61: an authored span of
 * 0.37 m, taut at a 0.30 m cord and slack at a 0.40 m one. */
function configuration({
  restLength = 0.3,
  stiffness = 300,
  damping = 20,
  fixed = false,
  gravity = [0, -9.81, 0],
} = {}) {
  const bp = createEmptyBlueprint('cord-physics', 'Cord');
  bp.parts = [createPart('beam', 'a', [0, 1, 0]), createPart('plate', 'b', [0, 0.6, 0])];
  bp.connections = [
    {
      id: 'c',
      kind: 'cord',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      cord: { restLength, stiffness, damping, diameter: 0.008, segments: 4, material: 'rubber' },
    },
  ];
  const compiled = compileAssembly(bp, { ground: null, gravity });
  compiled.configuration.bodies[0].fixed = fixed;
  delete compiled.configuration.power;
  return compiled.configuration;
}
function step(w) {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  w.applyRopes();
  return w.step();
}
test('a slack cord pulls nothing while the taut positive control pulls every row', async () => {
  const slack = await createPhysicsWorld(configuration({ restLength: 0.4 }));
  try {
    const initial = slack.read();
    for (let i = 0; i < 120; i++) step(slack);
    const end = slack.read();
    // A tension-only element in free fall transmits no force at all: every body
    // keeps exactly the free-fall solution. A two-sided spring would push here.
    for (let i = 0; i < end.length; i++) {
      assert.ok(Math.abs(end[i].velocity[1] + 9.81 * 120 * DT) < 1e-7, `body ${i} velocity`);
      assert.ok(
        Math.abs(
          end[i].position[1] -
            initial[i].position[1] +
            9.81 * DT ** 2 * ((120 * 119) / 2 + (120 * 5) / 8),
        ) < 1e-7,
        `body ${i} position`,
      );
    }
    assert.ok(slack.ropes().every((r) => r.appliedTension === 0));
    assert.ok(slack.ropes().every((r) => r.elasticTension === 0 && r.potentialJ === 0));
    const separation = (state) => state[0].position[1] - state[1].position[1];
    assert.ok(Math.abs(separation(end) - separation(initial)) < 1e-9);
  } finally {
    slack.dispose();
  }
  const taut = await createPhysicsWorld(configuration({ restLength: 0.3 }));
  try {
    for (let i = 0; i < 120; i++) step(taut);
    assert.ok(taut.ropes().every((r) => r.appliedTension > 0));
    assert.ok(taut.ropes().every((r) => r.potentialJ > 0));
    const state = taut.read();
    assert.ok(state[0].position[1] - state[1].position[1] < 0.4);
  } finally {
    taut.dispose();
  }
});
test('a hanging load settles at the analytical extension of the authored stiffness', async () => {
  const c = configuration({ fixed: true }),
    w = await createPhysicsWorld(c);
  try {
    for (let i = 0; i < 2400; i++) step(w);
    const rows = w.ropes(),
      extension = rows.reduce((s, r) => s + r.length - r.restLength, 0);
    // A uniformly loaded elastic element of authored stiffness k carries the load
    // plus half its own weight: x = (m + m_cord/2) g / k. The wrong trace is the
    // per-row stiffness n k, which would predict a quarter of this.
    const expected = ((c.bodies[1].mass + CORD_MASS / 2) * 9.81) / 300;
    assert.ok(extension > 0.5 * expected, `${extension} vs ${expected}`);
    assert.ok(Math.abs(extension - expected) < 3 * 9.81 * DT ** 2, `${extension} vs ${expected}`);
    assert.ok(Math.abs(w.read()[1].velocity[1]) < 0.01);
    assert.ok(rows[0].appliedTension > c.bodies[1].mass * 9.81);
  } finally {
    w.dispose();
  }
});
test('slack and taut cord snapshots continue exactly and reject corrupt restore atomically', async () => {
  for (const restLength of [0.4, 0.3]) {
    const w = await createPhysicsWorld(configuration({ restLength, fixed: true }));
    try {
      for (let i = 0; i < 60; i++) step(w);
      const bytes = w.snapshot(),
        energy = w.mechanicalEnergy();
      const expected = step(w);
      w.restore(bytes, energy);
      assert.deepEqual(step(w), expected);
      const before = w.snapshot(),
        bad = before.slice();
      bad[bad.length - 1] ^= 1;
      assert.throws(() => w.restore(bad));
      assert.deepEqual(w.snapshot(), before);
    } finally {
      w.dispose();
    }
  }
});
test('a cord stretched past its linear domain stops the run with a bounded cord reason', async () => {
  const w = await createPhysicsWorld(configuration({ stiffness: 1, damping: 0, fixed: true }));
  try {
    let caught = null;
    for (let i = 0; i < 1200 && !caught; i++)
      try {
        step(w);
      } catch (error) {
        caught = error;
      }
    assert.ok(caught, 'a 1 N/m cord under a 3 kg load must exceed 100 per cent strain');
    assert.equal(caught.reasonCode, 'CORD_MOTION_LIMIT');
    assert.match(caught.message, /cord/i);
  } finally {
    w.dispose();
  }
  // Positive control: the same load on the shipped maximum stiffness does not stop.
  const firm = await createPhysicsWorld(configuration({ fixed: true }));
  try {
    for (let i = 0; i < 1200; i++) step(firm);
    assert.ok(firm.ropes().every((r) => r.strain < 1));
  } finally {
    firm.dispose();
  }
});
