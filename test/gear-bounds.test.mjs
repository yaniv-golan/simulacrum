// What the authored tooth-count and module bounds cost the mesh.
//
// One constant mesh stiffness now has to serve every pair the catalog admits, from 36T steel
// discs at module 0.01 to 12T aluminium discs at module 0.005. The pitch-point mobility across
// that set moves by more than an order of magnitude, so the mode the 1/120 s tick has to
// resolve does too. These checks hold each corner at the same transmitted force and the same
// pitch-line speed and read what it delivered, so the bounds are decided from measurements
// rather than from the one pair the constant was chosen for.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { gearCapacityFixture } from './fixtures/gear-capacity.mjs';
import {
  GEAR_BOUND_CORNERS,
  cornerLabel,
  gearBoundsFixture,
  measureCoast,
  measureTransmission,
  meshFrequency,
  spinUpToPitchLineSpeed,
  tickPair,
} from './fixtures/gear-bounds.mjs';

const DT = 1 / 120,
  FORCE_N = 2,
  PITCH_LINE_SPEED = 1,
  // The recorded mesh limits: one millimetre of elastic displacement and three percent of ratio
  // are what the registered endurance measurement already asserts, so a bound corner earns its
  // place by staying inside the same limits rather than inside looser ones written for it.
  STRAIN_LIMIT_M = 0.001,
  RATIO_LIMIT = 0.03;

test('every authored bound corner holds its ratio and its strain under load and gives the work back', async () => {
  const measured = [];
  for (const corner of GEAR_BOUND_CORNERS) {
    const fixture = gearBoundsFixture(corner),
      label = cornerLabel(corner),
      world = await createPhysicsWorld(fixture.config);
    try {
      spinUpToPitchLineSpeed(world, fixture, FORCE_N, PITCH_LINE_SPEED);
      const run = measureTransmission(world, fixture, { force: FORCE_N, ticks: 1200 }),
        coast = measureCoast(world, 1200);
      // The ratio is the authored one, not a compliance-dependent approximation of it.
      assert.ok(
        run.maximumRatioError < RATIO_LIMIT,
        `${label} ratio error ${run.maximumRatioError}`,
      );
      // Elastic displacement stays inside the recorded millimetre at every corner, so no corner
      // reaches the mesh's compliant domain limit by being small.
      assert.ok(run.maximumStrainM < STRAIN_LIMIT_M, `${label} strain ${run.maximumStrainM} m`);
      // The output takes out what the input put in: a corner whose mesh quietly ate the work
      // would show it here, because input work is identical across corners by construction.
      assert.ok(
        Math.abs(run.lostWorkFraction) < 0.01,
        `${label} lost ${run.lostWorkFraction} of the input work`,
      );
      // Backward Euler may dissipate; it may never pump. Measured growth is exactly zero at
      // every corner, so any growth at all is a defect and not a tolerance question.
      assert.ok(coast.growth <= 0, `${label} coast energy grew by ${coast.growth}`);
      assert.ok(coast.retained > 0.99, `${label} coast retained only ${coast.retained}`);
      measured.push({ label, ...run, ...coast, ...meshFrequency(fixture) });
    } finally {
      world.dispose();
    }
  }
  // The reference pair is the first row and must not be the worst of the set on either count:
  // if a bound corner ever beat the shipped pair on strain or ratio the comparison would be
  // measuring the apparatus rather than the bounds.
  const reference = measured[0];
  assert.equal(reference.label, '12T/24T module 10 mm steel');
  assert.ok(reference.maximumStrainM > 0, 'the reference pair must actually load its mesh');
  assert.ok(
    measured.every((row) => row.maximumRatioError < 100 * reference.maximumRatioError + 1e-6),
    'a bound corner tracks its ratio within two orders of magnitude of the reference pair',
  );
});

test('the bound set spans the mesh frequency the registered endurance apparatus already measures', () => {
  // Pitch-point mobility is rA^2/IA + rB^2/IB, so it is set by the authored radii and the
  // compiled masses and nothing else. With one constant stiffness the mode the tick must
  // resolve therefore moves with the authored pair, and this is the number that moves.
  const frequencies = GEAR_BOUND_CORNERS.map((corner) => ({
    label: cornerLabel(corner),
    ...meshFrequency(gearBoundsFixture(corner)),
  }));
  const products = frequencies.map((row) => row.omegaDt),
    slowest = Math.min(...products),
    fastest = Math.max(...products);
  // Recorded 2026-09-17: 0.661 at 36T/36T steel module 0.01 to 8.686 at 12T/12T aluminium
  // module 0.005. The span is the finding; the individual values anchor it.
  assert.ok(Math.abs(slowest - 0.661) < 0.01, `slowest mesh ${slowest}`);
  assert.ok(Math.abs(fastest - 8.686) < 0.01, `fastest mesh ${fastest}`);
  assert.ok(fastest / slowest > 10, `the bound span is ${fastest / slowest}`);

  // The envelope argument: the registered endurance apparatus runs eight coupled meshes on
  // 0.1 kg rotors, which is already a faster mesh than every parametric corner but the very
  // lightest, and it holds strain, split step and ratio for 7200 ticks. So the bounds do not
  // open a numeric regime nothing measures; they reach one already under measurement.
  const capacity = gearCapacityFixture({ bodies: 12 }),
    mesh = capacity.joints.find((joint) => joint.kind === 'gear'),
    inertia = (index) =>
      (capacity.bodies[index].mass * capacity.bodies[index].halfExtents[1] ** 2) / 2,
    capacityMobility = mesh.radiusA ** 2 / inertia(mesh.a) + mesh.radiusB ** 2 / inertia(mesh.b),
    capacityOmegaDt = DT * Math.sqrt(mesh.stiffness * capacityMobility);
  assert.ok(Math.abs(capacityOmegaDt - 8.55) < 0.05, `capacity apparatus mesh ${capacityOmegaDt}`);
  assert.ok(
    fastest < 1.05 * capacityOmegaDt,
    `the fastest bound corner ${fastest} must sit at the capacity apparatus mesh ${capacityOmegaDt}`,
  );
});

