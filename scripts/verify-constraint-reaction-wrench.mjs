import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import {
  assignConstraintEvidenceRows,
  constraintReactionContributions,
  constraintReactionWrench,
  constraintReactionWrenchEvidence,
} from "../src/simulation/constraint-reaction-wrench.js";

const DT = 1 / 120;

function near(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

function exactWrenchProbe() {
  const bodyA = new CANNON.Body({ mass: 1 }),
    bodyB = new CANNON.Body({ mass: 1 }),
    constraint = {
      bodyA,
      bodyB,
      pivotA: new CANNON.Vec3(1, 2, 3),
      pivotB: new CANNON.Vec3(-2, 1, 4),
      equations: [
        {
          enabled: true,
          multiplier: 2,
          jacobianElementA: {
            spatial: new CANNON.Vec3(3, 4, 5),
            rotational: new CANNON.Vec3(11, 13, 17),
          },
          jacobianElementB: {
            spatial: new CANNON.Vec3(-1, 2, -3),
            rotational: new CANNON.Vec3(5, -7, 9),
          },
        },
        {
          enabled: false,
          multiplier: 100,
          jacobianElementA: {
            spatial: new CANNON.Vec3(100, 100, 100),
            rotational: new CANNON.Vec3(100, 100, 100),
          },
          jacobianElementB: {
            spatial: new CANNON.Vec3(100, 100, 100),
            rotational: new CANNON.Vec3(100, 100, 100),
          },
        },
        {
          enabled: true,
          multiplier: Number.NaN,
          jacobianElementA: {
            spatial: new CANNON.Vec3(20, 30, 40),
            rotational: new CANNON.Vec3(50, 60, 70),
          },
          jacobianElementB: {
            spatial: new CANNON.Vec3(20, 30, 40),
            rotational: new CANNON.Vec3(50, 60, 70),
          },
        },
        { enabled: true, multiplier: 3 },
      ],
    },
    wrenchA = constraintReactionWrench(constraint),
    wrenchB = constraintReactionWrench(constraint, "B");
  assignConstraintEvidenceRows(constraint, {
    constraintId: "fixture-constraint",
    sourceConnectionIds: ["fixture-connection"],
    tick: 12,
  });
  const contributions = constraintReactionContributions(constraint, "A", {
      tick: 12,
    }),
    sum = contributions.reduce(
      (total, row) => ({
        force: {
          x: total.force.x + row.forceWorldN.x,
          y: total.force.y + row.forceWorldN.y,
          z: total.force.z + row.forceWorldN.z,
        },
        moment: {
          x: total.moment.x + row.momentAtApplicationPointWorldNm.x,
          y: total.moment.y + row.momentAtApplicationPointWorldNm.y,
          z: total.moment.z + row.momentAtApplicationPointWorldNm.z,
        },
      }),
      {
        force: { x: 0, y: 0, z: 0 },
        moment: { x: 0, y: 0, z: 0 },
      },
    );
  assert.deepEqual(sum.force, wrenchA.force);
  assert.deepEqual(sum.moment, wrenchA.moment);
  assert.equal(contributions.length, 2);
  assert.match(contributions[0].rowId, /^constraint:12:fixture-constraint:A:/u);
  assert.match(
    constraintReactionContributions(constraint, "B", { tick: 12 })[0].rowId,
    /^constraint:12:fixture-constraint:B:/u,
  );
  assert.deepEqual(contributions[0].sourceConnectionIds, [
    "fixture-connection",
  ]);
  assert.deepEqual(wrenchA.force, { x: 6, y: 8, z: 10 });
  assert.deepEqual(wrenchA.moment, { x: 26, y: 18, z: 38 });
  near(wrenchA.forceN, Math.sqrt(200), 1e-12, "exact side-A force");
  near(wrenchA.torqueNm, Math.sqrt(2444), 1e-12, "exact side-A torque");
  assert.deepEqual(wrenchB.force, { x: -2, y: 4, z: -6 });
  assert.deepEqual(wrenchB.moment, { x: 32, y: 6, z: 24 });
  near(wrenchB.forceN, Math.sqrt(56), 1e-12, "exact side-B force");
  near(wrenchB.torqueNm, Math.sqrt(1636), 1e-12, "exact side-B torque");
  assert.throws(
    () => constraintReactionWrench(constraint, "C"),
    /Unknown constraint wrench side C/,
  );
  assert.throws(
    () => constraintReactionContributions(constraint, "C"),
    /Unknown constraint wrench side C/,
  );
}

function axialAnchorProbe() {
  const bodyA = new CANNON.Body({ mass: 1 }),
    bodyB = new CANNON.Body({ mass: 1 }),
    localAnchorA = new CANNON.Vec3(1, 2, 3),
    localAnchorB = new CANNON.Vec3(-1, -2, -3),
    equationAnchorA = new CANNON.Vec3(2, -1, 4),
    equationAnchorB = new CANNON.Vec3(-4, 3, 1),
    forceA = new CANNON.Vec3(4, -5, 6),
    forceB = new CANNON.Vec3(-3, 7, 2),
    momentA = equationAnchorA.cross(forceA),
    momentB = equationAnchorB.cross(forceB),
    constraint = {
      bodyA,
      bodyB,
      localAnchorA,
      localAnchorB,
      equations: [
        {
          enabled: true,
          multiplier: 11,
          ri: equationAnchorA,
          rj: equationAnchorB,
          jacobianElementA: { spatial: forceA, rotational: momentA },
          jacobianElementB: { spatial: forceB, rotational: momentB },
        },
      ],
    };
  for (const side of ["A", "B"]) {
    const wrench = constraintReactionWrench(constraint, side);
    near(wrench.torqueNm, 0, 1e-12, `axial ${side} row force moment`);
  }

  // Custom equations can omit ri/rj. Their constraint-level local anchor must
  // still prevent an offset axial force from becoming a fictional torque.
  delete constraint.equations[0].ri;
  delete constraint.equations[0].rj;
  constraint.equations[0].jacobianElementA.rotational =
    localAnchorA.cross(forceA);
  constraint.equations[0].jacobianElementB.rotational =
    localAnchorB.cross(forceB);
  for (const side of ["A", "B"]) {
    const wrench = constraintReactionWrench(constraint, side);
    near(wrench.torqueNm, 0, 1e-12, `axial ${side} local-anchor fallback`);
  }

  const anchorless = constraintReactionWrench({
    bodyA,
    equations: [
      {
        enabled: true,
        multiplier: 2,
        jacobianElementA: {
          spatial: new CANNON.Vec3(1, 0, 0),
          rotational: new CANNON.Vec3(0, 3, 4),
        },
      },
    ],
  });
  assert.deepEqual(anchorless.force, { x: 2, y: 0, z: 0 });
  assert.deepEqual(anchorless.moment, { x: 0, y: 6, z: 8 });

  assert.doesNotThrow(() =>
    constraintReactionWrench({
      bodyA: {},
      localAnchorA,
      equations: [
        {
          enabled: true,
          multiplier: 1,
          jacobianElementA: {
            spatial: new CANNON.Vec3(1, 0, 0),
            rotational: new CANNON.Vec3(0, 0, 0),
          },
        },
      ],
    }),
  );
}

function authoredLockWrenchProbe() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    shape = new CANNON.Box(new CANNON.Vec3(0.3, 0.2, 0.1)),
    bodyA = new CANNON.Body({
      mass: 2,
      shape,
      position: new CANNON.Vec3(0, 0, 0),
    }),
    bodyB = new CANNON.Body({
      mass: 3,
      shape,
      position: new CANNON.Vec3(2, 0, 0),
    }),
    constraint = new CANNON.LockConstraint(bodyA, bodyB, { maxForce: 1e9 }),
    authoredPoint = new CANNON.Vec3(1, 0.5, 0);
  bodyA.pointToLocalFrame(authoredPoint, constraint.pivotA);
  bodyB.pointToLocalFrame(authoredPoint, constraint.pivotB);
  Object.assign(world.solver, { iterations: 100, tolerance: 1e-12 });
  for (const body of [bodyA, bodyB]) {
    body.linearDamping = 0;
    body.angularDamping = 0;
    world.addBody(body);
  }
  world.addConstraint(constraint);
  bodyB.force.set(0, 100, 25);
  world.step(DT);

  const wrenchA = constraintReactionWrench(constraint, "A"),
    endpoint = { x: 0, y: 0.5, z: 0 },
    endpointEvidence = constraintReactionWrenchEvidence(constraint, "A", {
      sourceConnectionIds: ["endpoint-a"],
      applicationPointWorldM: endpoint,
    }),
    solvedPoint = bodyA.previousPosition.vadd(
      bodyA.previousQuaternion.vmult(constraint.pivotA),
    ),
    referenceToEndpoint = {
      x: solvedPoint.x - endpoint.x,
      y: solvedPoint.y - endpoint.y,
      z: solvedPoint.z - endpoint.z,
    },
    force = endpointEvidence.wrench.force,
    translatedMoment = {
      x:
        wrenchA.moment.x +
        referenceToEndpoint.y * force.z -
        referenceToEndpoint.z * force.y,
      y:
        wrenchA.moment.y +
        referenceToEndpoint.z * force.x -
        referenceToEndpoint.x * force.z,
      z:
        wrenchA.moment.z +
        referenceToEndpoint.x * force.y -
        referenceToEndpoint.y * force.x,
    };
  assert.ok(wrenchA.forceN > 1, "authored lock carried no solved reaction");
  for (const component of ["x", "y", "z"])
    near(
      endpointEvidence.wrench.moment[component],
      translatedMoment[component],
      1e-10,
      `translated endpoint moment ${component}`,
    );
  assert.ok(endpointEvidence.candidates.length > 0);
  assert.ok(
    endpointEvidence.candidates.every(
      (candidate) =>
        candidate.sourceConnectionIds.length === 1 &&
        candidate.sourceConnectionIds[0] === "endpoint-a",
    ),
    "endpoint evidence retained constraint-wide source IDs",
  );
}

