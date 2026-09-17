// Bound-corner apparatus: one authored spur pair on a held carrier, compiled from ordinary
// parts so every mass, inertia and radius is the one the player's gear would produce. The
// pair is placed at exactly the derived centre distance, which is what admission demands, so
// the only thing that varies between corners is the authored tooth count, module and material.
//
// Nothing here is gear-specific engine behaviour: the carrier is an ordinary held cylinder,
// both bearings are ordinary revolute joints, and the mesh carries only the numbers
// compileGearMeshes would compile for the same pair.
import { createPart } from '../../src/model/blueprint.mjs';
import { compileBody } from '../../src/model/compile-body.mjs';
import { partPrimitives } from '../../src/model/geometry.mjs';
import { gearFacts } from '../../src/model/gear-geometry.mjs';

const DT = 1 / 120;

/** Author one spur gear exactly as a player would, then select its material per shape. */
export function authoredGear(id, teeth, module, material, position) {
  const part = createPart('spurGear', id, position);
  Object.assign(part.parameters, { teeth, module });
  if (material) part.authoredMaterial[partPrimitives(part)[0].id] = material;
  return part;
}

/** A held carrier, two authored gears on ordinary bearings, and the compiled mesh between them.
 *
 * @param {{teethA: number, teethB: number, module: number, material?: string}} pair
 */
export function gearBoundsFixture({ teethA, teethB, module, material = 'steel' }) {
  const a = authoredGear('driver', teethA, module, material, [0, 0, 0]),
    factsA = gearFacts(a),
    factsB = gearFacts(authoredGear('driven', teethB, module, material, [0, 0, 0])),
    centreDistance = factsA.pitchRadius + factsB.pitchRadius,
    b = authoredGear('driven', teethB, module, material, [0, centreDistance, 0]),
    bodyA = compileBody(a),
    bodyB = compileBody(b);
  const carrier = {
    shape: 'cylinder',
    position: [-0.05, 0, 0],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 10,
    halfExtents: [0.01, 0.02, 0.02],
    fixed: true,
    friction: 0,
    restitution: 0,
  };
  return {
    factsA,
    factsB,
    centreDistance,
    // Solid-cylinder inertia about the spin axis, the same expression the physics door builds
    // from the compiled half extents; the pitch-point mobility follows from it and is what
    // sets the mesh frequency, so both are derived here rather than restated per caller.
    inertiaA: (bodyA.mass * bodyA.halfExtents[1] ** 2) / 2,
    inertiaB: (bodyB.mass * bodyB.halfExtents[1] ** 2) / 2,
    massA: bodyA.mass,
    massB: bodyB.mass,
    config: {
      gravity: [0, 0, 0],
      bodies: [carrier, bodyA, bodyB],
      joints: [
        {
          kind: 'revolute',
          a: 0,
          b: 1,
          anchorA: [0.05, 0, 0],
          anchorB: [0, 0, 0],
          axisA: [1, 0, 0],
          axisB: [1, 0, 0],
        },
        {
          kind: 'revolute',
          a: 0,
          b: 2,
          anchorA: [0.05, centreDistance, 0],
          anchorB: [0, 0, 0],
          axisA: [1, 0, 0],
          axisB: [1, 0, 0],
        },
        {
          kind: 'gear',
          a: 1,
          b: 2,
          anchorA: [0, 0, 0],
          anchorB: [0, 0, 0],
          axisA: [1, 0, 0],
          axisB: [1, 0, 0],
          radiusA: factsA.pitchRadius,
          radiusB: factsB.pitchRadius,
          stiffness: factsA.stiffness,
          damping: factsA.damping,
        },
      ],
    },
  };
}

/** Pitch-point mobility and the tick-scaled mesh frequency it implies.
 *
 * The mesh solves `(I + dt (dt K + C) M) p = ...` at the pitch point, so the mode the tick has
 * to resolve is `omega = sqrt(K M)` with `M` the pitch-point mobility `rA^2/IA + rB^2/IB`. One
 * tick resolves the mode only while `omega dt` stays small; the product is therefore the single
 * number a bound corner has to be judged by, and it is derived, never stored.
 */
export function meshFrequency(fixture) {
  const mobility =
    fixture.factsA.pitchRadius ** 2 / fixture.inertiaA +
    fixture.factsB.pitchRadius ** 2 / fixture.inertiaB;
  const omega = Math.sqrt(fixture.factsA.stiffness * mobility);
  return {
    mobility,
    omega,
    omegaDt: omega * DT,
    dampingRatio: (fixture.factsA.damping * omega) / (2 * fixture.factsA.stiffness),
  };
}

/** One ordinary tick: prepared constraints, authored torques, the mesh solve, then integration. */
export function tickPair(world, driveTorque = 0, loadTorque = 0) {
  world.prepareConstraints();
  world.applyPreparedConstraints();
  if (driveTorque) world.applyTorquePair(0, 1, [1, 0, 0], driveTorque);
  if (loadTorque) world.applyTorquePair(0, 2, [1, 0, 0], loadTorque);
  const receipt = world.applyGears();
  world.step();
  return receipt;
}

/** Spin the driver up to a pitch-line speed so every corner is compared at the same duty.
 * A heavier pair simply takes more ticks to get there; the operating point is what matters.
 */
