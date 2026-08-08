import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";

const DT = 1 / 120;

function close(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

function solvedPartPoint(body, positionPartM) {
  const frame = body.userData.massFrame,
    partFromCom = new CANNON.Vec3(...positionPartM).vsub(frame.comPart),
    localPoint = frame.principalToPart
      .conjugate(new CANNON.Quaternion())
      .vmult(partFromCom);
  return body.previousPosition.vadd(body.previousQuaternion.vmult(localPoint));
}

function solvedConstraintPoint(constraint, side) {
  const body = constraint[`body${side}`];
  return body.previousPosition.vadd(
    body.previousQuaternion.vmult(constraint[`pivot${side}`]),
  );
}

function rawSolvedWrenchAtConstraintPoint(constraint, side) {
  const force = new CANNON.Vec3(),
    moment = new CANNON.Vec3(),
    body = constraint[`body${side}`];
  for (const equation of constraint.equations) {
    const multiplier = Number(equation.multiplier || 0),
      jacobian = equation[`jacobianElement${side}`];
    if (!equation.enabled || !jacobian || !Number.isFinite(multiplier))
      continue;
    const rowForce = jacobian.spatial.scale(multiplier),
      rowMomentAtCom = jacobian.rotational.scale(multiplier),
      equationAnchor = side === "A" ? equation.ri : equation.rj,
      anchorFromCom = equationAnchor
        ? equationAnchor.clone()
        : body.previousQuaternion.vmult(constraint[`pivot${side}`]),
      forceMomentAtCom = anchorFromCom.cross(rowForce);
    force.vadd(rowForce, force);
    rowMomentAtCom.vsub(forceMomentAtCom, rowMomentAtCom);
    moment.vadd(rowMomentAtCom, moment);
  }
  return { force, moment };
}

function torqueMagnitudeAtEndpoint(constraint, descriptor, attachment) {
  const body = constraint[`body${attachment.side}`],
    frame = descriptor[`attachmentFrame${attachment.side}`],
    endpoint = solvedPartPoint(body, frame.positionPartM),
    reference = solvedConstraintPoint(constraint, attachment.side),
    { force, moment } = rawSolvedWrenchAtConstraintPoint(
      constraint,
      attachment.side,
    ),
    translated = reference.vsub(endpoint).cross(force);
  translated.vadd(moment, translated);
  return { forceN: force.length(), torqueNm: translated.length() };
}

function kineticEnergy(world) {
  return world.bodies.reduce((total, body) => {
    if (body.mass <= 0) return total;
    const linear = 0.5 * body.mass * body.velocity.lengthSquared(),
      angularVelocityLocal = body.quaternion
        .conjugate()
        .vmult(body.angularVelocity),
      angular =
        0.5 *
        (body.inertia.x * angularVelocityLocal.x ** 2 +
          body.inertia.y * angularVelocityLocal.y ** 2 +
          body.inertia.z * angularVelocityLocal.z ** 2);
    return total + linear + angular;
  }, 0);
}

const capacity = {
    ultimateForceN: 48_000,
    ultimateTorqueNm: 14_000,
  },
  assembly = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, -0.15, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 22, size: [2.4, 0.18, 2.4] },
      },
      {
        id: 2,
        type: "plate",
        pos: [0, 0.15, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 22, size: [2.4, 0.18, 2.4] },
      },
      {
        id: 3,
        type: "release-coupler",
        pos: [0, 0, 0],
        orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        mechanism: mechanismComponentDefinition("release-coupler"),
      },
      {
        id: 10,
        type: "beam",
        pos: [10, 0, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 18, size: [2.4, 0.35, 0.35] },
      },
      {
        id: 11,
        type: "beam",
        pos: [12.4, 0, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 18, size: [2.4, 0.35, 0.35] },
      },
    ],
    connections: [
      {
        id: "coupler-a",
        a: 1,
        b: 3,
        kind: "mechanical",
        portA: "TOP",
        portB: "FLANGE_A",
        anchorA: [0, 0.25, 0],
        capacity,
      },
      {
        id: "coupler-b",
        a: 3,
        b: 2,
        kind: "mechanical",
        portA: "FLANGE_B",
        portB: "BOTTOM",
        anchorB: [0, -0.25, 0],
        capacity,
      },
      {
        id: "direct-fixed",
        a: 10,
        b: 11,
        kind: "mechanical",
        portA: "B",
        portB: "A",
        capacity,
      },
    ],
  },
  world = new CANNON.World({ gravity: new CANNON.Vec3() }),
  runtime = new MultibodyRuntime({
    world,
    material: new CANNON.Material("fixed-attachment-fixture"),
    catalog: TYPES,
    fixedDt: DT,
  });
