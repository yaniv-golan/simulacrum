import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import {
  CANNON_SOLVER_TRANSACTION_ID,
  CannonSolverTransaction,
} from "../src/simulation/cannon-solver-transaction.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { createYUpHeightfieldCandidateFilter } from "../src/simulation/heightfield-broadphase.js";

const source = fs.readFileSync(
  "src/simulation/cannon-solver-transaction.js",
  "utf8",
);
assert.doesNotMatch(source, /\.(?:step|internalStep)\s*\(/);

function run() {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material("transaction-fixture"),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Plane(),
    }),
    body = new CANNON.Body({
      mass: 2,
      material,
      shape: new CANNON.Sphere(0.25),
      position: new CANNON.Vec3(0, 1, 0),
    }),
    adapter = new CannonWorldAdapter(world, new CannonSolverTransaction(world));
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  world.addBody(body);
  let beginContacts = 0;
  world.addEventListener("beginContact", () => beginContacts++);
  adapter.beginSession();
  for (let tick = 1; tick <= 240; tick++) adapter.integrate(1 / 120, { tick });
  const telemetry = adapter.telemetry(),
    state = [
      body.position.x,
      body.position.y,
      body.position.z,
      body.quaternion.x,
      body.quaternion.y,
      body.quaternion.z,
      body.quaternion.w,
      body.velocity.x,
      body.velocity.y,
      body.velocity.z,
      world.time,
      world.stepnumber,
      beginContacts,
    ];
  assert.equal(telemetry.transactionId, CANNON_SOLVER_TRANSACTION_ID);
  assert.equal(telemetry.integrationCount, 240);
  assert.ok(Math.abs(world.time - 2) <= Number.EPSILON * 32, world.time);
  assert.equal(world.stepnumber, 240);
  assert.ok(beginContacts > 0);
  assert.ok(Math.abs(body.position.y - 0.25) < 0.01, body.position);
  return state;
}

assert.deepEqual(run(), run(), "owned solver transaction is nondeterministic");

function budgetedMotorRun() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    support = new CANNON.Body({ type: CANNON.Body.STATIC }),
    rotor = new CANNON.Body({
      mass: 2,
      shape: new CANNON.Cylinder(0.5, 0.5, 0.2, 16),
    }),
    hinge = new CANNON.HingeConstraint(support, rotor, {
      pivotA: new CANNON.Vec3(0, 0, 0),
      pivotB: new CANNON.Vec3(0, 0, 0),
      axisA: new CANNON.Vec3(0, 1, 0),
      axisB: new CANNON.Vec3(0, 1, 0),
    }),
    transaction = new CannonSolverTransaction(world),
    adapter = new CannonWorldAdapter(world, transaction),
    dt = 1 / 120;
  world.addBody(support);
  world.addBody(rotor);
  support.userData = { externalBodyId: "motor-support" };
  rotor.userData = { externalBodyId: "motor-rotor" };
  world.addConstraint(hinge);
  hinge.enableMotor();
  hinge.setMotorSpeed(1_000);
  hinge.motorEquation.minForce = -100;
  hinge.motorEquation.maxForce = 100;
  adapter.beginSession();
  transaction.registerMotorEnergyBudget({
    tick: 1,
    equation: hinge.motorEquation,
    partId: "motor",
    constraintId: "shaft",
    mode: "motoring",
    allocatedBusW: 120,
    mechanicalBudgetJ: 1,
    electricalEfficiency: 0.9,
    torqueImpulseLimitNms: 100,
  });
  adapter.integrate(dt, { tick: 1 });
  assert.throws(
    () => adapter.exportState(),
    /must settle|not settled/i,
    "checkpoint accepted an unsettled motor row",
  );
  const pending = transaction.motorEnergyRecordsForTick(1),
    [record] = pending.records;
  assert.ok(record.positiveMechanicalWorkJ <= 1 + 1e-9, record);
  assert.ok(record.positiveMechanicalWorkJ >= 1 - 1e-8, record);
  assert.ok(record.saturated, record);
  assert.ok(record.acceptedImpulseNms > 0, record);
  assert.ok(Number.isFinite(record.generalizedInverseMass), record);
  transaction.acknowledgeMotorEnergySettlement({
    tick: 1,
    recordDigest: pending.recordDigest,
  });
  assert.throws(
    () =>
      transaction.acknowledgeMotorEnergySettlement({
        tick: 1,
        recordDigest: pending.recordDigest,
      }),
    /acknowledgement/i,
    "motor records were acknowledged twice",
  );
  adapter.exportState();
  return {
    angularVelocity: rotor.angularVelocity.y,
    record,
    digest: pending.recordDigest,
  };
}

assert.deepEqual(
  budgetedMotorRun(),
  budgetedMotorRun(),
  "energy-budgeted motor row is nondeterministic",
);

const heightfieldCandidate = createYUpHeightfieldCandidateFilter({
    heights: [
      [0, 0],
      [0, 2],
    ],
    elementSize: 1,
    originX: 0,
    originZ: 1,
  }),
  candidateBody = (lower, upper) => ({
    aabbNeedsUpdate: false,
    aabb: {
      lowerBound: { x: lower[0], y: lower[1], z: lower[2] },
      upperBound: { x: upper[0], y: upper[1], z: upper[2] },
    },
  });
assert.equal(
  heightfieldCandidate(candidateBody([0.1, 2.1, 0.1], [0.9, 2.4, 0.9])),
  false,
  "body strictly above local terrain was not rejected",
);
assert.equal(
  heightfieldCandidate(candidateBody([0.1, 1.5, 0.1], [0.9, 2.1, 0.9])),
  true,
  "body overlapping a local terrain peak was rejected",
);
assert.equal(
  heightfieldCandidate(candidateBody([2, -1, 2], [3, 1, 3])),
  false,
  "body outside the finite terrain footprint was not rejected",
);
console.log("owned production Cannon solver transaction passed");