function hingeProbe({ force = null, torque = null }) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    shape = new CANNON.Box(new CANNON.Vec3(0.5, 0.4, 0.3)),
    bodyA = new CANNON.Body({ mass: 2, shape }),
    bodyB = new CANNON.Body({ mass: 3, shape }),
    hinge = new CANNON.HingeConstraint(bodyA, bodyB, {
      axisA: new CANNON.Vec3(1, 0, 0),
      axisB: new CANNON.Vec3(1, 0, 0),
      pivotA: new CANNON.Vec3(0, 0, 0),
      pivotB: new CANNON.Vec3(0, 0, 0),
      maxForce: 1e9,
    });
  Object.assign(world.solver, { iterations: 80, tolerance: 1e-10 });
  for (const body of [bodyA, bodyB]) {
    body.linearDamping = 0;
    body.angularDamping = 0;
    world.addBody(body);
  }
  world.addConstraint(hinge);
  for (let tick = 0; tick < 30; tick++) {
    if (force) bodyB.force.set(force.x, force.y, force.z);
    if (torque) bodyB.torque.set(torque.x, torque.y, torque.z);
    world.step(DT);
  }
  return { bodyA, bodyB, hinge, wrench: constraintReactionWrench(hinge) };
}

const forceMagnitudeN = 100,
  forceProbe = hingeProbe({ force: new CANNON.Vec3(0, forceMagnitudeN, 0) }),
  expectedForceN =
    (forceMagnitudeN * forceProbe.bodyA.mass) /
    (forceProbe.bodyA.mass + forceProbe.bodyB.mass);