runtime.start(JSON.stringify(assembly));

const fixedDescriptors = runtime.compiled.constraints.filter(
  (descriptor) => descriptor.kind === "fixed",
);
assert.ok(fixedDescriptors.length > 0, "fixture has no fixed attachments");
for (const descriptor of fixedDescriptors) {
  for (const frame of [
    descriptor.attachmentFrameA,
    descriptor.attachmentFrameB,
  ]) {
    assert.equal(frame.positionPartM.length, 3);
    assert.equal(frame.positionWorldM.length, 3);
    assert.equal(frame.orientationPart.length, 4);
    assert.equal(frame.orientationWorld.length, 4);
    assert.ok(
      [...frame.positionPartM, ...frame.positionWorldM].every(Number.isFinite),
      `fixed attachment ${descriptor.id} lost finite authored position`,
    );
    close(
      Math.hypot(...frame.orientationPart),
      1,
      1e-12,
      `fixed attachment ${descriptor.id} part-frame orientation`,
    );
    close(
      Math.hypot(...frame.orientationWorld),
      1,
      1e-12,
      `fixed attachment ${descriptor.id} world orientation`,
    );
  }
  assert.equal(descriptor.failureAttachments.length, 2);
}

const directFixed = fixedDescriptors.find(
    (descriptor) => descriptor.sourceConnectionIds.length === 1,
  ),
  separatedFixed = fixedDescriptors.find(
    (descriptor) =>
      descriptor.sourceConnectionIds.length === 2 &&
      Math.hypot(
        ...descriptor.attachmentFrameA.positionWorldM.map(
          (value, index) =>
            value - descriptor.attachmentFrameB.positionWorldM[index],
        ),
      ) > 0.1,
  );
assert.ok(directFixed, "fixture has no direct fixed connection");
assert.deepEqual(
  directFixed.failureAttachments.map((attachment) => attachment.connectionId),
  [directFixed.sourceConnectionIds[0], directFixed.sourceConnectionIds[0]],
  "direct fixed sides did not retain their shared failure owner",
);
assert.ok(separatedFixed, "fixture has no separated two-ended rigid element");
assert.deepEqual(
  separatedFixed.failureAttachments.map(
    (attachment) => attachment.connectionId,
  ),
  separatedFixed.sourceConnectionIds,
  "two-ended rigid element lost endpoint-specific connection ownership",
);

const entry = runtime.constraintEntries.find(
    (candidate) => candidate.descriptor.id === separatedFixed.id,
  ),
  constraint = entry?.constraint;
assert.ok(constraint, "separated fixed descriptor has no runtime constraint");
const initialReferenceA = constraint.bodyA.pointToWorldFrame(constraint.pivotA),
  initialReferenceB = constraint.bodyB.pointToWorldFrame(constraint.pivotB);
for (const axis of ["x", "y", "z"])
  close(
    initialReferenceA[axis],
    initialReferenceB[axis],
    1e-12,
    `common solver reference ${axis}`,
  );

function applyEndpointLoadProbe() {
  runtime.loadByConnection.clear();
  runtime.torqueByConnection.clear();
  constraint.bodyB.force.set(1000, 0, 0);
  constraint.bodyB.torque.set(0, 0, 300);
  world.step(DT);
  runtime.afterIntegration(DT);
  return Object.fromEntries(
    separatedFixed.sourceConnectionIds.map((connectionId) => [
      connectionId,
      {
        forceN: runtime.loadByConnection.get(connectionId),
        torqueNm: runtime.torqueByConnection.get(connectionId),
      },
    ]),
  );
}

for (let tick = 0; tick < 4; tick++) world.step(DT);
close(
  kineticEnergy(world),
  0,
  1e-18,
  "quiescent fixed assembly kinetic energy",
);
const quiescentCheckpoint = runtime.exportState();

const endpointLoads = applyEndpointLoadProbe();

