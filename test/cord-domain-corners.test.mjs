import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { CORD_LIMITS, CORD_MATERIALS } from '../src/model/cord.mjs';
const DT = 1 / 120;
/** The two extremes of the authored domain, not a mid-range sample. The stiffest
 * corner puts the shipped maximum stiffness on the thinnest, shortest, most
 * subdivided cord, so its rows are the stiffest and its nodes the lightest the
 * player can author; the other corner is the opposite in every field. Both hang
 * from a default beam and carry a 0.1 m beam, which keeps 300 N/m inside the
 * shared elastic budget. */
const CORNERS = {
  stiffest: {
    restLength: CORD_LIMITS.minLength,
    diameter: CORD_LIMITS.minDiameter,
    segments: CORD_LIMITS.maxSegments,
    material: 'bungee',
    gap: 0.1,
  },
  softest: {
    restLength: CORD_LIMITS.maxLength,
    diameter: CORD_LIMITS.maxDiameter,
    segments: CORD_LIMITS.minSegments,
    material: 'rubber',
    gap: 0.4,
  },
};
function configuration(corner, damping) {
  const { gap, ...cord } = CORNERS[corner];
  const bp = createEmptyBlueprint('cord-corner', 'Cord corner');
  bp.parts = [createPart('beam', 'a', [0, 1, 0]), createPart('beam', 'b', [0, 1 - gap, 0])];
  bp.parts[1].parameters.length = 0.1;
  bp.connections = [
    {
      id: 'c',
      kind: 'cord',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      cord: { ...cord, stiffness: CORD_LIMITS.maxStiffness, damping },
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
test('both extremes of the authored cord domain converge without growth or jitter', async () => {
  for (const corner of ['stiffest', 'softest'])
    for (const damping of [0, CORD_LIMITS.maxDamping]) {
      const c = configuration(corner, damping),
        nodes = c.bodies.slice(2).map((b) => b.mass),
        rows = c.joints.filter((j) => j.kind === 'cord');
      const { restLength, diameter, segments, material } = CORNERS[corner],
        m = CORD_MATERIALS[material];
      // The corner really is the corner: the lightest node is the analytic half
      // segment of the authored material, and the rows carry n times 300 N/m.
      const half =
        (m.density * ((m.packing * Math.PI * diameter ** 2) / 4) * restLength) / segments / 2;
      assert.ok(Math.abs(Math.min(...nodes) - half) < 1e-18, `${Math.min(...nodes)} vs ${half}`);
      assert.equal(rows.length, segments);
      assert.equal(rows[0].stiffness, segments * CORD_LIMITS.maxStiffness);
      const w = await createPhysicsWorld(c);
      try {
        const start = total(w);
        let speed = 0;
        for (let i = 0; i < 2400; i++) {
          step(w);
          // Passive: mechanical energy may leave and must never exceed the start.
          assert.ok(total(w) <= start + 1e-9, `${corner} c=${damping} tick ${i}: ${total(w)}`);
          speed = Math.max(speed, ...w.read().map((b) => Math.hypot(...b.velocity)));
        }
        // No jitter: the transient stays at ordinary machine speeds and the run
        // ends inside the linear elastic domain, not at its bounded failure.
        assert.ok(speed < 2, `${corner} c=${damping} reached ${speed} m/s`);
        assert.ok(Math.max(...w.ropes().map((r) => r.strain)) < CORD_LIMITS.maxStrain / 2);
        assert.ok(total(w) < start, 'the transient dissipates');
        assert.ok(Math.abs(w.read()[1].velocity[1]) < 0.01, `${corner} c=${damping} unsettled`);
        // Exact continuation at the corner, not only mid-domain.
        const bytes = w.snapshot(),
          energy = w.mechanicalEnergy(),
          before = w.read();
        step(w);
        const expected = w.read();
        w.restore(bytes, energy);
        assert.deepEqual(w.read(), before);
        step(w);
        assert.deepEqual(w.read(), expected);
      } finally {
        w.dispose();
      }
    }
});
test('the stiffest authored corner is far outside the guided-spring budget and still converges', async () => {
  const c = configuration('stiffest', 0),
    row = c.joints.find((j) => j.kind === 'cord'),
    lightest = Math.min(...c.bodies.slice(2).map((b) => b.mass));
  // Measured 2026-09-17: per-row 2400 N/m on a 5.608e-5 kg end node is
  // dt^2 k W ~ 5.9e3, about 66000 times the 0.09 guided-spring island budget.
  // The rows are nonetheless stable because they are solved by an implicit
  // convex projection, not an explicit impulse. This documents the measurement
  // that justifies admitting the corner, and fails if either number moves.
  const trace = DT * DT * row.stiffness * (2 / lightest);
  assert.ok(trace > 1000 * CORD_LIMITS.elasticBudget, `${trace}`);
  assert.ok(trace < 1e5, `${trace}`);
  const w = await createPhysicsWorld(c);
  try {
    const start = total(w);
    let numericalJ = 0,
      dampingJ = 0;
    for (let i = 0; i < 1200; i++) {
      step(w);
      const ledger = w.ropeEnergy();
      numericalJ += ledger.ropeNumericalLossJ;
      dampingJ += ledger.ropeDampingWorkJ;
    }
    assert.ok(w.read().every((b) => b.position.every(Number.isFinite)));
    assert.ok(w.ropes().every((r) => Number.isFinite(r.appliedTension) && r.appliedTension >= 0));
    // With no authored damper the load still settles, and the ledger says why:
    // the implicit projection's own loss, reported through ropeNumericalLossJ and
    // never as damping work. Measured 2026-09-17: a 0.1148 J drop of which the
    // rows account for 0.0919 J; the rest leaves through the spherical anchors and
    // the node chain's own solve, which these rows do not claim to measure.
    const dropJ = start - total(w);
    assert.equal(dampingJ, 0, `an undamped cord reported ${dampingJ} J of damping work`);
    assert.ok(numericalJ > 0, `${numericalJ}`);
    assert.ok(dropJ >= numericalJ, `drop ${dropJ} is smaller than the rows' loss ${numericalJ}`);
    assert.ok(numericalJ > 0.6 * dropJ, `numerical ${numericalJ} of drop ${dropJ}`);
    assert.ok(Math.abs(w.read()[1].velocity[1]) < 0.01, 'the undamped corner settles the load');
  } finally {
    w.dispose();
  }
});
