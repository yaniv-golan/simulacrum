import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import {
  CANNON_SOLVER_TRANSACTION_ID,
  CannonSolverTransaction,
  cannonSolverTransactionResourceState,
} from "../src/simulation/cannon-solver-transaction.js";
import {
  CannonWorldAdapter,
  completedWorldEvidenceContributions,
  configureCannonWorldSolverProfile,
  readCannonSolverProfileAuthority,
  requestWorldEvidenceCapture,
} from "../src/simulation/cannon-world-adapter.js";
import { createYUpHeightfieldCandidateFilter } from "../src/simulation/heightfield-broadphase.js";
import {
  registerRollingSupport,
  unregisterRollingSupport,
} from "../src/simulation/rolling-support-registration.js";

const source = fs.readFileSync(
  "src/simulation/cannon-solver-transaction.js",
  "utf8",
);
assert.doesNotMatch(source, /\bworld\.(?:step|internalStep)\s*\(/);

{
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.solver.iterations = 30;
  world.solver.tolerance = 2e-4;
  configureCannonWorldSolverProfile(world, {
    fixedDt: 1 / 120,
    iterations: 30,
    tolerance: 2e-4,
  });
  const adapter = new CannonWorldAdapter(
    world,
    new CannonSolverTransaction(world),
  );
  assert.throws(
    () => adapter.exportState(),
    (error) => error?.code === "INVALID_CANNON_WORLD_CHECKPOINT_COUNTER",
    "adapter exported an unreachable pre-session checkpoint",
  );
  assert.deepEqual(readCannonSolverProfileAuthority(adapter), {
    fixedDt: 1 / 120,
    iterations: 30,
    tolerance: 2e-4,
  });
  adapter.beginSession(1 / 120);
  const checkpoint = adapter.exportState();
  assert.deepEqual(checkpoint.solverProfile, {
    fixedDt: 1 / 120,
    iterations: 30,
    tolerance: 2e-4,
  });
  world.solver.iterations = 1;
  world.solver.tolerance = 0.5;
  assert.throws(
    () => adapter.exportState(),
    /solver configuration diverged/i,
    "checkpoint capture ignored live solver-profile mutation",
  );
  assert.throws(
    () => adapter.integrate(1 / 120, { tick: 1 }),
    /solver configuration diverged/i,
    "integration accepted unattested live solver-profile mutation",
  );
  assert.equal(adapter.telemetry().tick, 0);
  adapter.importState(checkpoint);
  assert.equal(world.solver.iterations, 30);
  assert.equal(world.solver.tolerance, 2e-4);
  assert.deepEqual(adapter.exportState(), checkpoint);
  const forgedProfile = structuredClone(checkpoint);
  forgedProfile.solverProfile.iterations = 1;
  assert.throws(
    () => adapter.validateState(JSON.stringify(forgedProfile)),
    /solver profile does not match/i,
    "checkpoint accepted a different finite-iteration solver profile",
  );
  const unreachableCounters = structuredClone(checkpoint);
  unreachableCounters.tick = 0;
  unreachableCounters.integratedTick = 100;
  unreachableCounters.integrationCount = 1;
  assert.throws(
    () => adapter.validateState(JSON.stringify(unreachableCounters)),
    (error) => error?.code === "INVALID_CANNON_CHECKPOINT_COUNTER_RELATION",
    "checkpoint accepted unreachable Cannon counter relationships",
  );
  assert.throws(
    () => adapter.integrate(1 / 60, { tick: 1 }),
    /solver configuration diverged/i,
    "integration accepted a fixed step outside solver-profile authority",
  );
  assert.equal(adapter.telemetry().tick, 0);
  adapter.dispose();
}

{
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(0.25),
    });
  body.userData = {
    externalBodyId: "canonical-quaternion-body",
    checkpointPolicy: "world-kinematics-v1",
  };
  body.quaternion.setFromEuler(0.4, -0.2, 0.7);
  body.previousQuaternion.copy(body.quaternion);
  body.interpolatedQuaternion.copy(body.quaternion);
  world.addBody(body);
  const adapter = new CannonWorldAdapter(world);
  adapter.beginSession();
  const liveOrientation = () =>
    ["quaternion", "previousQuaternion", "interpolatedQuaternion"].map(
      (field) => ({
        x: body[field].x,
        y: body[field].y,
        z: body[field].z,
        w: body[field].w,
      }),
    );
  const beforeCapture = liveOrientation(),
    checkpoint = adapter.exportState(),
    baseline = structuredClone(checkpoint),
    forged = structuredClone(checkpoint),
    record = forged.externalBodies[0];
  assert.deepEqual(
    liveOrientation(),
    beforeCapture,
    "checkpoint capture silently projected live external orientations",
  );
  adapter.importState(checkpoint);
  assert.deepEqual(
    liveOrientation(),
    beforeCapture,
    "no-op checkpoint restore changed live external orientation bits",
  );
  assert.doesNotThrow(
    () => adapter.validateState(checkpoint),
    "adapter rejected its canonical quaternion checkpoint projection",
  );
  record.quaternion.w += 2e-7;
  assert.throws(
    () => adapter.validateState(JSON.stringify(forged)),
    (error) => error?.code === "INVALID_CANNON_EXTERNAL_BODY_CHECKPOINT",
    "checkpoint accepted a finite but noncanonical near-unit quaternion",
  );
  assert.deepEqual(
    adapter.exportState(),
    baseline,
    "rejected quaternion checkpoint mutated world-owned state",
  );
  let accessorReads = 0;
  const accessorCheckpoint = {};
  Object.defineProperty(accessorCheckpoint, "version", {
    enumerable: true,
    get() {
      accessorReads++;
      return 1;
    },
  });
  assert.throws(
    () => adapter.validateState(accessorCheckpoint),
    (error) => error?.code === "INVALID_CANNON_CHECKPOINT_INPUT",
  );
  assert.equal(accessorReads, 0, "Cannon validator executed a state accessor");
  let proxyReads = 0;
  const checkpointProxy = new Proxy(structuredClone(checkpoint), {
    get() {
      proxyReads++;
      return undefined;
    },
    getPrototypeOf() {
      proxyReads++;
      return Object.prototype;
    },
    ownKeys() {
      proxyReads++;
      return [];
    },
    getOwnPropertyDescriptor() {
      proxyReads++;
      return undefined;
    },
  });
  assert.throws(
    () => adapter.validateState(checkpointProxy),
    (error) => error?.code === "INVALID_CANNON_CHECKPOINT_INPUT",
  );
  assert.equal(proxyReads, 0, "Cannon validator executed a Proxy trap");
  adapter.dispose();
}

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
  for (let tick = 1; tick <= 240; tick++) {
    requestWorldEvidenceCapture(adapter);
    adapter.integrate(1 / 120, { tick });
  }
  const telemetry = adapter.telemetry(),
    evidence = completedWorldEvidenceContributions(adapter),
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
      evidence.map((row) => ({
        tick: row.tick,
        rowId: row.rowId,
        source: row.source,
        sourceContactIds: row.sourceContactIds,
      })),
    ];
  assert.equal(telemetry.transactionId, CANNON_SOLVER_TRANSACTION_ID);
  assert.equal(telemetry.integrationCount, 240);
  assert.ok(Math.abs(world.time - 2) <= Number.EPSILON * 32, world.time);
  assert.equal(world.stepnumber, 240);
  assert.ok(beginContacts > 0);
  assert.ok(evidence.length > 0);
  assert.ok(evidence.every((row) => row.tick === 240));
  assert.ok(
    evidence.some(
      (row) =>
        row.source === "contact" &&
        row.sourceContactIds.some((id) => id.startsWith("contact:240:")),
    ),
  );
  assert.ok(Math.abs(body.position.y - 0.25) < 0.01, body.position);
  return state;
}

