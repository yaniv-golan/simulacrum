import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { cannonCollisionExclusionRegistered } from "../src/simulation/cannon-solver-transaction.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120,
  STRONG = { ultimateForceN: 2_000_000, ultimateTorqueNm: 500_000 },
  WEAK = { ultimateForceN: 1_200, ultimateTorqueNm: 250 };

const assembly = {
  revision: 4,
  parts: [
    {
      id: 1,
      type: "beam",
      pos: [-1.25, 0, 0],
      orientation: [0, 0, 0, 1],
      config: { linearDamping: 0, angularDamping: 0 },
    },
    {
      id: 2,
      type: "beam",
      pos: [-0.65, 0.2, 0],
      orientation: [0, 0, 0, 1],
      config: { linearDamping: 0, angularDamping: 0 },
    },
    {
      id: 3,
      type: "beam",
      pos: [-0.25, 0, 0],
      orientation: [0, 0, 0, 1],
      config: { linearDamping: 0, angularDamping: 0 },
    },
    {
      id: 4,
      type: "beam",
      pos: [1.15, 0, 0],
      orientation: [0, 0, 0, 1],
      config: { linearDamping: 0, angularDamping: 0 },
    },
  ],
  connections: [
    {
      id: "loop-12",
      a: 1,
      b: 2,
      kind: "mechanical",
      portA: "SURFACE",
      portB: "SURFACE",
      anchorA: [0.3, 0.1, 0],
      anchorB: [-0.3, -0.1, 0],
      capacity: STRONG,
    },
    {
      id: "loop-23",
      a: 2,
      b: 3,
      kind: "mechanical",
      portA: "SURFACE",
      portB: "SURFACE",
      anchorA: [0.2, -0.1, 0],
      anchorB: [-0.2, 0.1, 0],
      capacity: STRONG,
    },
    {
      id: "loop-31",
      a: 3,
      b: 1,
      kind: "mechanical",
      portA: "SURFACE",
      portB: "SURFACE",
      anchorA: [-0.25, 0, 0],
      anchorB: [0.75, 0, 0],
      capacity: STRONG,
    },
    {
      id: "weak-link",
      a: 1,
      b: 4,
      kind: "mechanical",
      portA: "SURFACE",
      portB: "SURFACE",
      anchorA: [1.2, 0, 0],
      anchorB: [-1.2, 0, 0],
      capacity: WEAK,
    },
  ],
};

function linearMomentum(bodies) {
  return bodies.reduce(
    (sum, body) => sum.vadd(body.velocity.scale(body.mass)),
    new CANNON.Vec3(),
  );
}

function kineticEnergy(bodies) {
  return bodies.reduce((sum, body) => {
    const localAngularVelocity = body.quaternion
        .conjugate(new CANNON.Quaternion())
        .vmult(body.angularVelocity),
      rotational =
        0.5 *
        (body.inertia.x * localAngularVelocity.x ** 2 +
          body.inertia.y * localAngularVelocity.y ** 2 +
          body.inertia.z * localAngularVelocity.z ** 2);
    return sum + 0.5 * body.mass * body.velocity.lengthSquared() + rotational;
  }, 0);
}