for (const attachment of separatedFixed.failureAttachments) {
  const expected = torqueMagnitudeAtEndpoint(
      constraint,
      separatedFixed,
      attachment,
    ),
    connectionId = attachment.connectionId;
  close(
    endpointLoads[connectionId].forceN,
    expected.forceN,
    1e-9,
    `endpoint ${connectionId} force`,
  );
  close(
    endpointLoads[connectionId].torqueNm,
    expected.torqueNm,
    1e-9,
    `endpoint ${connectionId} torque`,
  );
}
assert.ok(
  Math.abs(
    endpointLoads[separatedFixed.sourceConnectionIds[0]].torqueNm -
      endpointLoads[separatedFixed.sourceConnectionIds[1]].torqueNm,
  ) > 50,
  "separated endpoints collapsed to one wrench moment",
);

// A valid checkpoint restore must preserve endpoint failure evidence exactly.
runtime.importState(quiescentCheckpoint);
const beforeRestore = applyEndpointLoadProbe();
runtime.importState(quiescentCheckpoint);
const afterRestore = applyEndpointLoadProbe();
for (const connectionId of separatedFixed.sourceConnectionIds) {
  close(
    afterRestore[connectionId].forceN,
    beforeRestore[connectionId].forceN,
    1e-9,
    `checkpoint endpoint ${connectionId} force`,
  );
  close(
    afterRestore[connectionId].torqueNm,
    beforeRestore[connectionId].torqueNm,
    1e-9,
    `checkpoint endpoint ${connectionId} torque`,
  );
}

// The principal-axis frame is derived from mass properties, not an independent
// mutable checkpoint knob. Reject a contradictory live frame before capture.
runtime.importState(quiescentCheckpoint);
const originalPrincipalToPart =
    constraint.bodyA.userData.massFrame.principalToPart.clone(),
  contradictoryPrincipalToPart = new CANNON.Quaternion();