assert.deepEqual(run(), run(), "owned solver transaction is nondeterministic");

function typedContactProvenanceRun() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    numeric = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(1),
      position: new CANNON.Vec3(-0.25, 0, 0),
    }),
    textual = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(1),
      position: new CANNON.Vec3(0.25, 0, 0),
    }),
    adapter = new CannonWorldAdapter(world);
  numeric.userData = { partId: 1 };
  textual.userData = { partId: "1" };
  world.addBody(numeric);
  world.addBody(textual);
  adapter.beginSession();
  requestWorldEvidenceCapture(adapter);
  adapter.integrate(1 / 120, { tick: 1 });
  const contributions = completedWorldEvidenceContributions(adapter);
  assert.ok(world.contacts.length > 0, "typed-ID fixture did not collide");
  const contact = world.contacts[0].simulacrumEvidence,
    bodyIds = new Set([contact.bodyAId, contact.bodyBId]),
    expectedBodyIds = new Set(["part:1", "part:string:1:1"]);
  assert.deepEqual(
    bodyIds,
    expectedBodyIds,
    "numeric and string-homograph part IDs collapsed in contact provenance",
  );
  assert.equal(
    new Set(
      world.frictionEquations.map(
        (equation) => equation.simulacrumEvidenceRow.rowId,
      ),
    ).size,
    world.frictionEquations.length,
    "typed-ID friction provenance produced duplicate row identities",
  );
  assert.ok(
    world.frictionEquations.every((equation) =>
      [...expectedBodyIds].every((id) =>
        equation.simulacrumEvidenceRow.rowId.includes(id),
      ),
    ),
    "friction provenance omitted a typed contact-body identity",
  );
  const contactContributions = contributions.filter((row) =>
    row.sourceContactIds.includes(contact.contactId),
  );
  assert.ok(
    contactContributions.length > 0,
    "typed contact produced no materialized solver contributions",
  );
  assert.ok(
    contactContributions.every(
      (row) =>
        expectedBodyIds.has(row.bodyId) &&
        expectedBodyIds.has(row.otherBodyId) &&
        row.bodyId !== row.otherBodyId,
    ),
    "materialized solver contributions lost typed contact-body identity",
  );
  adapter.dispose();
}