export function spinUpToPitchLineSpeed(world, fixture, force, speed) {
  let ticks = 0;
  while (world.jointState(0).speed * fixture.factsA.pitchRadius < speed) {
    if (++ticks > 100000) throw new Error('gear bounds spin-up did not reach the pitch-line speed');
    tickPair(world, 4 * force * fixture.factsA.pitchRadius);
  }
  return ticks;
}

/** Hold a corner at one transmitted force and one pitch-line speed, then read what it delivered.
 *
 * Driving the input at `force x rA` while loading the output at `force x rB` balances the mesh,
 * so the pair runs at a constant pitch-line force and speed. Input work is then identical across
 * corners by construction and any shortfall in delivered output work is the mesh losing it.
 */
export function measureTransmission(world, fixture, { force, ticks }) {
  let inputWorkJ = 0,
    outputWorkJ = 0,
    maximumRatioError = 0,
    maximumStrainM = 0,
    maximumDriftM = 0;
  const before = world.mechanicalEnergy(),
    startJ = before.kineticJ + before.gearPotentialJ,
    expectedRatio = -fixture.factsA.pitchRadius / fixture.factsB.pitchRadius,
    started = performance.now();
  for (let i = 0; i < ticks; i++) {
    tickPair(world, force * fixture.factsA.pitchRadius, force * fixture.factsB.pitchRadius);
    const input = world.jointState(0).speed,
      output = world.jointState(1).speed,
      mesh = world.gears()[0];
    inputWorkJ += force * fixture.factsA.pitchRadius * input * DT;
    outputWorkJ += force * fixture.factsB.pitchRadius * output * DT;
    maximumStrainM = Math.max(maximumStrainM, Math.abs(mesh.strain));
    maximumDriftM = Math.max(maximumDriftM, Math.abs(mesh.splitDriftM));
    // Skip the first tenth: the balanced load arrives as a step and the mesh has to load up.
    if (i > ticks / 10)
      maximumRatioError = Math.max(maximumRatioError, Math.abs(output / input - expectedRatio));
  }
  const costPerTickUs = ((performance.now() - started) / ticks) * 1000,
    after = world.mechanicalEnergy(),
    storedDeltaJ = after.kineticJ + after.gearPotentialJ - startJ;
  return {
    inputWorkJ,
    outputWorkJ,
    // Work the input put in that the output did not take out and the pair did not store.
    lostWorkJ: inputWorkJ + outputWorkJ - storedDeltaJ,
    lostWorkFraction: (inputWorkJ + outputWorkJ - storedDeltaJ) / inputWorkJ,
    maximumRatioError,
    maximumStrainM,
    maximumDriftM,
    costPerTickUs,
  };
}

/** Let a loaded corner coast: nothing drives or loads it, so a mesh that neither pumps nor
 * quietly bleeds work keeps the mechanical energy it started with.
 */
export function measureCoast(world, ticks) {
  const before = world.mechanicalEnergy(),
    startJ = before.kineticJ + before.gearPotentialJ;
  let maximumJ = startJ;
  for (let i = 0; i < ticks; i++) {
    tickPair(world);
    const energy = world.mechanicalEnergy();
    maximumJ = Math.max(maximumJ, energy.kineticJ + energy.gearPotentialJ);
  }
  const after = world.mechanicalEnergy(),
    endJ = after.kineticJ + after.gearPotentialJ;
  return { startJ, endJ, retained: endJ / startJ, growth: (maximumJ - startJ) / startJ };
}

/** The bound corners: both tooth extremes, both modules, and the lightest and heaviest pairing.
 *
 * The first row is the reference, not a corner: 12T against 24T in steel at module 0.01 is the
 * pair the shipped catalog offered before teeth became authorable, so it is the configuration
 * every bound corner is judged against rather than against an invented target.
 */
export const GEAR_BOUND_CORNERS = [
  { teethA: 12, teethB: 24, module: 0.01, material: 'steel', reference: true },
  { teethA: 12, teethB: 12, module: 0.01, material: 'steel' },
  { teethA: 12, teethB: 36, module: 0.01, material: 'steel' },
  { teethA: 36, teethB: 36, module: 0.01, material: 'steel' },
  { teethA: 18, teethB: 18, module: 0.01, material: 'steel' },
  { teethA: 12, teethB: 12, module: 0.005, material: 'steel' },
  { teethA: 12, teethB: 36, module: 0.005, material: 'steel' },
  { teethA: 36, teethB: 36, module: 0.005, material: 'steel' },
  { teethA: 18, teethB: 18, module: 0.005, material: 'steel' },
  // The lightest pair the catalog can author, and the largest in the lighter material.
  { teethA: 12, teethB: 12, module: 0.005, material: 'aluminium' },
  { teethA: 12, teethB: 36, module: 0.005, material: 'aluminium' },
  { teethA: 36, teethB: 36, module: 0.01, material: 'aluminium' },
];

/** The label a recorded corner carries, so the record and the test name the same case. */
export const cornerLabel = ({ teethA, teethB, module, material }) =>
  `${teethA}T/${teethB}T module ${module * 1000} mm ${material}`;