near(forceProbe.wrench.force.y, expectedForceN, 0.6, "constrained force");
near(forceProbe.wrench.force.x, 0, 0.05, "orthogonal force x");
near(forceProbe.wrench.force.z, 0, 0.05, "orthogonal force z");
near(forceProbe.wrench.torqueNm, 0, 0.05, "force-only anchor moment");

const constrainedTorqueNm = 60,
  torqueProbe = hingeProbe({
    torque: new CANNON.Vec3(0, constrainedTorqueNm, 0),
  }),
  inertiaA = torqueProbe.bodyA.inertia.y,
  inertiaB = torqueProbe.bodyB.inertia.y,
  expectedTorqueNm = (constrainedTorqueNm * inertiaA) / (inertiaA + inertiaB);
near(torqueProbe.wrench.moment.y, expectedTorqueNm, 0.6, "constrained torque");
near(torqueProbe.wrench.forceN, 0, 0.05, "torque-only force");

const freeTorqueProbe = hingeProbe({ torque: new CANNON.Vec3(60, 0, 0) });
near(freeTorqueProbe.wrench.torqueNm, 0, 0.05, "free-axis torque reaction");

exactWrenchProbe();
axialAnchorProbe();
authoredLockWrenchProbe();

console.log(
  `constraint reaction wrench passed (${forceProbe.wrench.forceN.toFixed(2)} N force, ${torqueProbe.wrench.torqueNm.toFixed(2)} Nm constrained torque)`,
);