typedContactProvenanceRun();

function pooledMetadataRun() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.80665, 0) }),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Plane(),
    }),
    body = new CANNON.Body({
      mass: 1,
      shape: new CANNON.Sphere(0.25),
      position: new CANNON.Vec3(0, 0.24, 0),
    }),
    transaction = new CannonSolverTransaction(world),
    adapter = new CannonWorldAdapter(world, transaction),
    constraint = new CANNON.DistanceConstraint(ground, body, 1);
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  world.addBody(body);
  adapter.beginSession();
  requestWorldEvidenceCapture(adapter);
  adapter.integrate(1 / 120, { tick: 1 });
  assert.ok(world.contacts.length > 0, "metadata fixture did not contact");
  assert.ok(world.contacts.every((row) => row.simulacrumEvidence?.tick === 1));
  assert.ok(
    world.contacts.every(
      (row) =>
        row.simulacrumFrictionCoefficientValid === true &&
        Math.abs(
          row.simulacrumFrictionCoefficient -
            world.defaultContactMaterial.friction,
        ) < 1e-12,
    ),
    "contact did not retain the coefficient enforced by its friction rows",
  );
  const capturedRows = new Set(world.contacts);
  for (const row of [...world.contacts, ...world.frictionEquations]) {
    row.surfaceLawParticipant = "bi";
    row.simulacrumFrictionCoefficient = 999;
    row.simulacrumFrictionCoefficientValid = "stale";
  }
  adapter.integrate(1 / 120, { tick: 2 });
  assert.ok(
    [...world.contacts, ...transaction.oldContacts].some((row) =>
      capturedRows.has(row),
    ),
    "captured contact was lost instead of returning to Cannon ownership",
  );
  for (const row of [
    ...world.contacts,
    ...world.frictionEquations,
    ...transaction.oldContacts,
    ...transaction.frictionEquationPool,
  ]) {
    assert.equal(row.simulacrumEvidence, undefined);
    assert.equal(row.simulacrumEvidenceRow, undefined);
    assert.equal(row.simulacrumTireEvidence, undefined);
    assert.equal(row.surfaceMaterialKey, undefined);
    assert.equal(row.surfaceShapeId, undefined);
    assert.equal(row.surfaceFrictionCoefficient, undefined);
    assert.equal(row.surfaceLawParticipant, undefined);
  }
  assert.ok(
    world.contacts.every(
      (row) =>
        row.simulacrumFrictionCoefficientValid === true &&
        row.simulacrumFrictionCoefficient !== 999,
    ),
    "reused contacts retained stale friction authority",
  );
  for (const row of [
    ...world.frictionEquations,
    ...transaction.oldContacts,
    ...transaction.frictionEquationPool,
  ]) {
    assert.equal(row.simulacrumFrictionCoefficient, undefined);
    assert.equal(row.simulacrumFrictionCoefficientValid, undefined);
  }

  registerRollingSupport(transaction, {
    wheelBody: body,
    wheelShape: body.shapes[0],
    descriptor: Object.freeze({ id: "fixture-rolling-support" }),
    constraint,
  });
  assert.throws(
    () =>
      registerRollingSupport(transaction, {
        wheelBody: body,
        wheelShape: body.shapes[0],
        descriptor: Object.freeze({ id: "duplicate" }),
        constraint,
      }),
    (error) => error?.code === "DUPLICATE_ROLLING_SUPPORT_REGISTRATION",
  );
  assert.throws(
    () =>
      unregisterRollingSupport(transaction, {
        wheelBody: body,
        wheelShape: body.shapes[0],
        constraint: new CANNON.DistanceConstraint(ground, body, 1),
      }),
    (error) => error?.code === "ROLLING_SUPPORT_REGISTRATION_MISMATCH",
  );
  assert.equal(
    unregisterRollingSupport(transaction, {
      wheelBody: body,
      wheelShape: body.shapes[0],
      constraint,
    }),
    true,
  );
  assert.equal(
    unregisterRollingSupport(transaction, {
      wheelBody: body,
      wheelShape: body.shapes[0],
      constraint,
    }),
    false,
  );
  registerRollingSupport(transaction, {
    wheelBody: body,
    wheelShape: body.shapes[0],
    descriptor: Object.freeze({ id: "dispose-fixture" }),
    constraint,
  });
  assert.equal(
    cannonSolverTransactionResourceState(transaction)
      .rollingSupportRegistrations,
    1,
  );
  adapter.dispose();
  assert.deepEqual(cannonSolverTransactionResourceState(transaction), {
    canonicalContactPoolSize: 0,
    canonicalContactAllocations: 0,
    rollingSupportRegistrations: 0,
  });
}