function failureTickProbe({
  mode,
  speedMPerS = 0,
  weakForceN = WEAK.ultimateForceN,
  weakTorqueNm = WEAK.ultimateTorqueNm,
  appliedForceN = 0,
}) {
  const probeAssembly = structuredClone(assembly);
  probeAssembly.connections.find(
    (connection) => connection.id === "weak-link",
  ).capacity = {
    ultimateForceN: weakForceN,
    ultimateTorqueNm: weakTorqueNm,
  };
  const probeWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  probeWorld.solver.iterations = 50;
  probeWorld.solver.tolerance = 1e-9;
  probeWorld.defaultContactMaterial.friction = 0;
  probeWorld.defaultContactMaterial.restitution = 0.05;
  const probeMaterial = new CANNON.Material("f13-sweep-material"),
    probeAdapter = new CannonWorldAdapter(probeWorld),
    probeRuntime = new MultibodyRuntime({
      world: probeWorld,
      worldAdapter: probeAdapter,
      material: probeMaterial,
      catalog: TYPES,
      fixedDt: DT,
    }),
    probeImpactor =
      mode === "dynamic"
        ? new CANNON.Body({
            mass: 600,
            material: probeMaterial,
            shape: new CANNON.Box(new CANNON.Vec3(0.2, 2, 2)),
            position: new CANNON.Vec3(3.2, 0, 0),
          })
        : null;
  if (probeImpactor) {
    probeImpactor.linearDamping = 0;
    probeImpactor.angularDamping = 0;
    probeImpactor.allowSleep = false;
    probeWorld.addBody(probeImpactor);
  }
  probeRuntime.start(JSON.stringify(probeAssembly));
  const probeSession = new SimulationSession({
    systems: [
      new RigidBodySystem(),
      new StructureSystem(),
      new TelemetrySystem(),
    ],
  }).start(probeAssembly, {
    world: probeWorld,
    worldAdapter: probeAdapter,
    catalog: TYPES,
    multibodyRuntime: probeRuntime,
    connectionValid: (connection) => !connection.failed,
  });
  if (mode === "dynamic")
    for (const body of probeRuntime.bodyByPart.values())
      body.velocity.set(speedMPerS, 0, 0);
  let failureTick = null;
  for (let tick = 1; tick <= 360; tick++) {
    if (mode === "static")
      probeRuntime.bodyByPart.get(4).force.set(appliedForceN, 0, 0);
    probeSession.stepFixed();
    if (
      probeSession
        .telemetry()
        .systems.structures?.newlyFailed?.includes("weak-link")
    ) {
      failureTick = tick;
      break;
    }
  }
  if (failureTick)
    assert.deepEqual(
      probeSession.context.runGraph.events().map((event) => ({
        failed: event.failedConnectionIds,
        detached: event.detachedPartIds,
        tick: Math.round(event.time / DT),
      })),
      [{ failed: ["weak-link"], detached: [4], tick: failureTick }],
      "parameter sweep did not commit failure atomically",
    );
  else {
    assert.equal(
      probeSession.context.runGraph.connection("weak-link").failed,
      false,
      "subcritical sweep failed the weak link",
    );
    assert.deepEqual(
      probeSession.context.runGraph.events(),
      [],
      "subcritical sweep emitted a structural event",
    );
  }
  for (const entry of probeRuntime.constraintEntries.filter((candidate) =>
    candidate.descriptor.sourceConnectionIds?.some((id) =>
      id.startsWith("loop-"),
    ),
  ))
    assert.notEqual(
      entry.active,
      false,
      "parameter sweep damaged the strong closed loop",
    );
  probeSession.dispose();
  probeRuntime.dispose();
  if (probeImpactor) probeWorld.removeBody(probeImpactor);
  return failureTick;
}

function deterministicFailureTick(options) {
  const first = failureTickProbe(options),
    second = failureTickProbe(options);
  assert.equal(
    second,
    first,
    `failure tick was nondeterministic for ${JSON.stringify(options)}`,
  );
  return first;
}

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
world.solver.iterations = 50;
world.solver.tolerance = 1e-9;
world.defaultContactMaterial.friction = 0;
world.defaultContactMaterial.restitution = 0.05;
const material = new CANNON.Material("f13-material"),
  impactor = new CANNON.Body({
    mass: 600,
    material,
    shape: new CANNON.Box(new CANNON.Vec3(0.2, 2, 2)),
    position: new CANNON.Vec3(3.2, 0, 0),
  }),
  adapter = new CannonWorldAdapter(world),
  runtime = new MultibodyRuntime({
    world,
    worldAdapter: adapter,
    material,
    catalog: TYPES,
    fixedDt: DT,
  });
impactor.linearDamping = 0;
impactor.angularDamping = 0;
impactor.allowSleep = false;
world.addBody(impactor);
runtime.start(JSON.stringify(assembly));

assert.equal(
  runtime.compiled.constraints.filter((entry) => entry.kind === "fixed").length,
  4,
  "F13 did not compile the three-edge closed loop plus weak attachment",
);
assert.equal(
  runtime.collisionExclusionConstraints.filter(
    (entry) => [2, 3].includes(entry.descriptor.a) && entry.descriptor.b === 4,
  ).length,
  2,
  "F13 did not compile indirect cargo/loop collision exclusions",
);

const session = new SimulationSession({
  systems: [
    new RigidBodySystem(),
    new StructureSystem(),
    new TelemetrySystem(),
  ],
}).start(assembly, {
  world,
  worldAdapter: adapter,
  catalog: TYPES,
  multibodyRuntime: runtime,
  connectionValid: (connection) => !connection.failed,
});

for (const body of runtime.bodyByPart.values()) body.velocity.set(6, 0, 0);
const conservedBodies = [...runtime.bodyByPart.values(), impactor],
  initialMomentum = linearMomentum(conservedBodies),
  initialEnergyJ = kineticEnergy(conservedBodies);
let failureTick = null,
  failureTelemetry = null;
for (let tick = 1; tick <= 360; tick++) {
  session.stepFixed();
  const structures = session.telemetry().systems.structures;
  if (structures?.newlyFailed?.includes("weak-link")) {
    failureTick = tick;
    failureTelemetry = structures;
    break;
  }
}

assert.ok(failureTick, "dynamic collision did not fail the authored weak link");
assert.deepEqual(
  session.context.runGraph.events().map((event) => ({
    failed: event.failedConnectionIds,
    detached: event.detachedPartIds,
    tick: Math.round(event.time / DT),
  })),
  [{ failed: ["weak-link"], detached: [4], tick: failureTick }],
  "failure and detachment were not one committed structural event",
);
assert.equal(session.context.runGraph.connection("weak-link").failed, true);
assert.equal(session.context.runGraph.part(4).detached, true);
assert.deepEqual(failureTelemetry.detachedPartIds, [4]);