contradictoryPrincipalToPart.setFromAxisAngle(
  new CANNON.Vec3(0, 0, 1),
  Math.PI / 3,
);
constraint.bodyA.userData.massFrame.principalToPart.copy(
  contradictoryPrincipalToPart,
);
assert.throws(
  () => runtime.exportState(),
  (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  "checkpoint capture accepted a principal-axis frame contradictory to mass authority",
);
constraint.bodyA.userData.massFrame.principalToPart.copy(
  originalPrincipalToPart,
);

const hostileEquation = constraint.equations[0],
  originalEquationEnabled = hostileEquation.enabled,
  originalEquationEpsilon = hostileEquation.eps,
  originalEquationMaxForce = hostileEquation.maxForce,
  originalEquationBodyA = hostileEquation.bi;
hostileEquation.enabled = !originalEquationEnabled;
assert.throws(
  () => runtime.exportState(),
  (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  "checkpoint capture accepted a disabled compiled solver row",
);
hostileEquation.enabled = originalEquationEnabled;
hostileEquation.eps = originalEquationEpsilon * 2;
assert.throws(
  () => runtime.exportState(),
  (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  "checkpoint capture accepted mutated solver regularization",
);
hostileEquation.eps = originalEquationEpsilon;
hostileEquation.maxForce = originalEquationMaxForce / 2;
assert.throws(
  () => runtime.exportState(),
  (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  "checkpoint capture accepted a mutated solver row force bound",
);
hostileEquation.maxForce = originalEquationMaxForce;
hostileEquation.bi = hostileEquation.bj;
assert.throws(
  () => runtime.exportState(),
  (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  "checkpoint capture accepted a solver row rebound to another body",
);
hostileEquation.bi = originalEquationBodyA;
assert.doesNotThrow(
  () => runtime.exportState(),
  "restoring exact equation authority did not restore checkpoint capture",
);

// Exercise the full structural consumer. Failing one flange of a rigid
// two-ended component must separate the resulting physical body component,
// while its other authored flange and all connections internal to the
// separated component remain intact.
function verifyStructuralFailureOwnership() {
  const structureWorld = new CANNON.World({ gravity: new CANNON.Vec3() }),
    structureRuntime = new MultibodyRuntime({
      world: structureWorld,
      material: new CANNON.Material("fixed-attachment-structure-fixture"),
      catalog: TYPES,
      fixedDt: DT,
    });
  structureRuntime.start(JSON.stringify(assembly));
  const descriptor = structureRuntime.compiled.constraints.find(
      (candidate) =>
        candidate.kind === "fixed" &&
        candidate.sourceConnectionIds?.length === 2,
    ),
    [failedConnectionId, survivingConnectionId] =
      descriptor?.sourceConnectionIds || [],
    failedConnection = assembly.connections.find(
      (connection) => connection.id === failedConnectionId,
    );
  assert.ok(descriptor, "structure fixture has no two-ended fixed descriptor");
  assert.ok(
    failedConnection,
    "structure fixture lost failed endpoint capacity",
  );
  structureRuntime.loadByConnection.set(
    failedConnectionId,
    failedConnection.capacity.ultimateForceN * 1.1,
  );
  structureRuntime.loadByConnection.set(survivingConnectionId, 0);
  structureRuntime.torqueByConnection.set(failedConnectionId, 0);
  structureRuntime.torqueByConnection.set(survivingConnectionId, 0);

  const session = new SimulationSession({
    fixedDt: DT,
    systems: [new StructureSystem()],
  }).start(assembly, {
    catalog: TYPES,
    multibodyRuntime: structureRuntime,
  });
  session.stepFixed();

  const structures = session.telemetry().systems.structures,
    runGraph = session.context.runGraph,
    event = runGraph.events().at(-1),
    detached = new Set(
      runGraph
        .parts()
        .filter((part) => part.detached)
        .map((part) => part.id),
    ),
    survivingAttachment = descriptor.failureAttachments.find(
      (attachment) => attachment.connectionId === survivingConnectionId,
    ),
    survivingBodyPartId = survivingAttachment.bodyPartId;
  assert.deepEqual(
    structures.newlyFailed,
    [failedConnectionId],
    "structure consumer attributed overload to more than one endpoint",
  );
  assert.equal(
    runGraph.connection(survivingConnectionId).failed,
    false,
    "surviving authored endpoint was failed by detachment cascade",
  );
  assert.ok(
    event?.failedConnectionIds.includes(failedConnectionId),
    "structural event omitted the measured endpoint failure",
  );
  assert.equal(
    event?.failedConnectionIds.includes(survivingConnectionId),
    false,
    "structural event reassigned failure to the surviving endpoint",
  );
  for (const connectionId of event?.failedConnectionIds || []) {
    const connection = runGraph.connection(connectionId);
    assert.equal(
      detached.has(connection.a) && detached.has(connection.b),
      false,
      `detachment cascade failed internal connection ${connectionId}`,
    );
  }
  assert.equal(
    detached.has(descriptor.sourcePartId),
    detached.has(survivingBodyPartId),
    "two-ended component did not remain attached to its surviving body side",
  );

  session.dispose();
  structureRuntime.dispose();
}

verifyStructuralFailureOwnership();

function verifyDetachedSubgraphIntegrity() {
  const part = (id, x) => ({
      id,
      type: "beam",
      pos: [x, 0, 0],
      orientation: [0, 0, 0, 1],
      config: { mass: 18, size: [2.4, 0.35, 0.35] },
    }),
    connection = (id, a, b) => ({
      id,
      a,
      b,
      kind: "mechanical",
      portA: "SURFACE",
      portB: "SURFACE",
      anchorA: id === "boundary" ? [0.2, 0, 0] : [0, 0, 0],
      anchorB: [0, 0, 0],
      capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
    }),
    graph = new RunAssemblyGraph({
      revision: 1,
      parts: [part(1, 0), part(2, 1), part(3, 2)],
      connections: [connection("internal", 1, 2), connection("boundary", 2, 3)],
    }),
    event = graph.detachComponent([1, 2]);
  assert.deepEqual(event.failedConnectionIds, ["boundary"]);
  assert.equal(graph.connection("internal").failed, false);
  assert.equal(graph.connection("boundary").failed, true);
  const explicitInternalFailure = graph.applyStructuralEvent({
    failedConnectionIds: ["internal"],
    detachedPartIds: [1, 2],
  });
  assert.ok(
    explicitInternalFailure.failedConnectionIds.includes("internal"),
    "explicit internal failure was hidden by detached-subgraph preservation",
  );
  assert.equal(graph.connection("internal").failed, true);
}

verifyDetachedSubgraphIntegrity();

runtime.dispose();
console.log(
  `fixed attachment runtime passed (${fixedDescriptors.length} fixed descriptors, ${separatedFixed.sourceConnectionIds.length} endpoint owners)`,
);