pooledMetadataRun();

function contactFrictionAuthorityRun({
  gravity = new CANNON.Vec3(0, -9.80665, 0),
  frictionGravity = null,
  directFriction = null,
  mutateRows = null,
} = {}) {
  const world = new CANNON.World({ gravity }),
    groundMaterial = new CANNON.Material("friction-ground"),
    bodyMaterial = new CANNON.Material("friction-body"),
    groundShape = new CANNON.Plane(),
    bodyShape = new CANNON.Sphere(0.25),
    ground = new CANNON.Body({ type: CANNON.Body.STATIC }),
    body = new CANNON.Body({
      mass: 1,
      position: new CANNON.Vec3(0, 0.24, 0),
    });
  if (directFriction) {
    groundMaterial.friction = directFriction.ground;
    bodyMaterial.friction = directFriction.body;
  }
  groundShape.material = groundMaterial;
  bodyShape.material = bodyMaterial;
  ground.addShape(groundShape);
  body.addShape(bodyShape);
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  world.addBody(body);
  if (frictionGravity) world.frictionGravity = frictionGravity;
  const originalGetContacts = world.narrowphase.getContacts.bind(
    world.narrowphase,
  );
  world.narrowphase.getContacts = (...args) => {
    originalGetContacts(...args);
    mutateRows?.({ world, contacts: args[3], friction: args[5] });
  };
  const adapter = new CannonWorldAdapter(world);
  adapter.beginSession();
  adapter.integrate(1 / 120, { tick: 1 });
  assert.ok(world.contacts.length > 0, "friction-authority fixture missed");
  const result = world.contacts.map((contact) => ({
    coefficient: contact.simulacrumFrictionCoefficient,
    valid: contact.simulacrumFrictionCoefficientValid,
  }));
  adapter.dispose();
  return result;
}