const weakConstraint = runtime.constraintEntries.find((entry) =>
    entry.descriptor.sourceConnectionIds?.includes("weak-link"),
  ),
  cargoExclusions = runtime.collisionExclusionConstraints.filter(
    (entry) => entry.descriptor.a === 4 || entry.descriptor.b === 4,
  );
assert.equal(weakConstraint.active, false);
assert.equal(world.constraints.includes(weakConstraint.constraint), false);
assert.ok(cargoExclusions.length >= 2);
for (const exclusion of cargoExclusions) {
  assert.equal(exclusion.active, false);
  assert.ok(exclusion.exclusion.bodyA && exclusion.exclusion.bodyB);
  assert.equal(
    cannonCollisionExclusionRegistered(
      runtime.worldAdapter.transaction,
      exclusion.exclusion,
    ),
    false,
    "failed connection retained its collision exclusion",
  );
}
for (const entry of runtime.constraintEntries.filter((candidate) =>
  candidate.descriptor.sourceConnectionIds?.some((id) =>
    id.startsWith("loop-"),
  ),
))
  assert.notEqual(
    entry.active,
    false,
    "closed-loop constraint was collateral damage",
  );

session.stepFixed(120);
const finalMomentum = linearMomentum(conservedBodies),
  momentumErrorNs = finalMomentum.vsub(initialMomentum).length(),
  finalEnergyJ = kineticEnergy(conservedBodies);
assert.ok(
  momentumErrorNs <= Math.max(1e-5, initialMomentum.length() * 1e-9),
  JSON.stringify({ initialMomentum, finalMomentum, momentumErrorNs }),
);
assert.ok(
  finalEnergyJ <= initialEnergyJ + Math.max(0.01, initialEnergyJ * 1e-6),
  JSON.stringify({ initialEnergyJ, finalEnergyJ }),
);

const cargo = runtime.bodyByPart.get(4),
  loopBody = runtime.bodyByPart.get(2);
impactor.position.set(100, 0, 0);
impactor.velocity.set(0, 0, 0);
cargo.position.copy(loopBody.position);
cargo.quaternion.copy(loopBody.quaternion);
cargo.velocity.set(0, 0, 0);
cargo.angularVelocity.set(0, 0, 0);
loopBody.velocity.set(0, 0, 0);
loopBody.angularVelocity.set(0, 0, 0);
session.stepFixed();
assert.ok(
  world.contacts.some(
    (contact) =>
      (contact.bi === cargo && contact.bj === loopBody) ||
      (contact.bi === loopBody && contact.bj === cargo),
  ),
  "detached body remained globally masked or pair-excluded from its former assembly",
);

const dynamicSweep = [1_200, 10_000, 100_000, 1_000_000].map((weakForceN) => ({
    weakForceN,
    failureTick: deterministicFailureTick({
      mode: "dynamic",
      speedMPerS: 6,
      weakForceN,
      weakTorqueNm: weakForceN * (WEAK.ultimateTorqueNm / WEAK.ultimateForceN),
    }),
  })),
  speedSweep = [1, 2, 4, 6, 8].map((speedMPerS) => ({
    speedMPerS,
    failureTick: deterministicFailureTick({
      mode: "dynamic",
      speedMPerS,
      weakForceN: 10_000,
      weakTorqueNm: 10_000 * (WEAK.ultimateTorqueNm / WEAK.ultimateForceN),
    }),
  })),
  staticSweep = [600, 1_200, 2_400, 4_800].map((appliedForceN) => ({
    appliedForceN,
    failureTick: deterministicFailureTick({ mode: "static", appliedForceN }),
  }));
assert.deepEqual(
  dynamicSweep.map((result) => Boolean(result.failureTick)),
  [true, true, false, false],
  `dynamic capacity sweep did not expose a fail/survive boundary: ${JSON.stringify(dynamicSweep)}`,
);
assert.equal(speedSweep[0].failureTick, null);
assert.ok(
  speedSweep
    .slice(1)
    .every(
      (result, index, failures) =>
        result.failureTick &&
        (!index || result.failureTick < failures[index - 1].failureTick),
    ),
  `dynamic speed sweep did not produce an ordered impact boundary: ${JSON.stringify(speedSweep)}`,
);
assert.deepEqual(
  staticSweep.map((result) => Boolean(result.failureTick)),
  [false, false, true, true],
  `static load sweep did not expose a fail/survive boundary: ${JSON.stringify(staticSweep)}`,
);

console.log(
  `collision failure sweeps passed (${dynamicSweep.length} capacities, ${speedSweep.length} speeds, ${staticSweep.length} static loads; baseline tick ${failureTick}, momentum error ${momentumErrorNs.toExponential(2)} N*s)`,
);
session.dispose();
runtime.dispose();
world.removeBody(impactor);