test('the mesh mode the tick represents is the warped one, which is why no corner can pump energy', async () => {
  // Backward Euler maps a mode of frequency omega onto atan(omega dt)/dt, which saturates
  // below a quarter turn of phase per tick however stiff the mesh gets. That is the reason the
  // fastest corner dissipates instead of diverging, and it is measurable: the ring-down of the
  // least damped corner must show the warped period, not the analytic one.
  const corner = { teethA: 36, teethB: 36, module: 0.01, material: 'steel' },
    fixture = gearBoundsFixture(corner),
    frequency = meshFrequency(fixture);
  assert.ok(frequency.dampingRatio < 0.05, `the control corner must be lightly damped`);
  const world = await createPhysicsWorld(fixture.config);
  let period = NaN;
  try {
    const strains = [];
    for (let i = 0; i < 400; i++) {
      tickPair(world, FORCE_N * fixture.factsA.pitchRadius, FORCE_N * fixture.factsB.pitchRadius);
      strains.push(world.gears()[0].strain);
    }
    const settled = strains.slice(200).reduce((sum, x) => sum + x, 0) / 200,
      crossings = [];
    for (let i = 1; i < 200; i++)
      if ((strains[i - 1] - settled) * (strains[i] - settled) < 0) crossings.push(i);
    assert.ok(crossings.length > 6, `the ring-down must oscillate: ${crossings.length} crossings`);
    period = (2 * (crossings.at(-1) - crossings[0])) / (crossings.length - 1);
    // Settled strain is the transmitted force over the mesh stiffness, independently: 2 N at
    // 20000 N/m is 0.1 mm, which also confirms the fixture really transmits the authored force.
    assert.ok(
      Math.abs(Math.abs(settled) - FORCE_N / fixture.factsA.stiffness) < 5e-6,
      `settled strain ${settled}`,
    );
  } finally {
    world.dispose();
  }
  const continuousTicks =
      (2 * Math.PI) / (frequency.omega * Math.sqrt(1 - frequency.dampingRatio ** 2)) / DT,
    warpedTicks = (2 * Math.PI) / Math.atan(frequency.omegaDt);
  assert.ok(
    Math.abs(period / warpedTicks - 1) < 0.05,
    `measured ${period} ticks against the warped ${warpedTicks}`,
  );
  // The wrong trace this excludes: reading the mesh mode straight off sqrt(K M) and ignoring
  // the warping predicts a period the engine does not produce.
  assert.ok(
    Math.abs(period / continuousTicks - 1) > 0.1,
    `the unwarped period ${continuousTicks} must not also fit ${period}`,
  );
});

test('a bound corner transmits the authored torque ratio in both directions and replays exactly', async () => {
  for (const corner of [
    { teethA: 12, teethB: 36, module: 0.01, material: 'steel' },
    { teethA: 12, teethB: 12, module: 0.005, material: 'aluminium' },
    { teethA: 36, teethB: 36, module: 0.01, material: 'steel' },
  ]) {
    const fixture = gearBoundsFixture(corner),
      label = cornerLabel(corner),
      ratio = -fixture.factsA.pitchRadius / fixture.factsB.pitchRadius;
    // A load lighter than the transmitted force lets the driver win; a heavier one drives the
    // pair backwards through the same mesh. The bracket is the torque transfer: if the mesh
    // carried anything other than force x radius the balance point would not be at one.
    for (const [scale, sign] of [
      [0.8, 1],
      [1.2, -1],
    ]) {
      const world = await createPhysicsWorld(fixture.config);
      try {
        for (let i = 0; i < 120; i++)
          tickPair(
            world,
            FORCE_N * fixture.factsA.pitchRadius,
            scale * FORCE_N * fixture.factsB.pitchRadius,
          );
        const input = world.jointState(0).speed,
          output = world.jointState(1).speed;
        assert.ok(sign * input > 0.05, `${label} load x${scale} input ${input}`);
        assert.ok(
          Math.abs(output / input - ratio) < RATIO_LIMIT,
          `${label} load x${scale} ratio ${output / input} against ${ratio}`,
        );
      } finally {
        world.dispose();
      }
    }
    // Determinism at the corner, not only at the shipped pair: the same checkpoint and the
    // same ticks must reproduce the same bytes however stiff the mesh is relative to the tick.
    const world = await createPhysicsWorld(fixture.config);
    try {
      spinUpToPitchLineSpeed(world, fixture, FORCE_N, PITCH_LINE_SPEED);
      const checkpoint = world.snapshot(),
        energy = world.mechanicalEnergy();
      for (let i = 0; i < 12; i++)
        tickPair(
          world,
          FORCE_N * fixture.factsA.pitchRadius,
          0.9 * FORCE_N * fixture.factsB.pitchRadius,
        );
      const expected = world.snapshot();
      world.restore(checkpoint, energy);
      for (let i = 0; i < 12; i++)
        tickPair(
          world,
          FORCE_N * fixture.factsA.pitchRadius,
          0.9 * FORCE_N * fixture.factsB.pitchRadius,
        );
      assert.deepEqual(world.snapshot(), expected, `${label} replay`);
    } finally {
      world.dispose();
    }
  }
});