function appendFrictionAttributionDecoys({ friction }) {
  const source = friction[0],
    unrelated = new CANNON.Body({ mass: 1 }),
    decoy = ({ bi = source.bi, bj = source.bj, riX = 0, rjX = 0 }) => {
      const row = new CANNON.FrictionEquation(bi, bj, source.maxForce);
      row.ri.copy(source.ri);
      row.rj.copy(source.rj);
      row.t.copy(source.t);
      row.ri.x += riX;
      row.rj.x += rjX;
      row.enabled = source.enabled;
      row.minForce = source.minForce;
      row.maxForce = source.maxForce;
      return row;
    };
  friction.push(
    decoy({ bi: unrelated }),
    decoy({ bj: unrelated }),
    decoy({ riX: 1 }),
    decoy({ rjX: 1 }),
  );
}

const directMaterialFriction = contactFrictionAuthorityRun({
  directFriction: { ground: 0.4, body: 0.5 },
  mutateRows: appendFrictionAttributionDecoys,
});
assert.ok(
  directMaterialFriction.every(
    ({ coefficient, valid }) =>
      valid === true && Math.abs(coefficient - 0.2) < 1e-12,
  ),
  "direct Cannon material friction was not derived from enforced row bounds",
);

const swappedFrictionRows = contactFrictionAuthorityRun({
  mutateRows: ({ friction }) => {
    for (const row of friction) {
      const body = row.bi,
        anchor = row.ri.clone();
      row.bi = row.bj;
      row.bj = body;
      row.ri.copy(row.rj);
      row.rj.copy(anchor);
    }
    appendFrictionAttributionDecoys({ friction });
  },
});
assert.ok(
  swappedFrictionRows.every(({ valid }) => valid === true),
  "equivalent swapped friction rows lost their contact attribution",
);

const generalBasisFrictionRows = contactFrictionAuthorityRun({
  mutateRows: ({ contacts, friction }) => {
    const inverseSqrt3 = 1 / Math.sqrt(3),
      inverseSqrt2 = 1 / Math.sqrt(2),
      inverseSqrt6 = 1 / Math.sqrt(6);
    for (const contact of contacts)
      contact.ni.set(inverseSqrt3, inverseSqrt3, inverseSqrt3);
    friction[0].t.set(inverseSqrt2, -inverseSqrt2, 0);
    friction[1].t.set(inverseSqrt6, inverseSqrt6, -2 * inverseSqrt6);
  },
});
assert.ok(
  generalBasisFrictionRows.every(({ valid }) => valid === true),
  "a finite orthonormal 3D contact basis lost friction authority",
);

const contactBasisTolerance = 2 ** -20,
  inclusiveBoundaryFrictionRows = [
    {
      label: "unit-tangent length",
      mutateRows: ({ friction }) => {
        friction[0].t.set(1 + contactBasisTolerance, 0, 0);
        friction[1].t.set(0, 0, 1);
      },
    },
    {
      label: "tangent-normal orthogonality",
      mutateRows: ({ contacts, friction }) => {
        const orthogonalComponent = Math.sqrt(1 - contactBasisTolerance ** 2);
        for (const contact of contacts) contact.ni.set(0, 1, 0);
        friction[0].t.set(orthogonalComponent, contactBasisTolerance, 0);
        friction[1].t.set(0, 0, 1);
      },
    },
    {
      label: "tangent-pair independence",
      mutateRows: ({ contacts, friction }) => {
        const independentComponent = Math.sqrt(1 - contactBasisTolerance ** 2);
        for (const contact of contacts) contact.ni.set(0, 1, 0);
        friction[0].t.set(1, 0, 0);
        friction[1].t.set(contactBasisTolerance, 0, independentComponent);
      },
    },
  ];
for (const { label, mutateRows } of inclusiveBoundaryFrictionRows)
  assert.ok(
    contactFrictionAuthorityRun({ mutateRows }).every(
      ({ valid }) => valid === true,
    ),
    `the inclusive ${label} tolerance boundary lost friction authority`,
  );

const invalidFrictionMutations = [
  ({ friction }) => friction.pop(),
  ({ friction }) => {
    friction[0].enabled = false;
  },
  ({ friction }) => {
    friction[0].minForce = friction[0].maxForce;
  },
  ({ friction }) => {
    friction[0].maxForce *= 0.5;
    friction[0].minForce = -friction[0].maxForce;
  },
  ({ friction }) => {
    for (const row of friction) {
      row.minForce = 1;
      row.maxForce = -1;
    }
  },
  ({ friction }) => {
    friction[0].ri.x += 1;
  },
  ({ friction }) => {
    friction[0].ri.x = Number.NaN;
  },
  ({ friction }) => {
    friction[0].rj.x = undefined;
  },
  ({ contacts, friction }) => {
    for (const contact of contacts) {
      contact.ri.x = Number.POSITIVE_INFINITY;
      contact.rj.x = Number.POSITIVE_INFINITY;
    }
    for (const row of friction) {
      row.ri.x = Number.POSITIVE_INFINITY;
      row.rj.x = Number.POSITIVE_INFINITY;
    }
  },
  ({ friction }) => {
    friction[0].t.set(0, 0, 0);
  },
  ({ friction }) => {
    friction[1].t.copy(friction[0].t);
  },
  ({ contacts, friction }) => {
    friction[0].t.copy(contacts[0].ni);
  },
  ({ friction }) => {
    friction[0].t.scale(2, friction[0].t);
  },
  ({ contacts }) => {
    contacts[0].bi.invMass = 0;
    contacts[0].bj.invMass = 0;
  },
  ({ contacts, friction }) => {
    const dynamic = contacts[0].bi.invMass ? contacts[0].bi : contacts[0].bj;
    dynamic.invMass = 2;
    for (const row of friction) {
      row.minForce = -Number.MAX_VALUE;
      row.maxForce = Number.MAX_VALUE;
    }
  },
];
for (const mutateRows of invalidFrictionMutations)
  assert.ok(
    contactFrictionAuthorityRun({ mutateRows }).every(
      ({ coefficient, valid }) => valid === false && coefficient === 0,
    ),
    "malformed friction rows retained coefficient authority",
  );
assert.ok(
  contactFrictionAuthorityRun({
    frictionGravity: new CANNON.Vec3(),
  }).every(({ coefficient, valid }) => valid === false && coefficient === 0),
  "zero-gravity friction approximation invented coefficient authority",
);
assert.ok(
  contactFrictionAuthorityRun({
    mutateRows: ({ world }) => {
      world.frictionGravity = new CANNON.Vec3();
    },
  }).every(({ coefficient, valid }) => valid === false && coefficient === 0),
  "post-row zero-gravity authority retained a friction coefficient",
);
assert.ok(
  contactFrictionAuthorityRun({
    mutateRows: ({ friction }) => {
      for (const row of friction) {
        row.minForce = 0;
        row.maxForce = 0;
      }
    },
  }).every(({ coefficient, valid }) => valid === true && coefficient === 0),
  "known zero friction bounds were not retained as valid authority",
);

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
  support.userData = {
    externalBodyId: "motor-support",
    checkpointPolicy: "world-kinematics-v1",
  };
  rotor.userData = {
    externalBodyId: "motor-rotor",
    checkpointPolicy: "world-kinematics-v1",
  };
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
  assert.ok(Object.isFrozen(pending), "motor record envelope is mutable");
  assert.ok(Object.isFrozen(pending.records), "motor record array is mutable");
  assert.ok(Object.isFrozen(record), "motor energy record is mutable");
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
