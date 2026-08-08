import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import * as Core from "../src/core/index.js";
import { compileAssembly } from "./lib/compile-assembly.mjs";
import { componentDefaults } from "../src/model/component-resolver.js";
import { TYPES } from "../src/model/component-catalog.js";
import { composeRigidBodyMassProperties } from "../src/model/assembly-compiler-mass-properties.js";
import {
  deriveDynamicMassProperties,
  dynamicMassContributorIdentity,
} from "../src/model/dynamic-mass-properties.js";
import { compiledTopologyFingerprint } from "../src/application/mechanism-run-identity.js";
import { validateGeometryDescriptorOrThrow } from "../src/model/component-geometry-contract.js";
import { geometryDescriptorForType } from "../src/model/geometry-descriptors.js";
import { completeMassProperties } from "../src/model/mechanism-geometry-compiler.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { compareCanonicalIds, deepFreeze } from "../src/model/primitives.js";
import {
  reconstructTreeCutWrenches as reconstructTreeCutWrenchesBoundary,
  rigidClusterCutFramesWorld as rigidClusterCutFramesWorldBoundary,
} from "../src/simulation/rigid-cluster-cut-wrench.js";
import {
  BodyRegistry,
  commitBodyRegistryMassProperties,
} from "../src/simulation/body-registry.js";
import {
  CannonWorldAdapter,
  configureCannonWorldSolverProfile,
} from "../src/simulation/cannon-world-adapter.js";
import { WORKSHOP_CANNON_SOLVER_PROFILE } from "../src/simulation/cannon-solver-profile.js";
import {
  commitOwnedMultibodyMassProperties,
  MultibodyRuntime,
} from "../src/simulation/multibody-runtime.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { assignConstraintEvidenceRows } from "../src/simulation/constraint-reaction-wrench.js";
import { FailureEvidenceRecorder } from "../src/simulation/failure-evidence-recorder.js";

const rigidClusterCutFramesWorld = (descriptor, rootPose) =>
    rigidClusterCutFramesWorldBoundary(descriptor, JSON.stringify(rootPose)),
  reconstructTreeCutWrenches = (input) => {
    const { clusterDescriptor, ...callerState } = input;
    return reconstructTreeCutWrenchesBoundary(
      clusterDescriptor,
      JSON.stringify(callerState),
    );
  },
  importMultibodyState = (runtime, state) =>
    runtime.importState(JSON.stringify(state));

assert.equal(
  Core.reconstructTreeCutWrenches,
  reconstructTreeCutWrenchesBoundary,
);
assert.equal(
  Core.rigidClusterCutFramesWorld,
  rigidClusterCutFramesWorldBoundary,
);
assert.equal(Core.commitOwnedMultibodyMassProperties, undefined);
assert.equal(Core.commitBodyRegistryMassProperties, undefined);

for (const path of [
  "src/model/assembly-compiler-topology.js",
  "src/simulation/rigid-cluster-cut-wrench.js",
]) {
  const source = fs.readFileSync(path, "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:humanoid|builtInDemo|rigRole|CANNON)\b/,
    `${path} contains identity-conditioned physics dispatch`,
  );
}

const capacity = {
    ultimateForceN: 10_000,
    ultimateTorqueNm: 2_000,
  },
  beam = (id, x) => ({
    id,
    type: "beam",
    pos: [x, 0, 0],
    orientation: [0, 0, 0, 1],
    config: componentDefaults("beam"),
  }),
  connection = (id, a, portA, b, portB) => ({
    id,
    a,
    b,
    kind: "mechanical",
    portA,
    portB,
    capacity: structuredClone(capacity),
  }),
  chain = {
    revision: 1,
    parts: [beam(1, 0), beam(2, 2.4), beam(3, 4.8)],
    connections: [
      connection("cut-12", 1, "B", 2, "A"),
      connection("cut-23", 2, "B", 3, "A"),
    ],
  },
  compiled = compileAssembly(chain, TYPES);

assert.equal(compiled.stats.errorCount, 0);
assert.equal(compiled.stats.rigidClusterCount, 1);
assert.equal(compiled.rigidClusters.length, 1);
assert.throws(
  () =>
    compileAssembly(
      {
        revision: 1,
        parts: [beam("duplicate-part", 0), beam("duplicate-part", 2.4)],
        connections: [],
      },
      TYPES,
    ),
  (error) => error?.code === "DUPLICATE_PART_ID",
  "direct compiler input accepted duplicate body authority",
);
{
  const subnormalCatalog = {
      ...TYPES,
      "subnormal-structure": {
        ...TYPES.beam,
        name: "Subnormal Structure Probe",
        mass: 1e-320,
      },
    },
    subnormalWorld = new CANNON.World(),
    subnormalRuntime = new MultibodyRuntime({
      world: subnormalWorld,
      material: new CANNON.Material("subnormal-mass-probe"),
      catalog: JSON.stringify(subnormalCatalog),
    });
  assert.throws(
    () =>
      subnormalRuntime.start(
        JSON.stringify({
          revision: 1,
          parts: [
            {
              id: "subnormal-body",
              type: "subnormal-structure",
              pos: [0, 0, 0],
              orientation: [0, 0, 0, 1],
              config: componentDefaults(
                "subnormal-structure",
                subnormalCatalog,
              ),
            },
          ],
          connections: [],
        }),
      ),
    (error) => error?.code === "INVALID_COMPILED_ENGINE_MASS_PROPERTIES",
    "runtime startup admitted mass with non-finite Cannon reciprocals",
  );
  assert.equal(
    subnormalWorld.bodies.length,
    0,
    "startup mass preflight added a body before validating all reciprocals",
  );
  assert.equal(subnormalRuntime.bodyByPart.size, 0);
  subnormalRuntime.dispose();
}
assert.throws(
  () =>
    compileAssembly(
      {
        revision: 1,
        parts: [beam("duplicate-a", 0), beam("duplicate-b", 2.4)],
        connections: [
          connection("duplicate-edge", "duplicate-a", "B", "duplicate-b", "A"),
          connection("duplicate-edge", "duplicate-a", "B", "duplicate-b", "A"),
        ],
      },
      TYPES,
    ),
  (error) => error?.code === "DUPLICATE_CONNECTION_ID",
  "direct compiler input accepted duplicate constraint authority",
);

function assertDeepFrozen(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, "compiler output is mutable");
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

assertDeepFrozen(compiled);

const numericStringAssembly = compileAssembly(
    {
      revision: 1,
      parts: [beam("2", 0), beam("10", 2.4), beam("20", 4.8)],
      connections: [
        connection("2", "2", "B", "10", "A"),
        connection("10", "10", "B", "20", "A"),
      ],
    },
    TYPES,
  ),
  numericStringCluster = numericStringAssembly.rigidClusters[0],
  numericStringRootBody = numericStringAssembly.bodies.find(
    (body) => body.partId === numericStringCluster.rootPartId,
  );
assert.equal(numericStringCluster.rootPartId, "2");
const numericStringFrames = rigidClusterCutFramesWorld(numericStringCluster, {
  positionWorldM: numericStringRootBody.position,
  orientationWorld: numericStringRootBody.orientation,
});
assert.deepEqual(
  numericStringCluster.cutWrenchTopology.cuts.map((cut) => cut.constraintId),
  ["fixed:2", "fixed:10"],
);
assert.deepEqual(
  numericStringFrames.map((frame) => frame.constraintId),
  numericStringCluster.cutWrenchTopology.cuts.map((cut) => cut.constraintId),
);
const cluster = compiled.rigidClusters[0];
const originalBreakForceN =
  cluster.cutWrenchTopology.fixedConstraintEdges[0].breakForceN;
assert.throws(
  () => {
    cluster.cutWrenchTopology.fixedConstraintEdges[0].breakForceN = 0;
  },
  TypeError,
  "compiler-owned cluster authority was mutable",
);
assert.equal(
  cluster.cutWrenchTopology.fixedConstraintEdges[0].breakForceN,
  originalBreakForceN,
);
assert.equal(cluster.kind, "fixed-rigid-cluster-v1");
assert.deepEqual(cluster.memberPartIds, [1, 2, 3]);
assert.equal(cluster.cutWrenchTopology.kind, "tree-newton-euler-cuts-v1");
assert.equal(cluster.cutWrenchTopology.cycleRank, 0);
assert.equal(cluster.cutWrenchTopology.cuts.length, 2);
assert.equal(cluster.massProperties.sourceKind, "fixed-rigid-cluster-v1");
assert.equal(cluster.massProperties.memberMassPropertySources.length, 3);
assert.ok(
  Math.abs(cluster.massProperties.massKg - cluster.sourceMassKg) < 1e-12,
);
assert.deepEqual(cluster.dynamicMassPartIds, []);
assert.deepEqual(
  cluster.fixedConstraintIds,
  cluster.cutWrenchTopology.fixedConstraintEdges.map(
    (edge) => edge.constraintId,
  ),
);
assert.deepEqual(
  cluster.failureBoundaryConstraintIds,
  cluster.cutWrenchTopology.fixedConstraintEdges
    .filter((edge) => edge.breakForceN > 0 || edge.breakTorqueNm > 0)
    .map((edge) => edge.constraintId),
);
assert.deepEqual(
  cluster.boundaryConstraintIds,
  cluster.boundaryConstraints.map((constraint) => constraint.constraintId),
);
assert.deepEqual(
  cluster.dynamicMassPartIds,
  cluster.members
    .filter(
      (memberAuthority) => memberAuthority.runtimeMassContributorKinds.length,
    )
    .map((memberAuthority) => memberAuthority.partId),
);
const clusterRootBody = compiled.bodies.find(
  (body) => body.id === cluster.rootBodyId,
);
assert.throws(
  () =>
    rigidClusterCutFramesWorld(structuredClone(cluster), {
      positionWorldM: clusterRootBody.position,
      orientationWorld: clusterRootBody.orientation,
    }),
  /contradictory member authority/,
  "detached cluster data was accepted as compiler-owned authority",
);
const coordinatedForgery = structuredClone(cluster);
coordinatedForgery.cutWrenchTopology.fixedConstraintEdges[0].breakForceN = 0;
coordinatedForgery.failureBoundaryConstraintIds =
  coordinatedForgery.cutWrenchTopology.fixedConstraintEdges
    .filter((edge) => edge.breakForceN > 0 || edge.breakTorqueNm > 0)
    .map((edge) => edge.constraintId);
deepFreeze(coordinatedForgery);
assert.deepEqual(
  reconstructTreeCutWrenches({
    clusterDescriptor: coordinatedForgery,
    rootPose: {
      positionWorldM: clusterRootBody.position,
      orientationWorld: clusterRootBody.orientation,
    },
    members: cluster.members.map((memberAuthority) => ({
      partId: memberAuthority.partId,
      massKg: memberAuthority.massKg,
      comPositionWorldM: [0, 0, 0],
      linearAccelerationWorldMps2: [0, 0, 0],
      angularVelocityWorldRadS: [0, 0, 0],
      angularAccelerationWorldRadS2: [0, 0, 0],
      inertiaTensorWorldKgM2: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    })),
  }),
  {
    available: false,
    reason: "invalid-cut-topology-v1",
    authority: "unavailable-v1",
    failureAuthority: false,
    wrenches: [],
  },
  "coordinated detached authority forgery was accepted",
);

function releaseCouplerSnapshot(connectionIdA, connectionIdB) {
  return {
    revision: 1,
    parts: [
      {
        id: "release-left",
        type: "plate",
        pos: [0, -0.15, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 22, size: [2.4, 0.18, 2.4] },
      },
      {
        id: "release-right",
        type: "plate",
        pos: [0, 0.15, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 22, size: [2.4, 0.18, 2.4] },
      },
      {
        id: "release-coupler",
        type: "release-coupler",
        pos: [0, 0, 0],
        orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
        mechanism: mechanismComponentDefinition("release-coupler"),
      },
    ],
    connections: [
      {
        id: connectionIdA,
        a: "release-left",
        b: "release-coupler",
        kind: "mechanical",
        portA: "TOP",
        portB: "FLANGE_A",
        anchorA: [0, 0.25, 0],
        capacity: structuredClone(capacity),
        releaseCouplerPartId: "release-coupler",
      },
      {
        id: connectionIdB,
        a: "release-coupler",
        b: "release-right",
        kind: "mechanical",
        portA: "FLANGE_B",
        portB: "BOTTOM",
        anchorB: [0, -0.25, 0],
        capacity: structuredClone(capacity),
        releaseCouplerPartId: "release-coupler",
      },
    ],
  };
}

for (const [connectionIds, expectedBreakawayOrder] of [
  [
    [1, "1"],
    [1, "1"],
  ],
  [
    ["Å", "Å"],
    ["Å", "Å"],
  ],
]) {
  const releaseSnapshot = releaseCouplerSnapshot(...connectionIds),
    releaseForward = compileAssembly(releaseSnapshot, TYPES),
    releaseReversed = compileAssembly(
      {
        ...releaseSnapshot,
        parts: [...releaseSnapshot.parts].reverse(),
        connections: [...releaseSnapshot.connections].reverse(),
      },
      TYPES,
    ),
    releaseCluster = releaseForward.rigidClusters.find(
      (candidate) => candidate.memberPartIds.length === 2,
    ),
    releaseConstraint = releaseForward.constraints.find(
      (candidate) => candidate.kind === "fixed",
    ),
    releaseActuator = releaseForward.actuators.find(
      (candidate) => candidate.kind === "release-coupler-v1",
    ),
    releaseRootBody = releaseForward.bodies.find(
      (body) => body.partId === releaseCluster.rootPartId,
    );
  assert.equal(releaseForward.stats.errorCount, 0);
  assert.deepEqual(releaseReversed.rigidClusters, releaseForward.rigidClusters);
  assert.deepEqual(releaseReversed.actuators, releaseForward.actuators);
  assert.deepEqual(
    releaseActuator.breakawayConnectionIds,
    expectedBreakawayOrder,
  );
  assert.deepEqual(
    releaseConstraint.failureAttachments.map(
      ({ connectionId, side, bodyPartId }) => ({
        connectionId,
        side,
        bodyPartId,
      }),
    ),
    [
      {
        connectionId: connectionIds[0],
        side: "A",
        bodyPartId: "release-left",
      },
      {
        connectionId: connectionIds[1],
        side: "B",
        bodyPartId: "release-right",
      },
    ],
  );
  assert.doesNotThrow(() =>
    rigidClusterCutFramesWorld(releaseCluster, {
      positionWorldM: releaseRootBody.position,
      orientationWorld: releaseRootBody.orientation,
    }),
  );
  const swappedReleaseProvenance = structuredClone(releaseCluster);
  swappedReleaseProvenance.cutWrenchTopology.cuts[0].failureAttachments =
    swappedReleaseProvenance.cutWrenchTopology.cuts[0].failureAttachments.map(
      (attachment, index, attachments) => ({
        ...attachment,
        connectionId: attachments[1 - index].connectionId,
      }),
    );
  assert.throws(
    () =>
      rigidClusterCutFramesWorld(swappedReleaseProvenance, {
        positionWorldM: releaseRootBody.position,
        orientationWorld: releaseRootBody.orientation,
      }),
    /contradictory (?:member authority|cut-wrench topology)/,
  );
  const jointlySwappedReleaseProvenance = structuredClone(releaseCluster),
    jointlySwappedCut =
      jointlySwappedReleaseProvenance.cutWrenchTopology.cuts[0];
  jointlySwappedCut.sourceConnectionIds = [
    ...jointlySwappedCut.sourceConnectionIds,
  ].reverse();
  jointlySwappedCut.failureAttachments =
    jointlySwappedCut.failureAttachments.map(
      (attachment, index, attachments) => ({
        ...attachment,
        connectionId: attachments[1 - index].connectionId,
      }),
    );
  assert.throws(
    () =>
      rigidClusterCutFramesWorld(jointlySwappedReleaseProvenance, {
        positionWorldM: releaseRootBody.position,
        orientationWorld: releaseRootBody.orientation,
      }),
    /contradictory (?:member authority|cut-wrench topology)/,
  );
}

const gasReservoir = compileAssembly(
  {
    revision: 1,
    parts: [
      {
        id: "gas",
        type: "airreservoir",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        config: componentDefaults("airreservoir"),
      },
    ],
    connections: [],
  },
  TYPES,
);
assert.equal(gasReservoir.stats.errorCount, 0);
assert.deepEqual(gasReservoir.rigidClusters[0].dynamicMassPartIds, ["gas"]);
const gasCluster = gasReservoir.rigidClusters[0],
  gasRootBody = gasReservoir.bodies.find(
    (body) => body.id === gasCluster.rootBodyId,
  ),
  missingDynamicMassAuthority = structuredClone(gasCluster);
missingDynamicMassAuthority.dynamicMassPartIds = [];
assert.throws(
  () =>
    rigidClusterCutFramesWorld(missingDynamicMassAuthority, {
      positionWorldM: gasRootBody.position,
      orientationWorld: gasRootBody.orientation,
    }),
  /contradictory member authority/,
);

const endpointMassDescriptor = structuredClone(
  geometryDescriptorForType("beam"),
);
endpointMassDescriptor.massProperties.endpointPointMasses = [
  {
    sourcePartId: "damper",
    sourceConnectionId: "damper-endpoint",
    sourcePortId: "A",
    targetPartId: "beam",
    targetPortId: "B",
    positionFramePartId: "beam",
    massKg: 0,
    positionPartM: [0, 0, 0],
  },
];
assert.doesNotThrow(() =>
  validateGeometryDescriptorOrThrow(endpointMassDescriptor),
);
for (const invalidEndpointMasses of [null, undefined]) {
  const invalidDescriptor = structuredClone(endpointMassDescriptor);
  invalidDescriptor.massProperties.endpointPointMasses = invalidEndpointMasses;
  assert.throws(
    () => validateGeometryDescriptorOrThrow(invalidDescriptor),
    /Endpoint point masses must be an array/,
  );
}
for (const mutate of [
  (point) => {
    point.sourceConnectionId = "";
  },
  (point) => {
    point.positionFramePartId = "forged-frame-owner";
  },
  (point) => {
    point.targetPortId = "";
  },
  (point) => {
    point.massKg = -3;
  },
  (point) => {
    point.positionPartM = [Number.POSITIVE_INFINITY, 0, 0];
  },
]) {
  const hostileMassProperties = structuredClone(
    endpointMassDescriptor.massProperties,
  );
  mutate(hostileMassProperties.endpointPointMasses[0]);
  assert.throws(() =>
    composeRigidBodyMassProperties([
      {
        bodyId: "hostile-endpoint-provenance",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: hostileMassProperties,
      },
    ]),
  );
}

const constraintById = new Map(
  compiled.constraints.map((constraint) => [constraint.id, constraint]),
);
for (const cut of cluster.cutWrenchTopology.cuts) {
  const constraint = constraintById.get(cut.constraintId);
  assert.ok(constraint);
  assert.equal(cut.subtreePartIds.includes(cut.childPartId), true);
  assert.equal(cut.subtreePartIds.includes(cluster.rootPartId), false);
  assert.deepEqual(cut.sourceConnectionIds, constraint.sourceConnectionIds);
  assert.deepEqual(cut.failureAttachments, constraint.failureAttachments);
  assert.equal(cut.parentAttachmentFrame.partId, cut.parentPartId);
  assert.equal(cut.childAttachmentFrame.partId, cut.childPartId);
  for (const frame of [cut.parentAttachmentFrame, cut.childAttachmentFrame]) {
    assert.equal(frame.positionPartM.length, 3);
    assert.equal(frame.positionClusterM.length, 3);
    assert.equal(frame.orientationPart.length, 4);
    assert.equal(frame.orientationCluster.length, 4);
    assert.ok(
      [
        ...frame.positionPartM,
        ...frame.positionClusterM,
        ...frame.orientationPart,
        ...frame.orientationCluster,
      ].every(Number.isFinite),
    );
  }
  const adjacency = new Map(
    cluster.memberPartIds.map((partId) => [partId, new Set()]),
  );
  for (const constraintId of cluster.fixedConstraintIds) {
    if (constraintId === cut.constraintId) continue;
    const retained = constraintById.get(constraintId);
    adjacency.get(retained.a).add(retained.b);
    adjacency.get(retained.b).add(retained.a);
  }
  const reachable = new Set([cut.childPartId]),
    pending = [cut.childPartId];
  while (pending.length) {
    const current = pending.pop();
    for (const neighbor of adjacency.get(current)) {
      if (reachable.has(neighbor)) continue;
      reachable.add(neighbor);
      pending.push(neighbor);
    }
  }
  assert.deepEqual(
    [...reachable].sort(),
    [...cut.subtreePartIds].sort(),
    `cut ${String(cut.constraintId)} is not an independent graph partition`,
  );
}

const reversed = compileAssembly(
  {
    ...chain,
    parts: [...chain.parts].reverse(),
    connections: [...chain.connections].reverse(),
  },
  TYPES,
);
assert.deepEqual(
  reversed.rigidClusters,
  compiled.rigidClusters,
  "cluster descriptors depend on authored array order",
);
assert.equal(
  compiledTopologyFingerprint(reversed),
  compiledTopologyFingerprint(compiled),
  "physical identity depended on authored entity order",
);
assert.notEqual(
  compiledTopologyFingerprint({
    ...compiled,
    constraints: [...compiled.constraints].reverse(),
  }),
  compiledTopologyFingerprint(compiled),
  "physical identity erased the finite-solver constraint execution order",
);
function orderedChainRuntime(snapshot, label) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.80665, 0) });
  configureCannonWorldSolverProfile(world, WORKSHOP_CANNON_SOLVER_PROFILE);
  const worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material(label),
      catalog: TYPES,
      fixedDt: 1 / 120,
    });
  runtime.start(JSON.stringify(snapshot));
  worldAdapter.beginSession();
  return { world, worldAdapter, runtime };
}
function disposeOrderedRuntime(value) {
  value.runtime.dispose();
  value.worldAdapter.dispose();
}
function integrateOrderedRuntime(value, steps = 60) {
  for (let step = 0; step < steps; step++)
    value.worldAdapter.integrate(WORKSHOP_CANNON_SOLVER_PROFILE.fixedDt, {
      tick: value.worldAdapter.telemetry().tick + 1,
    });
}
function continueOrderedRuntime(value, steps = 60) {
  integrateOrderedRuntime(value, steps);
  return value.runtime.exportState();
}
function orderedBodyKinematics(value) {
  return [...value.runtime.bodyByPart]
    .sort(([left], [right]) => compareCanonicalIds(left, right))
    .map(([partId, body]) => ({
      partId,
      position: body.position.toArray(),
      quaternion: body.quaternion.toArray(),
      velocity: body.velocity.toArray(),
      angularVelocity: body.angularVelocity.toArray(),
    }));
}
const engineAuthorityHingeAssembly = {
  revision: 1,
  parts: [
    {
      id: "authority-base",
      type: "plate",
      pos: [-1.2, 1, 0],
      orientation: [0, 0, 0, 1],
      config: componentDefaults("plate"),
    },
    {
      id: "authority-hinge",
      type: "hinge",
      pos: [0, 1, 0],
      orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      mechanism: structuredClone(mechanismComponentDefinition("hinge")),
    },
    { ...beam("authority-arm", 1.2), pos: [1.2, 1, 0] },
  ],
  connections: [
    {
      id: "authority-hinge-base",
      a: "authority-base",
      b: "authority-hinge",
      kind: "mechanical",
      portA: "TOP",
      portB: "BASE",
      anchorA: [1.2, 0, 0],
      capacity: structuredClone(capacity),
    },
    {
      id: "authority-hinge-arm",
      a: "authority-hinge",
      b: "authority-arm",
      kind: "mechanical",
      portA: "ARM",
      portB: "A",
      capacity: structuredClone(capacity),
    },
  ],
};
function assertLiveEngineAuthorityMutation(snapshot, label, mutate) {
  const value = orderedChainRuntime(snapshot, `live-authority-${label}`);
  mutate(value);
  assert.throws(
    () => value.runtime.exportState(),
    (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
    `${label} escaped live engine-authority validation`,
  );
  disposeOrderedRuntime(value);
}
for (const [label, mutate] of [
  [
    "body-material",
    ({ runtime }) => {
      runtime.bodyByPart.values().next().value.material = new CANNON.Material(
        "forged-body-material",
      );
    },
  ],
  [
    "body-filter",
    ({ runtime }) => {
      runtime.bodyByPart.values().next().value.collisionFilterMask ^= 2;
    },
  ],
  [
    "body-damping",
    ({ runtime }) => {
      runtime.bodyByPart.values().next().value.linearDamping += 0.01;
    },
  ],
  [
    "body-type",
    ({ runtime }) => {
      runtime.bodyByPart.values().next().value.type = CANNON.Body.STATIC;
    },
  ],
  [
    "shape-geometry",
    ({ runtime }) => {
      const shape = runtime.bodyByPart.values().next().value.shapes[0];
      assert.ok(shape.halfExtents, "authority fixture requires a box shape");
      shape.halfExtents.x += 0.01;
    },
  ],
  [
    "body-world-membership",
    ({ runtime, world }) => {
      world.removeBody(runtime.bodyByPart.values().next().value);
    },
  ],
])
  assertLiveEngineAuthorityMutation(chain, label, mutate);
for (const [label, mutate] of [
  [
    "constraint-pivot",
    ({ runtime }) => {
      runtime.constraintEntries.find(
        (entry) => entry.descriptor.kind === "revolute",
      ).constraint.pivotA.x += 0.01;
    },
  ],
  [
    "constraint-axis",
    ({ runtime }) => {
      runtime.constraintEntries.find(
        (entry) => entry.descriptor.kind === "revolute",
      ).constraint.axisA.x += 0.01;
    },
  ],
  [
    "constraint-collision-policy",
    ({ runtime }) => {
      const constraint = runtime.constraintEntries.find(
        (entry) => entry.constraint,
      ).constraint;
      constraint.collideConnected = !constraint.collideConnected;
    },
  ],
  [
    "constraint-equation-bound",
    ({ runtime }) => {
      runtime.constraintEntries.find(
        (entry) => entry.constraint,
      ).constraint.equations[0].maxForce *= 0.5;
    },
  ],
  [
    "constraint-world-membership",
    ({ runtime, world }) => {
      world.removeConstraint(
        runtime.constraintEntries.find((entry) => entry.constraint).constraint,
      );
    },
  ],
])
  assertLiveEngineAuthorityMutation(
    engineAuthorityHingeAssembly,
    label,
    mutate,
  );

const twoBodyStartupAssembly = {
  revision: 1,
  parts: [beam("startup-a", 0), beam("startup-b", 5)],
  connections: [],
};
for (const failAt of [1, 2]) {
  const world = new CANNON.World(),
    externalBody = new CANNON.Body({ mass: 0 }),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material(`startup-body-${failAt}`),
      catalog: TYPES,
    });
  world.addBody(externalBody);
  const baselineBodies = [...world.bodies],
    baselineConstraints = [...world.constraints],
    originalAddBody = world.addBody.bind(world);
  let calls = 0;
  world.addBody = (body) => {
    calls++;
    if (calls === failAt) throw new Error(`injected addBody ${failAt}`);
    return originalAddBody(body);
  };
  assert.throws(
    () => runtime.start(JSON.stringify(twoBodyStartupAssembly)),
    (error) => error?.code === "MULTIBODY_START_ENGINE_INSTALL_FAILED",
  );
  world.addBody = originalAddBody;
  assert.deepEqual(world.bodies, baselineBodies);
  assert.deepEqual(world.constraints, baselineConstraints);
  assert.equal(runtime.compiled, null);
  assert.equal(runtime.bodyByPart.size, 0);
  assert.equal(runtime.constraintEntries.length, 0);
  runtime.dispose();
  worldAdapter.dispose();
}
{
  const world = new CANNON.World(),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("startup-constraint"),
      catalog: TYPES,
    }),
    originalAddConstraint = world.addConstraint.bind(world),
    baselineBodies = [...world.bodies],
    baselineConstraints = [...world.constraints];
  let injected = false;
  world.addConstraint = (constraint) => {
    if (!injected) {
      injected = true;
      throw new Error("injected addConstraint");
    }
    return originalAddConstraint(constraint);
  };
  assert.throws(
    () => runtime.start(JSON.stringify(engineAuthorityHingeAssembly)),
    (error) => error?.code === "MULTIBODY_START_ENGINE_INSTALL_FAILED",
  );
  world.addConstraint = originalAddConstraint;
  assert.deepEqual(world.bodies, baselineBodies);
  assert.deepEqual(world.constraints, baselineConstraints);
  assert.equal(runtime.compiled, null);
  assert.equal(runtime.bodyByPart.size, 0);
  assert.equal(runtime.constraintEntries.length, 0);
  runtime.dispose();
  worldAdapter.dispose();
}
{
  const value = orderedChainRuntime(chain, "running-restart-rejection"),
    baseline = value.runtime.exportState(),
    bodies = [...value.world.bodies],
    constraints = [...value.world.constraints];
  assert.throws(
    () => value.runtime.start(JSON.stringify(twoBodyStartupAssembly)),
    (error) => error?.code === "MULTIBODY_RUNTIME_ALREADY_STARTED",
  );
  assert.deepEqual(value.runtime.exportState(), baseline);
  assert.deepEqual(value.world.bodies, bodies);
  assert.deepEqual(value.world.constraints, constraints);
  disposeOrderedRuntime(value);
}
{
  const forward = orderedChainRuntime(chain, "ordered-chain-forward"),
    backward = orderedChainRuntime(
      {
        ...chain,
        parts: [...chain.parts].reverse(),
        connections: [...chain.connections].reverse(),
      },
      "ordered-chain-backward",
    ),
    state = forward.runtime.exportState();
  importMultibodyState(forward.runtime, state);
  importMultibodyState(backward.runtime, state);
  assert.deepEqual(
    backward.world.bodies.map((body) => body.userData?.compiledBodyId),
    forward.world.bodies.map((body) => body.userData?.compiledBodyId),
    "authored order changed Cannon body insertion order",
  );
  assert.deepEqual(
    backward.runtime.constraintEntries.map((entry) => entry.descriptor.id),
    forward.runtime.constraintEntries.map((entry) => entry.descriptor.id),
    "authored order changed Cannon constraint insertion order",
  );
  assert.deepEqual(
    continueOrderedRuntime(backward),
    continueOrderedRuntime(forward),
    "order-equivalent checkpoint continuation diverged",
  );
  disposeOrderedRuntime(forward);
  disposeOrderedRuntime(backward);
}
{
  const qualified = orderedChainRuntime(chain, "qualified-solver-order"),
    permuted = orderedChainRuntime(chain, "permuted-solver-order");
  assert.deepEqual(
    {
      iterations: qualified.world.solver.iterations,
      tolerance: qualified.world.solver.tolerance,
    },
    {
      iterations: WORKSHOP_CANNON_SOLVER_PROFILE.iterations,
      tolerance: WORKSHOP_CANNON_SOLVER_PROFILE.tolerance,
    },
    "solver-order qualification did not use the production profile",
  );
  permuted.world.constraints.reverse();
  integrateOrderedRuntime(qualified);
  integrateOrderedRuntime(permuted);
  assert.notDeepEqual(
    orderedBodyKinematics(permuted),
    orderedBodyKinematics(qualified),
    "production finite solver erased a hostile constraint-order permutation",
  );
  disposeOrderedRuntime(qualified);
  disposeOrderedRuntime(permuted);
}
{
  const assemblySnapshot = {
      revision: 1,
      parts: [
        {
          id: "dynamic-reservoir",
          type: "airreservoir",
          pos: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          config: componentDefaults("airreservoir"),
        },
        {
          id: "atomic-companion",
          type: "airreservoir",
          pos: [3, 0, 0],
          orientation: [0, 0, 0, 1],
          config: componentDefaults("airreservoir"),
        },
      ],
      connections: [],
    },
    value = orderedChainRuntime(
      assemblySnapshot,
      "atomic-mass-property-commit",
    ),
    baseline = value.runtime.exportState(),
    reservoirDescriptor = value.runtime.compiled.bodies.find(
      (descriptor) => descriptor.partId === "dynamic-reservoir",
    ),
    companionDescriptor = value.runtime.compiled.bodies.find(
      (descriptor) => descriptor.partId === "atomic-companion",
    ),
    validDynamicProperties = deriveDynamicMassProperties(reservoirDescriptor, {
      structuralMassKg: reservoirDescriptor.massProperties.massKg,
      additionalMassContributions: [
        {
          id: dynamicMassContributorIdentity(
            "pneumatic-gas",
            "dynamic-reservoir",
          ),
          massKg: 1,
          centerPartM: [0, 0, 0],
          inertiaTensorAtCenterKgM2: {
            xx: 0,
            yy: 0,
            zz: 0,
            xy: 0,
            xz: 0,
            yz: 0,
          },
        },
      ],
    }),
    validCompanionProperties = deriveDynamicMassProperties(
      companionDescriptor,
      {
        structuralMassKg: companionDescriptor.massProperties.massKg,
        additionalMassContributions: [
          {
            id: dynamicMassContributorIdentity(
              "pneumatic-gas",
              "atomic-companion",
            ),
            massKg: 2,
            centerPartM: [0, 0, 0],
            inertiaTensorAtCenterKgM2: {
              xx: 0,
              yy: 0,
              zz: 0,
              xy: 0,
              xz: 0,
              yz: 0,
            },
          },
        ],
      },
    ),
    invalidCompanionProperties = {
      ...structuredClone(companionDescriptor.massProperties),
      rogueAuthority: () => 1,
    };
  assert.throws(
    () =>
      commitOwnedMultibodyMassProperties(value.runtime, [
        {
          partId: "dynamic-reservoir",
          massProperties: validDynamicProperties,
        },
        {
          partId: "atomic-companion",
          massProperties: invalidCompanionProperties,
        },
      ]),
    (error) => error?.code === "INVALID_MASS_PROPERTY_TRANSACTION",
    "late invalid mass record partially committed an earlier valid body",
  );
  assert.deepEqual(
    value.runtime.exportState(),
    baseline,
    "rejected multi-body mass transaction mutated live physics",
  );
  const contradictoryAxes = structuredClone(reservoirDescriptor.massProperties);
  contradictoryAxes.principalAxesPart = [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
  ];
  assert.throws(
    () =>
      commitOwnedMultibodyMassProperties(value.runtime, [
        {
          partId: "dynamic-reservoir",
          massProperties: contradictoryAxes,
        },
      ]),
    (error) => error?.code === "INVALID_MASS_PROPERTIES",
    "mass commit accepted a contradictory finite principal-axis decomposition",
  );
  assert.deepEqual(
    value.runtime.exportState(),
    baseline,
    "principal-axis rejection mutated live physics",
  );
  const forgedOwnerlessProjection = deriveDynamicMassProperties(
    reservoirDescriptor,
    {
      structuralMassKg: reservoirDescriptor.massProperties.massKg,
      additionalPointMasses: [
        {
          id: "forged-ownerless-mass",
          massKg: reservoirDescriptor.massProperties.massKg,
          centerPartM: [0, 0, 0],
        },
      ],
    },
  );
  assert.throws(
    () =>
      value.runtime.commitMassProperties([
        {
          partId: "dynamic-reservoir",
          massProperties: forgedOwnerlessProjection,
        },
      ]),
    (error) => error?.code === "MASS_PROPERTY_OWNER_REQUIRED",
    "public runtime mass mutation manufactured ownerless dynamic mass",
  );
  assert.deepEqual(
    value.runtime.exportState(),
    baseline,
    "owner-required rejection mutated live physics",
  );
  const subnormalMassProperties = structuredClone(validDynamicProperties);
  subnormalMassProperties.massKg = 1e-320;
  assert.throws(
    () =>
      commitOwnedMultibodyMassProperties(value.runtime, [
        {
          partId: "dynamic-reservoir",
          massProperties: subnormalMassProperties,
        },
      ]),
    (error) => error?.code === "INVALID_MASS_PROPERTIES",
    "mass commit accepted properties with a non-finite engine reciprocal",
  );
  let accessorReads = 0;
  const accessorMassProperties = structuredClone(validDynamicProperties);
  Object.defineProperty(accessorMassProperties, "massKg", {
    enumerable: true,
    get() {
      accessorReads++;
      return accessorReads === 1
        ? validDynamicProperties.massKg
        : validDynamicProperties.massKg * 2;
    },
  });
  assert.throws(
    () =>
      commitOwnedMultibodyMassProperties(value.runtime, [
        {
          partId: "dynamic-reservoir",
          massProperties: accessorMassProperties,
        },
      ]),
    (error) => error?.code === "INVALID_MASS_PROPERTY_TRANSACTION",
    "mass commit accepted an accessor-controlled projection",
  );
  assert.equal(accessorReads, 0, "mass validation executed a caller accessor");
  const customPrototypeProperties = structuredClone(validDynamicProperties);
  Object.setPrototypeOf(customPrototypeProperties, { forged: true });
  assert.throws(
    () =>
      commitOwnedMultibodyMassProperties(value.runtime, [
        {
          partId: "dynamic-reservoir",
          massProperties: customPrototypeProperties,
        },
      ]),
    (error) => error?.code === "INVALID_MASS_PROPERTY_TRANSACTION",
    "mass commit accepted a custom-prototype projection",
  );
  const lateFailureBody = value.runtime.bodyByPart.get("atomic-companion"),
    originalUpdateAabb = lateFailureBody.updateAABB;
  lateFailureBody.updateAABB = () => {
    throw new Error("injected late AABB failure");
  };
  assert.throws(
    () =>
      commitOwnedMultibodyMassProperties(value.runtime, [
        {
          partId: "dynamic-reservoir",
          massProperties: validDynamicProperties,
        },
        {
          partId: "atomic-companion",
          massProperties: validCompanionProperties,
        },
      ]),
    (error) => error?.code === "MASS_PROPERTY_ENGINE_COMMIT_FAILED",
    "late engine failure escaped the atomic mass transaction",
  );
  lateFailureBody.updateAABB = originalUpdateAabb;
  assert.deepEqual(
    value.runtime.exportState(),
    baseline,
    "late engine failure left partially committed body state",
  );
  commitOwnedMultibodyMassProperties(value.runtime, [
    {
      partId: "dynamic-reservoir",
      massProperties: validDynamicProperties,
    },
  ]);
  assert.equal(
    value.runtime.bodyByPart.get("dynamic-reservoir").mass,
    validDynamicProperties.massKg,
    "compiled pneumatic contributor could not commit an authorized mass projection",
  );
  disposeOrderedRuntime(value);
}
{
  const control = orderedChainRuntime(chain, "rejection-order-control"),
    rejected = orderedChainRuntime(chain, "rejection-order-hostile"),
    state = control.runtime.exportState();
  importMultibodyState(control.runtime, state);
  importMultibodyState(rejected.runtime, state);
  const beforeOrder = rejected.world.constraints.map(
      (constraint) =>
        rejected.runtime.constraintEntries.find(
          (entry) => entry.constraint === constraint,
        )?.descriptor.id,
    ),
    forgedFixedFrame = structuredClone(state),
    hostile = structuredClone(state),
    fixedEntries = hostile.entries.filter((entry) => entry.fixedFrame !== null),
    disabledDescriptor = rejected.runtime.constraintEntries.find(
      (entry) => entry.descriptor.id === fixedEntries[0].id,
    ),
    disabledExclusion = rejected.runtime.collisionExclusionConstraints.find(
      (entry) =>
        entry.descriptor.sourceConstraintIds.includes(
          disabledDescriptor.descriptor.id,
        ),
    );
  forgedFixedFrame.entries.find(
    (entry) => entry.fixedFrame !== null,
  ).fixedFrame.pivotA.x += 10;
  assert.throws(
    () => importMultibodyState(rejected.runtime, forgedFixedFrame),
    (error) => error?.code === "MULTIBODY_CHECKPOINT_FIXED_FRAME_MISMATCH",
    "finite forged fixed-constraint frame was accepted",
  );
  assert.deepEqual(
    rejected.runtime.exportState(),
    state,
    "fixed-frame authority rejection mutated the running state",
  );
  fixedEntries[0].values.active = false;
  hostile.exclusionStates.find(
    (entry) => entry.id === disabledExclusion.descriptor.id,
  ).active = false;
  fixedEntries[1].fixedFrame = null;
  assert.throws(
    () => importMultibodyState(rejected.runtime, hostile),
    (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_CONSTRAINT_STATE",
    "late fixed-frame rejection was accepted",
  );
  assert.deepEqual(
    rejected.world.constraints.map(
      (constraint) =>
        rejected.runtime.constraintEntries.find(
          (entry) => entry.constraint === constraint,
        )?.descriptor.id,
    ),
    beforeOrder,
    "rejected import changed hidden solver constraint ordering",
  );
  assert.deepEqual(
    continueOrderedRuntime(rejected),
    continueOrderedRuntime(control),
    "rejected import changed future physics continuation",
  );
  disposeOrderedRuntime(control);
  disposeOrderedRuntime(rejected);
}
{
  const value = orderedChainRuntime(
      engineAuthorityHingeAssembly,
      "checkpoint-engine-rollback",
    ),
    baseline = value.runtime.exportState(),
    candidate = structuredClone(baseline),
    originalReset = value.world.collisionMatrix.reset.bind(
      value.world.collisionMatrix,
    );
  candidate.bodies[0].position.x += 0.25;
  let failOnce = true;
  value.world.collisionMatrix.reset = () => {
    if (failOnce) {
      failOnce = false;
      throw new Error("injected post-commit collision-cache failure");
    }
    return originalReset();
  };
  assert.throws(
    () => importMultibodyState(value.runtime, candidate),
    (error) => error?.code === "MULTIBODY_CHECKPOINT_ENGINE_COMMIT_FAILED",
    "late engine import failure escaped the checkpoint transaction",
  );
  value.world.collisionMatrix.reset = originalReset;
  assert.deepEqual(
    value.runtime.exportState(),
    baseline,
    "late engine import failure did not restore exact live state",
  );
  disposeOrderedRuntime(value);
}
{
  const control = orderedChainRuntime(chain, "cross-owner-order-control"),
    restored = orderedChainRuntime(chain, "cross-owner-order-restored"),
    addUnmanagedConstraint = (value) => {
      const extra = new CANNON.DistanceConstraint(
        value.runtime.bodyByPart.get(1),
        value.runtime.bodyByPart.get(2),
        0.5,
        1_000_000,
      );
      value.world.addConstraint(extra);
      return extra;
    },
    controlExtra = addUnmanagedConstraint(control),
    restoredExtra = addUnmanagedConstraint(restored),
    order = (value, extra) =>
      value.world.constraints.map((constraint) =>
        constraint === extra
          ? "unmanaged"
          : value.runtime.constraintEntries.find(
              (entry) => entry.constraint === constraint,
            )?.descriptor.id,
      ),
    beforeOrder = order(restored, restoredExtra),
    checkpoint = restored.runtime.exportState();
  assert.deepEqual(order(control, controlExtra), beforeOrder);
  importMultibodyState(restored.runtime, checkpoint);
  assert.deepEqual(
    order(restored, restoredExtra),
    beforeOrder,
    "multibody self-restore reordered another solver owner's constraint",
  );
  const inactiveCheckpoint = structuredClone(checkpoint);
  for (const entry of inactiveCheckpoint.entries) entry.values.active = false;
  for (const exclusion of inactiveCheckpoint.exclusionStates)
    exclusion.active = false;
  importMultibodyState(restored.runtime, inactiveCheckpoint);
  assert.deepEqual(
    order(restored, restoredExtra),
    ["unmanaged"],
    "inactive managed constraints did not leave the other owner in place",
  );
  importMultibodyState(restored.runtime, checkpoint);
  assert.deepEqual(
    order(restored, restoredExtra),
    beforeOrder,
    "reactivating a fully absent owner block crossed another owner",
  );
  assert.deepEqual(
    continueOrderedRuntime(restored, 30),
    continueOrderedRuntime(control, 30),
    "cross-owner constraint reordering changed future continuation",
  );
  disposeOrderedRuntime(control);
  disposeOrderedRuntime(restored);
}
const networkOrderSnapshot = {
    revision: 1,
    parts: [beam("network-a", 0), beam("network-b", 3), beam("network-c", 6)],
    connections: [
      { id: "power-ab", a: "network-a", b: "network-b", kind: "power" },
      { id: "power-bc", a: "network-b", b: "network-c", kind: "power" },
    ],
  },
  networkOrderForward = compileAssembly(networkOrderSnapshot, TYPES),
  networkOrderReversed = compileAssembly(
    {
      ...networkOrderSnapshot,
      parts: [...networkOrderSnapshot.parts].reverse(),
      connections: [...networkOrderSnapshot.connections].reverse(),
    },
    TYPES,
  );
assert.equal(
  compiledTopologyFingerprint(networkOrderReversed),
  compiledTopologyFingerprint(networkOrderForward),
  "physical identity depended on authored network order",
);
assert.notEqual(
  compiledTopologyFingerprint({
    ...networkOrderForward,
    networks: {
      ...networkOrderForward.networks,
      power: [...networkOrderForward.networks.power].reverse(),
    },
  }),
  compiledTopologyFingerprint(networkOrderForward),
  "physical identity erased runtime network execution order",
);
const changedCapacityCompilation = compileAssembly(
    {
      ...chain,
      connections: chain.connections.map((record, index) =>
        index === 0
          ? {
              ...record,
              capacity: {
                ...record.capacity,
                ultimateForceN: record.capacity.ultimateForceN / 2,
              },
            }
          : record,
      ),
    },
    TYPES,
  ),
  changedFrameCompilation = compileAssembly(
    {
      ...chain,
      parts: chain.parts.map((part, index) =>
        index === 2 ? { ...part, pos: [part.pos[0] + 0.25, 0, 0] } : part,
      ),
    },
    TYPES,
  );
assert.notEqual(
  compiledTopologyFingerprint(changedCapacityCompilation),
  compiledTopologyFingerprint(compiled),
  "run identity ignored changed physical capacity semantics",
);
assert.notEqual(
  compiledTopologyFingerprint(changedFrameCompilation),
  compiledTopologyFingerprint(compiled),
  "run identity ignored changed physical frame semantics",
);

const mixedStringIds = {
    revision: 1,
    parts: [beam("1", 2.4), beam("01", 0)],
    connections: [connection("mixed-cut", "01", "B", "1", "A")],
  },
  mixedForward = compileAssembly(mixedStringIds, TYPES).rigidClusters,
  mixedReversed = compileAssembly(
    {
      ...mixedStringIds,
      parts: [...mixedStringIds.parts].reverse(),
    },
    TYPES,
  ).rigidClusters;
assert.deepEqual(mixedForward, mixedReversed);
assert.deepEqual(mixedForward[0].memberPartIds, ["01", "1"]);
assert.equal(mixedForward[0].id, "rigid-cluster:string:2:01");

const ordinaryStringChain = compileAssembly(
  {
    revision: 1,
    parts: [beam("a", 0), beam("b", 2.4), beam("c", 4.8)],
    connections: [
      connection("ab", "a", "B", "b", "A"),
      connection("bc", "b", "B", "c", "A"),
    ],
  },
  TYPES,
);
assert.equal(
  ordinaryStringChain.collisionExclusions.find(
    (exclusion) => exclusion.a === "a" && exclusion.b === "c",
  )?.id,
  "collision-exclusion:a:c",
  "ordinary string collision projection changed from the legacy contract",
);

const delimiterIdentitySnapshot = {
    revision: 1,
    parts: [
      beam("a:b", 0),
      beam("left-middle", 2.4),
      beam("c", 4.8),
      beam("a", 10),
      beam("right-middle", 12.4),
      beam("b:c", 14.8),
    ],
    connections: [
      connection("left-1", "a:b", "B", "left-middle", "A"),
      connection("left-2", "left-middle", "B", "c", "A"),
      connection("right-1", "a", "B", "right-middle", "A"),
      connection("right-2", "right-middle", "B", "b:c", "A"),
    ],
  },
  delimiterIdentityCompilation = compileAssembly(
    delimiterIdentitySnapshot,
    TYPES,
  );
assert.equal(delimiterIdentityCompilation.collisionExclusions.length, 2);
assert.equal(
  new Set(delimiterIdentityCompilation.collisionExclusions.map(({ id }) => id))
    .size,
  2,
  "valid delimiter-bearing string pairs collided in public exclusion IDs",
);
{
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("delimiter-identity-checkpoint"),
      catalog: TYPES,
    });
  runtime.start(JSON.stringify(delimiterIdentitySnapshot));
  runtime.applyConnectionFailures([{ id: "left-1", failed: true }]);
  const state = runtime.exportState(),
    expectedStates = state.exclusionStates.map(({ active }) => active);
  assert.deepEqual(
    [...expectedStates].sort(),
    [false, true],
    "physical topology did not derive independent exclusion activity",
  );
  const hostileActivity = structuredClone(state);
  hostileActivity.exclusionStates[0].active =
    !hostileActivity.exclusionStates[0].active;
  assert.throws(
    () => importMultibodyState(runtime, hostileActivity),
    (error) =>
      error?.code ===
      "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_ACTIVITY_MISMATCH",
  );
  assert.deepEqual(
    runtime.exportState(),
    state,
    "rejected exclusion activity mutated the running physics state",
  );
  for (const mutate of [
    (hostile) => {
      hostile.exclusionStates[0].id = "forged-exclusion-id";
    },
    (hostile) => {
      hostile.exclusionStates.pop();
    },
    (hostile) => {
      hostile.exclusionStates.push(structuredClone(hostile.exclusionStates[0]));
    },
    (hostile) => {
      hostile.exclusionStates.push({
        id: "extraneous-exclusion-id",
        active: true,
      });
    },
  ]) {
    const hostile = structuredClone(state);
    mutate(hostile);
    assert.throws(
      () => importMultibodyState(runtime, hostile),
      (error) =>
        error?.code === "MULTIBODY_CHECKPOINT_COLLISION_EXCLUSION_MISMATCH",
    );
    assert.deepEqual(
      runtime.exportState(),
      state,
      "rejected exclusion identity mutated the running physics state",
    );
  }
  for (const entry of runtime.collisionExclusionConstraints)
    entry.active = true;
  assert.throws(
    () => importMultibodyState(runtime, state),
    (error) => error?.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
    "direct import must not normalize a mutated live exclusion owner",
  );
  runtime.collisionExclusionConstraints.forEach((entry, index) => {
    entry.active = expectedStates[index];
  });
  importMultibodyState(runtime, state);
  assert.deepEqual(
    runtime.collisionExclusionConstraints.map(
      (entry) => entry.active !== false,
    ),
    expectedStates,
    "checkpoint import collapsed delimiter-bearing exclusion identities",
  );
  runtime.dispose();
  worldAdapter.dispose();
}

const mixedTypeSingletons = compileAssembly(
  {
    revision: 1,
    parts: [beam(1, 0), beam("1", 10)],
    connections: [],
  },
  TYPES,
).rigidClusters;
assert.equal(mixedTypeSingletons.length, 2);
assert.equal(
  new Set(mixedTypeSingletons.map((candidate) => candidate.id)).size,
  2,
  "numeric and string part IDs collided in rigid-cluster identity",
);
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      { ...mixedTypeSingletons[0], rootPartId: "not-a-member" },
      { positionWorldM: [0, 0, 0], orientationWorld: [0, 0, 0, 1] },
    ),
  /contradictory member authority/,
);

const mixedTypedSnapshot = {
    revision: 1,
    parts: [beam(1, 0), beam(2, 2.4), beam("1", 4.8)],
    connections: [
      connection(1, 1, "B", 2, "A"),
      connection("1", 2, "B", "1", "A"),
    ],
  },
  mixedTypedChain = compileAssembly(mixedTypedSnapshot, TYPES),
  mixedTypedReversed = compileAssembly(
    {
      ...mixedTypedSnapshot,
      connections: [...mixedTypedSnapshot.connections].reverse(),
    },
    TYPES,
  );
assert.equal(mixedTypedChain.stats.errorCount, 0);
assert.deepEqual(
  mixedTypedReversed.collisionExclusions,
  mixedTypedChain.collisionExclusions,
  "mixed-ID collision provenance depended on authored connection order",
);
assert.deepEqual(
  mixedTypedReversed.rigidClusters,
  mixedTypedChain.rigidClusters,
  "mixed-ID rigid-cluster provenance depended on authored connection order",
);
const unicodeOrderSnapshot = {
    revision: 1,
    parts: [beam("root", 0), beam("Å", 2.4), beam("Å", 4.8)],
    connections: [
      connection("Å", "root", "B", "Å", "A"),
      connection("Å", "Å", "B", "Å", "A"),
    ],
  },
  unicodeForward = compileAssembly(unicodeOrderSnapshot, TYPES),
  unicodeReversed = compileAssembly(
    {
      ...unicodeOrderSnapshot,
      parts: [...unicodeOrderSnapshot.parts].reverse(),
      connections: [...unicodeOrderSnapshot.connections].reverse(),
    },
    TYPES,
  );
assert.deepEqual(
  unicodeReversed.rigidClusters,
  unicodeForward.rigidClusters,
  "locale-equivalent Unicode IDs changed rigid-cluster descriptors",
);
assert.deepEqual(
  unicodeReversed.collisionExclusions,
  unicodeForward.collisionExclusions,
  "locale-equivalent Unicode IDs changed collision provenance",
);
assert.equal(
  new Set(mixedTypedChain.bodies.map((body) => body.id)).size,
  mixedTypedChain.bodies.length,
  "mixed numeric/string part IDs collided in compiled body identity",
);
assert.equal(
  new Set(mixedTypedChain.constraints.map((constraint) => constraint.id)).size,
  mixedTypedChain.constraints.length,
  "mixed numeric/string connection IDs collided in constraint identity",
);
{
  const value = orderedChainRuntime(
    mixedTypedSnapshot,
    "mixed-fluid-part-identity",
  );
  value.runtime.applyFluidForces();
  const state = value.runtime.exportState(),
    records = state.fluidState.byPart;
  assert.equal(records.length, mixedTypedSnapshot.parts.length);
  assert.ok(records.some((record) => record.partId === 1));
  assert.ok(records.some((record) => record.partId === "1"));
  const hostile = structuredClone(state);
  hostile.fluidState.byPart.find((record) => record.partId === "1").partId = 1;
  assert.throws(
    () => importMultibodyState(value.runtime, hostile),
    (error) => error?.code === "INVALID_MULTIBODY_CHECKPOINT_FLUID_STATE",
    "fluid checkpoint collapsed numeric and string part identities",
  );
  importMultibodyState(value.runtime, state);
  assert.deepEqual(value.runtime.exportState(), state);
  disposeOrderedRuntime(value);
}
const mixedTypedCluster = mixedTypedChain.rigidClusters[0];
assert.equal(
  new Set(mixedTypedCluster.memberBodyIds).size,
  mixedTypedCluster.memberBodyIds.length,
  "mixed numeric/string body provenance collided in a rigid cluster",
);
assert.equal(
  new Set(
    mixedTypedCluster.cutWrenchTopology.cuts.map((cut) => cut.constraintId),
  ).size,
  mixedTypedCluster.cutWrenchTopology.cuts.length,
  "mixed numeric/string cut identities collided",
);
const mixedTypedRegistry = new BodyRegistry(
  {
    parts: [beam(1, 0), beam("1", 2.4)],
  },
  TYPES,
);
assert.throws(
  () =>
    new BodyRegistry(
      {
        parts: [
          beam("duplicate-registry-part", 0),
          {
            ...beam("duplicate-registry-part", 2.4),
            type: "plate",
            config: componentDefaults("plate"),
          },
        ],
      },
      TYPES,
    ),
  (error) => error?.code === "DUPLICATE_PART_ID",
  "body registry constructor accepted duplicate last-wins authority",
);
assert.equal(
  new Set(mixedTypedRegistry.snapshot().bodies.map((body) => body.bodyId)).size,
  2,
  "mixed numeric/string part IDs collided in body-registry identity",
);
mixedTypedRegistry.registerBody("collision-guard", [1]);
assert.throws(
  () => mixedTypedRegistry.registerBody("collision-guard", ["1"]),
  (error) => error?.code === "BODY_ID_ALREADY_BOUND",
  "body registry overwrote an unrelated body identity",
);
const pluralCollisionSnapshot = structuredClone(mixedTypedRegistry.snapshot()),
  unrelatedBodyId = mixedTypedRegistry.bodyForPart("1").bodyId;
assert.throws(
  () =>
    mixedTypedRegistry.registerPhysicalEntities(1, [
      { bodyId: "candidate-before-collision" },
      { bodyId: unrelatedBodyId },
    ]),
  (error) => error?.code === "DUPLICATE_PHYSICAL_ENTITY",
  "plural physical registration accepted an unrelated body identity",
);
assert.deepEqual(
  mixedTypedRegistry.snapshot(),
  pluralCollisionSnapshot,
  "failed plural physical registration partially mutated the registry",
);
assert.equal(mixedTypedRegistry.bodyForPart(1).bodyId, "collision-guard");
const rejectedReplacementSnapshot = mixedTypedRegistry.snapshot(),
  rejectedReplacementPartOne = mixedTypedRegistry.bodyForPart(1),
  rejectedReplacementPartString = mixedTypedRegistry.bodyForPart("1");
assert.throws(
  () =>
    mixedTypedRegistry.registerBody("atomic-replacement", [1, "1"], {
      pose: {
        position: [Number.POSITIVE_INFINITY, 0, 0],
        quaternion: [0, 0, 0, 1],
      },
    }),
  /finite/,
  "body registry accepted a non-finite replacement pose",
);
assert.equal(
  mixedTypedRegistry.bodyForPart(1),
  rejectedReplacementPartOne,
  "rejected replacement changed numeric-part ownership",
);
assert.equal(
  mixedTypedRegistry.bodyForPart("1"),
  rejectedReplacementPartString,
  "rejected replacement changed string-part ownership",
);
assert.equal(
  mixedTypedRegistry.snapshot(),
  rejectedReplacementSnapshot,
  "rejected replacement invalidated or partially changed the registry snapshot",
);
const rejectedConstraintSnapshot = mixedTypedRegistry.snapshot(),
  rejectedConstraintPartOne = mixedTypedRegistry.bodyForPart(1),
  rejectedConstraintPartString = mixedTypedRegistry.bodyForPart("1");
assert.throws(
  () =>
    mixedTypedRegistry.registerConstraint("atomic-constraint", 1, {
      sourceConnectionIds: ["constraint-source"],
      pose: {
        position: [Number.POSITIVE_INFINITY, 0, 0],
        quaternion: [0, 0, 0, 1],
      },
    }),
  /finite/,
  "body registry accepted a non-finite constraint replacement pose",
);
assert.equal(
  mixedTypedRegistry.bodyForPart(1),
  rejectedConstraintPartOne,
  "rejected constraint replacement changed numeric-part ownership",
);
assert.equal(
  mixedTypedRegistry.bodyForPart("1"),
  rejectedConstraintPartString,
  "rejected constraint replacement changed unrelated ownership",
);
assert.equal(
  mixedTypedRegistry.constraint("atomic-constraint"),
  null,
  "rejected constraint replacement left a partial constraint",
);
assert.equal(
  mixedTypedRegistry.snapshot(),
  rejectedConstraintSnapshot,
  "rejected constraint replacement invalidated or partially changed the snapshot",
);
const beamMassProperties = compileAssembly(
    { revision: 1, parts: [beam("registry-mass-beam", 0)], connections: [] },
    TYPES,
  ).bodies[0].massProperties,
  plateMassProperties = compileAssembly(
    {
      revision: 1,
      parts: [
        {
          ...beam("registry-mass-plate", 0),
          type: "plate",
          config: componentDefaults("plate"),
        },
      ],
      connections: [],
    },
    TYPES,
  ).bodies[0].massProperties;
assert.throws(
  () =>
    mixedTypedRegistry.setMassProperties("collision-guard", beamMassProperties),
  (error) => error?.code === "MASS_PROPERTY_OWNER_REQUIRED",
  "public body-registry setter retained independent mass authority",
);
commitBodyRegistryMassProperties(mixedTypedRegistry, [
  { bodyId: "collision-guard", massProperties: beamMassProperties },
]);
const importBaseline = mixedTypedRegistry.exportState(),
  duplicateBodyImport = structuredClone(importBaseline),
  duplicateBodyRecord = structuredClone(duplicateBodyImport.bodies[0]);
duplicateBodyRecord.pose.position.x = 99;
duplicateBodyImport.bodies.push(duplicateBodyRecord);
assert.throws(
  () => mixedTypedRegistry.importState(JSON.stringify(duplicateBodyImport)),
  (error) => error?.code === "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
  "body registry import accepted a duplicate body identity",
);
assert.deepEqual(
  mixedTypedRegistry.exportState(),
  importBaseline,
  "duplicate body import mutated the body registry",
);
const forgedRegistryMass = structuredClone(importBaseline);
forgedRegistryMass.bodies.find(
  (body) => body.bodyId === "collision-guard",
).massProperties = plateMassProperties;
assert.throws(
  () => mixedTypedRegistry.importState(JSON.stringify(forgedRegistryMass)),
  (error) => error?.code === "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
  "body registry import accepted mass authority from an unrelated descriptor",
);
assert.deepEqual(
  mixedTypedRegistry.exportState(),
  importBaseline,
  "forged registry mass rejection mutated the body registry",
);
const lateRegistryImport = structuredClone(importBaseline);
lateRegistryImport.bodies[0].pose.position.x = 101;
lateRegistryImport.revision = Number.NaN;
assert.throws(
  () => mixedTypedRegistry.importState(JSON.stringify(lateRegistryImport)),
  (error) => error?.code === "INVALID_BODY_REGISTRY_CHECKPOINT_COUNTER",
  "body registry import accepted a non-finite revision",
);
assert.deepEqual(
  mixedTypedRegistry.exportState(),
  importBaseline,
  "late body registry rejection mutated live or cached state",
);
for (const field of ["revision", "tick"]) {
  const fractionalRegistryCounter = structuredClone(importBaseline);
  fractionalRegistryCounter[field] = 0.5;
  assert.throws(
    () =>
      mixedTypedRegistry.importState(JSON.stringify(fractionalRegistryCounter)),
    (error) => error?.code === "INVALID_BODY_REGISTRY_CHECKPOINT_COUNTER",
    `body registry import accepted fractional ${field}`,
  );
  assert.deepEqual(
    mixedTypedRegistry.exportState(),
    importBaseline,
    `fractional ${field} rejection mutated the body registry`,
  );
}
const constraintImportRegistry = new BodyRegistry(
  { parts: [beam("constraint-import-part", 0)] },
  TYPES,
);
constraintImportRegistry.registerConstraint(
  "constraint-import-owner",
  "constraint-import-part",
  { sourceConnectionIds: ["constraint-import-source"] },
);
const constraintImportBaseline = constraintImportRegistry.exportState(),
  contradictoryConstraintBinding = structuredClone(constraintImportBaseline);
contradictoryConstraintBinding.constraintByPart[0].constraintId =
  "forged-constraint-owner";
assert.throws(
  () =>
    constraintImportRegistry.importState(
      JSON.stringify(contradictoryConstraintBinding),
    ),
  (error) => error?.code === "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
  "body registry import accepted a contradictory constraint binding",
);
assert.deepEqual(
  constraintImportRegistry.exportState(),
  constraintImportBaseline,
  "contradictory constraint binding mutated the body registry",
);
const bodyConstraintLinkRegistry = new BodyRegistry(
    { parts: [beam("body-link-part", 0)] },
    TYPES,
  ),
  bodyConstraintLinkBaseline = bodyConstraintLinkRegistry.exportState(),
  forgedBodyConstraintLink = structuredClone(bodyConstraintLinkBaseline);
forgedBodyConstraintLink.bodies[0].constraintIds.push("ghost-connection");
assert.throws(
  () =>
    bodyConstraintLinkRegistry.importState(
      JSON.stringify(forgedBodyConstraintLink),
    ),
  (error) => error?.code === "INVALID_BODY_REGISTRY_CHECKPOINT_STATE",
  "body registry import accepted forged body-to-constraint linkage",
);
assert.deepEqual(
  bodyConstraintLinkRegistry.exportState(),
  bodyConstraintLinkBaseline,
  "body-to-constraint rejection mutated the body registry",
);

function runtimeBindings(parts) {
  const assembly = { revision: 1, parts, connections: [] },
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("mixed-id-runtime"),
      catalog: TYPES,
    }),
    registry = new BodyRegistry(assembly, TYPES);
  runtime.start(JSON.stringify(assembly));
  new RigidBodySystem().initialize({
    bodyRegistry: registry,
    services: { multibodyRuntime: runtime },
  });
  const bindings = registry
    .snapshot()
    .bodyByPart.map(({ partId, bodyId }) => ({ partId, bodyId }))
    .sort((left, right) =>
      `${typeof left.partId}:${String(left.partId)}`.localeCompare(
        `${typeof right.partId}:${String(right.partId)}`,
      ),
    );
  assert.equal(
    new Set(bindings.map(({ bodyId }) => bodyId)).size,
    parts.length,
  );
  runtime.dispose();
  worldAdapter.dispose();
  return bindings;
}
const runtimeMixedParts = [beam(1, 0), beam("1", 2.4)];
assert.deepEqual(
  runtimeBindings(runtimeMixedParts),
  runtimeBindings([...runtimeMixedParts].reverse()),
  "runtime body identity depended on mixed-ID authored order",
);
const maximumAuthoredId = "x".repeat(160),
  maximumIdBindings = runtimeBindings([beam(maximumAuthoredId, 0)]);
assert.equal(maximumIdBindings[0].partId, maximumAuthoredId);
assert.ok(
  maximumIdBindings[0].bodyId.length > maximumAuthoredId.length,
  "runtime body identity did not preserve its compiled namespace",
);

function runtimeCheckpoint(parts) {
  const assembly = { revision: 1, parts, connections: [] },
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("mixed-id-checkpoint"),
      catalog: TYPES,
    });
  runtime.start(JSON.stringify(assembly));
  const checkpoint = runtime.exportState();
  runtime.dispose();
  worldAdapter.dispose();
  return checkpoint;
}
for (const parts of [runtimeMixedParts, [beam("Å", 0), beam("Å", 2.4)]])
  assert.deepEqual(
    runtimeCheckpoint(parts),
    runtimeCheckpoint([...parts].reverse()),
    "runtime checkpoint depended on authored mixed/equivalent ID order",
  );

function runtimeIdentityEvidence(assembly) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("mixed-id-evidence"),
      catalog: TYPES,
    });
  runtime.start(JSON.stringify(assembly));
  const shapeIds = [...runtime.bodyByPart.values()]
      .flatMap((body) => body.shapes.map((shape) => shape.userData?.shapeId))
      .sort(),
    sourceConnectionIds = runtime.constraintEntries
      .filter((entry) => entry.constraint)
      .flatMap((entry) => {
        entry.constraint.update();
        assignConstraintEvidenceRows(entry.constraint, {
          ...entry.constraint.simulacrumEvidence,
          tick: 0,
        });
        return entry.constraint.equations.flatMap(
          (equation) =>
            equation.simulacrumEvidenceRow?.sourceConnectionIds || [],
        );
      });
  runtime.loadByConnection.clear();
  runtime.loadByConnection.set(1, 22);
  runtime.loadByConnection.set("1", 44);
  runtime.torqueByConnection.clear();
  runtime.torqueByConnection.set(1, 33);
  runtime.torqueByConnection.set("1", 55);
  const telemetry = runtime.telemetry();
  runtime.dispose();
  worldAdapter.dispose();
  return {
    shapeIds,
    sourceConnectionIds: [...new Set(sourceConnectionIds)].sort(),
    connectionLoads: telemetry.connectionLoads,
    connectionTorques: telemetry.connectionTorques,
  };
}
const mixedRuntimeEvidence = runtimeIdentityEvidence(mixedTypedSnapshot),
  reversedMixedRuntimeEvidence = runtimeIdentityEvidence({
    ...mixedTypedSnapshot,
    connections: [...mixedTypedSnapshot.connections].reverse(),
  });
assert.deepEqual(reversedMixedRuntimeEvidence, mixedRuntimeEvidence);
assert.equal(
  new Set(mixedRuntimeEvidence.shapeIds).size,
  mixedRuntimeEvidence.shapeIds.length,
  "mixed numeric/string parts collided in production shape evidence",
);
assert.deepEqual(
  mixedRuntimeEvidence.sourceConnectionIds,
  ["1", "string:1:1"],
  "production constraint evidence collapsed mixed connection IDs",
);
assert.deepEqual(mixedRuntimeEvidence.connectionLoads, {
  1: 22,
  "string:1:1": 44,
});
assert.deepEqual(mixedRuntimeEvidence.connectionTorques, {
  1: 33,
  "string:1:1": 55,
});

const typedFailureRecorder = new FailureEvidenceRecorder({
  policy: {
    exactRetentionTicks: 2,
    contextRetentionTicks: 2,
    contextStrideTicks: 1,
    topRowsPerConnection: 1,
    maxRowsOnTriggerTick: 4,
    nearFailureUtilization: 0.8,
  },
});
typedFailureRecorder.beginRun({ runIdentity: { id: "typed-identity" } });
typedFailureRecorder.recordPhysicsStage({
  tick: 1,
  solverContributions: [
    {
      rowId: "string-row",
      side: "A",
      sourceConnectionIds: ["string:1:1"],
      forceMagnitudeN: 99,
      momentMagnitudeNm: 0,
    },
  ],
});
typedFailureRecorder.recordStructurePreMutation({
  tick: 1,
  evaluations: [
    { connectionId: 1, forceUtilization: 0.1, torqueUtilization: 0, loadN: 11 },
    {
      connectionId: "1",
      forceUtilization: 1.1,
      torqueUtilization: 0,
      loadN: 99,
    },
  ],
  topology: { graphRevision: 0, connections: [], detachedPartIds: [] },
});
typedFailureRecorder.trigger({
  kind: "structural-failure",
  tick: 1,
  subjectId: "1",
});
typedFailureRecorder.recordStructurePostMutation({
  tick: 1,
  event: { failedConnectionIds: ["1"], detachedPartIds: [] },
  topology: { graphRevision: 1, connections: [], detachedPartIds: [] },
});
typedFailureRecorder.completeTick({ tick: 1 });
assert.equal(
  typedFailureRecorder.telemetrySummary().trigger.subjectId,
  "string:1:1",
);
assert.equal(
  typedFailureRecorder.telemetrySummary().diagnostic.connection.connectionId,
  "string:1:1",
);
assert.equal(
  typedFailureRecorder.telemetrySummary().diagnostic.connection.loadN,
  99,
);
assert.equal(
  typedFailureRecorder.telemetrySummary().diagnostic.contribution.rowId,
  "string-row",
);

const evidenceConstraint = { equations: [{}] };
assignConstraintEvidenceRows(evidenceConstraint, {
  constraintId: "mixed-evidence",
  sourceConnectionIds: [1, "1"],
  tick: 0,
});
assert.deepEqual(
  evidenceConstraint.equations[0].simulacrumEvidenceRow.sourceConnectionIds,
  ["1", "string:1:1"],
  "numeric/string connection evidence identities collided",
);

const rejectedSelfLoop = compileAssembly(
  {
    revision: 1,
    parts: [beam(1, 0)],
    connections: [connection("self", 1, "A", 1, "B")],
  },
  TYPES,
);
assert.equal(rejectedSelfLoop.stats.errorCount, 1);
assert.equal(rejectedSelfLoop.diagnostics[0].code, "SELF_CONNECTION");
assert.deepEqual(rejectedSelfLoop.constraints, []);
assert.equal(
  rejectedSelfLoop.rigidClusters[0].cutWrenchTopology.kind,
  "singleton-v1",
);
assert.deepEqual(rejectedSelfLoop.rigidClusters[0].fixedConstraintIds, []);

const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2],
  transformedCompilation = compileAssembly(
    {
      ...chain,
      parts: chain.parts.map((part) => ({
        ...structuredClone(part),
        pos: [7 - part.pos[1], -3 + part.pos[0], 2 + part.pos[2]],
        orientation: [...quarterTurn],
      })),
    },
    TYPES,
  ),
  translatedRotated = transformedCompilation.rigidClusters[0];
assert.deepEqual(translatedRotated.memberPartIds, cluster.memberPartIds);
for (let index = 0; index < cluster.members.length; index++) {
  closeArray(
    translatedRotated.members[index].positionClusterM,
    cluster.members[index].positionClusterM,
    `member ${index} rigid-transform position covariance`,
  );
  closeArray(
    translatedRotated.members[index].orientationCluster,
    cluster.members[index].orientationCluster,
    `member ${index} rigid-transform orientation covariance`,
  );
}
closeArray(
  translatedRotated.massProperties.comPositionPartM,
  cluster.massProperties.comPositionPartM,
  "cluster COM rigid-transform covariance",
);
for (const field of ["xx", "yy", "zz", "xy", "xz", "yz"])
  assert.ok(
    Math.abs(
      translatedRotated.massProperties.inertiaTensorAtComPartKgM2[field] -
        cluster.massProperties.inertiaTensorAtComPartKgM2[field],
    ) < 1e-10,
    { field },
  );
for (let index = 0; index < cluster.cutWrenchTopology.cuts.length; index++) {
  const transformedCut = translatedRotated.cutWrenchTopology.cuts[index],
    sourceCut = cluster.cutWrenchTopology.cuts[index];
  assert.deepEqual(transformedCut.subtreePartIds, sourceCut.subtreePartIds);
  for (const side of ["parentAttachmentFrame", "childAttachmentFrame"]) {
    closeArray(
      transformedCut[side].positionClusterM,
      sourceCut[side].positionClusterM,
      `cut ${index} ${side} position covariance`,
    );
    closeArray(
      transformedCut[side].orientationCluster,
      sourceCut[side].orientationCluster,
      `cut ${index} ${side} orientation covariance`,
    );
  }
}
const transformedRootBody = transformedCompilation.bodies.find(
    (body) => body.partId === translatedRotated.rootPartId,
  ),
  transformedConstraintById = new Map(
    transformedCompilation.constraints.map((constraint) => [
      constraint.id,
      constraint,
    ]),
  ),
  authoredWorldCutFrames = rigidClusterCutFramesWorld(translatedRotated, {
    positionWorldM: transformedRootBody.position,
    orientationWorld: transformedRootBody.orientation,
  });
for (const frame of authoredWorldCutFrames) {
  const cut = translatedRotated.cutWrenchTopology.cuts.find(
      (candidate) => candidate.constraintId === frame.constraintId,
    ),
    constraint = transformedConstraintById.get(frame.constraintId);
  closeArray(
    frame.positionWorldM,
    constraint[`attachmentFrame${cut.childSide}`].positionWorldM,
    `cut ${String(frame.constraintId)} authored world frame`,
  );
  assert.equal(frame.source, "authored-child-attachment-v1");
}
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      {
        ...translatedRotated,
        cutWrenchTopology: {
          ...translatedRotated.cutWrenchTopology,
          cycleRank: 1,
        },
      },
      {
        positionWorldM: transformedRootBody.position,
        orientationWorld: transformedRootBody.orientation,
      },
    ),
  /contradictory (?:member authority|cut-wrench topology)/,
);
for (const mutate of [
  (descriptor) => {
    descriptor.id = "forged-cluster";
  },
  (descriptor) => {
    descriptor.sourceMassKg = Number.MAX_VALUE;
  },
  (descriptor) => {
    descriptor.massProperties.memberMassPropertySources = [];
  },
  (descriptor) => {
    descriptor.dynamicMassPartIds = ["ghost"];
  },
  (descriptor) => {
    descriptor.failureBoundaryConstraintIds = [];
  },
  (descriptor) => {
    descriptor.boundaryConstraintIds = ["forged-outgoing-constraint"];
  },
  (descriptor) => {
    descriptor.boundaryConstraintIds = [descriptor.fixedConstraintIds[0]];
  },
  (descriptor) => {
    const translation = [100, 0, 0];
    for (const memberAuthority of descriptor.members)
      memberAuthority.positionClusterM = memberAuthority.positionClusterM.map(
        (value, index) => value + translation[index],
      );
    for (const source of descriptor.massProperties.memberMassPropertySources)
      source.positionClusterM = source.positionClusterM.map(
        (value, index) => value + translation[index],
      );
    descriptor.massProperties = composeRigidBodyMassProperties(
      descriptor.massProperties.memberMassPropertySources,
    );
    for (const cut of descriptor.cutWrenchTopology.cuts)
      for (const frame of [cut.parentAttachmentFrame, cut.childAttachmentFrame])
        frame.positionClusterM = frame.positionClusterM.map(
          (value, index) => value + translation[index],
        );
  },
  (descriptor) => {
    descriptor.cutWrenchTopology.cuts[0].failureAttachments = [];
  },
  (descriptor) => {
    descriptor.cutWrenchTopology.cuts[0].sourceConnectionIds = ["forged"];
  },
  (descriptor) => {
    descriptor.cutWrenchTopology.cuts[0].childAttachmentFrame.positionClusterM =
      [999, 0, 0];
  },
  (descriptor) => {
    const cut = descriptor.cutWrenchTopology.cuts[0],
      childMember = descriptor.members.find(
        (memberRecord) => memberRecord.partId === cut.childPartId,
      );
    childMember.positionClusterM = [Number.MAX_VALUE, 0, 0];
    cut.childAttachmentFrame.positionPartM = [Number.MAX_VALUE, 0, 0];
    cut.childAttachmentFrame.positionClusterM = [0, 0, 0];
  },
  (descriptor) => {
    descriptor.members[0].massPropertySourceBodyId = "forged-body";
  },
  (descriptor) => {
    descriptor.members[0].geometrySourceBodyId = "forged-body";
  },
]) {
  const contradictoryDescriptor = structuredClone(translatedRotated);
  mutate(contradictoryDescriptor);
  assert.throws(
    () =>
      rigidClusterCutFramesWorld(contradictoryDescriptor, {
        positionWorldM: transformedRootBody.position,
        orientationWorld: transformedRootBody.orientation,
      }),
    /contradictory (?:member authority|cut-wrench topology)/,
  );
}
const overflowFrameDescriptor = structuredClone(translatedRotated),
  overflowCut = overflowFrameDescriptor.cutWrenchTopology.cuts[0],
  overflowChildMember = overflowFrameDescriptor.members.find(
    (memberRecord) => memberRecord.partId === overflowCut.childPartId,
  );
overflowCut.childAttachmentFrame.positionPartM = [1e308, 0, 0];
overflowCut.childAttachmentFrame.positionClusterM = [
  overflowChildMember.positionClusterM[0] + 1e308,
  overflowChildMember.positionClusterM[1],
  overflowChildMember.positionClusterM[2],
];
assert.throws(
  () =>
    rigidClusterCutFramesWorld(deepFreeze(overflowFrameDescriptor), {
      positionWorldM: [1e308, 0, 0],
      orientationWorld: [0, 0, 0, 1],
    }),
  /contradictory member authority/,
  "deep-frozen detached data minted compiler authority",
);
const malformedFrameDescriptor = structuredClone(translatedRotated);
delete malformedFrameDescriptor.cutWrenchTopology.cuts[0].parentAttachmentFrame;
malformedFrameDescriptor.cutWrenchTopology.cuts[0].childAttachmentFrame.partId =
  malformedFrameDescriptor.cutWrenchTopology.cuts[0].parentPartId;
assert.throws(
  () =>
    rigidClusterCutFramesWorld(malformedFrameDescriptor, {
      positionWorldM: transformedRootBody.position,
      orientationWorld: transformedRootBody.orientation,
    }),
  /contradictory (?:member authority|cut-wrench topology)/,
);
for (const invalidPortId of ["", { synthetic: true }]) {
  const invalidPortDescriptor = structuredClone(translatedRotated);
  invalidPortDescriptor.cutWrenchTopology.cuts[0].childAttachmentFrame.portId =
    invalidPortId;
  assert.throws(
    () =>
      rigidClusterCutFramesWorld(invalidPortDescriptor, {
        positionWorldM: transformedRootBody.position,
        orientationWorld: transformedRootBody.orientation,
      }),
    /contradictory (?:member authority|cut-wrench topology)/,
  );
}
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      { ...translatedRotated, rootPartId: "not-a-member" },
      {
        positionWorldM: transformedRootBody.position,
        orientationWorld: transformedRootBody.orientation,
      },
    ),
  /contradictory member authority/,
);
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      { ...translatedRotated, fixedConstraintIds: ["not-a-cut", "also-wrong"] },
      {
        positionWorldM: transformedRootBody.position,
        orientationWorld: transformedRootBody.orientation,
      },
    ),
  /contradictory (?:member authority|cut-wrench topology)/,
);
const signBoundary = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        config: componentDefaults("plate"),
      },
      {
        id: 2,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [1, 0, 0, 0],
        config: componentDefaults("plate"),
      },
    ],
    connections: [
      {
        ...connection("sign-boundary-cut", 1, "TOP", 2, "BOTTOM"),
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
      },
    ],
  },
  signBase = compileAssembly(signBoundary, TYPES).rigidClusters[0],
  signTransformed = compileAssembly(
    {
      ...signBoundary,
      parts: signBoundary.parts.map((part) => ({
        ...part,
        orientation: part.id === 1 ? [1, 0, 0, 0] : [0, 0, 0, 1],
      })),
    },
    TYPES,
  ).rigidClusters[0];
assert.deepEqual(
  signTransformed.members.map((member) => member.orientationCluster),
  signBase.members.map((member) => member.orientationCluster),
  "relative quaternion sign changed under a global rigid transform",
);

const loop = compileAssembly(
  {
    revision: 1,
    parts: [1, 2, 3].map((id) => ({
      id,
      type: "plate",
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      config: componentDefaults("plate"),
    })),
    connections: [
      {
        ...connection("cut-12", 1, "TOP", 2, "BOTTOM"),
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
      },
      {
        ...connection("cut-23", 2, "TOP", 3, "BOTTOM"),
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
      },
      {
        ...connection("cut-31", 3, "TOP", 1, "BOTTOM"),
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
      },
    ],
  },
  TYPES,
).rigidClusters[0];
assert.equal(loop.cutWrenchTopology.cycleRank, 1);
assert.equal(loop.cutWrenchTopology.kind, "statically-indeterminate-loop-v1");
assert.deepEqual(loop.cutWrenchTopology.cuts, []);
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      { ...loop, rootPartId: "not-a-member" },
      { positionWorldM: [0, 0, 0], orientationWorld: [0, 0, 0, 1] },
    ),
  /contradictory member authority/,
);
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      { ...loop, fixedConstraintIds: loop.fixedConstraintIds.slice(1) },
      { positionWorldM: [0, 0, 0], orientationWorld: [0, 0, 0, 1] },
    ),
  /contradictory (?:member authority|cut-wrench topology)/,
);
assert.throws(
  () =>
    rigidClusterCutFramesWorld(
      {
        ...loop,
        fixedConstraintIds: loop.fixedConstraintIds.map(
          (_, index) => `forged-loop-${index}`,
        ),
        cutWrenchTopology: {
          ...loop.cutWrenchTopology,
          fixedConstraintIds: loop.fixedConstraintIds.map(
            (_, index) => `forged-loop-${index}`,
          ),
        },
      },
      { positionWorldM: [0, 0, 0], orientationWorld: [0, 0, 0, 1] },
    ),
  /contradictory (?:member authority|cut-wrench topology)/,
);

const analyticMassProperties = (massKg, moments) => ({
    sourceKind: "analytic-fixture-v1",
    massEvaluationPolicy: "analytic-fixture-v1",
    massKg,
    volumeM3: 0,
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: moments[0],
      yy: moments[1],
      zz: moments[2],
      xy: 0,
      xz: 0,
      yz: 0,
    },
    principalMomentsKgM2: moments,
    principalAxesPart: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    decompositionPolicy: "ordered-right-handed-jacobi-v1",
    contributingSolidIds: [],
  }),
  asymmetricMass = composeRigidBodyMassProperties([
    {
      bodyId: "analytic-a",
      positionClusterM: [0, 0, 0],
      orientationCluster: [0, 0, 0, 1],
      massProperties: analyticMassProperties(2, [1, 2, 3]),
    },
    {
      bodyId: "analytic-b",
      positionClusterM: [3, 0, 0],
      orientationCluster: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      massProperties: analyticMassProperties(1, [4, 5, 6]),
    },
  ]);
assert.deepEqual(asymmetricMass.comPositionPartM, [1, 0, 0]);
for (const [field, expected] of Object.entries({
  xx: 6,
  yy: 12,
  zz: 15,
  xy: 0,
  xz: 0,
  yz: 0,
}))
  assert.ok(
    Math.abs(asymmetricMass.inertiaTensorAtComPartKgM2[field] - expected) <
      1e-10,
    { field, expected, actual: asymmetricMass.inertiaTensorAtComPartKgM2 },
  );
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "huge-volume-a",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: {
          ...analyticMassProperties(1, [1, 1, 1]),
          volumeM3: 1e308,
        },
      },
      {
        bodyId: "huge-volume-b",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: {
          ...analyticMassProperties(1, [1, 1, 1]),
          volumeM3: 1e308,
        },
      },
    ]),
  /volume must be finite and nonnegative/,
);
const tinyRotatedMoments = [1e-30, 2e-30, 2.5e-30],
  tinyRotation = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
  tinyRotatedMass = composeRigidBodyMassProperties([
    {
      bodyId: "tiny-rotated",
      positionClusterM: [0, 0, 0],
      orientationCluster: tinyRotation,
      massProperties: analyticMassProperties(1e-15, tinyRotatedMoments),
    },
  ]);
assert.notEqual(tinyRotatedMass.inertiaTensorAtComPartKgM2.xy, 0);
for (let index = 0; index < tinyRotatedMoments.length; index++)
  assert.ok(
    Math.abs(
      tinyRotatedMass.principalMomentsKgM2[index] - tinyRotatedMoments[index],
    ) <=
      tinyRotatedMoments[index] * 1e-12,
    {
      expected: tinyRotatedMoments,
      actual: tinyRotatedMass.principalMomentsKgM2,
    },
  );
const tinyRotatedTensor = [
  [
    tinyRotatedMass.inertiaTensorAtComPartKgM2.xx,
    tinyRotatedMass.inertiaTensorAtComPartKgM2.xy,
    tinyRotatedMass.inertiaTensorAtComPartKgM2.xz,
  ],
  [
    tinyRotatedMass.inertiaTensorAtComPartKgM2.xy,
    tinyRotatedMass.inertiaTensorAtComPartKgM2.yy,
    tinyRotatedMass.inertiaTensorAtComPartKgM2.yz,
  ],
  [
    tinyRotatedMass.inertiaTensorAtComPartKgM2.xz,
    tinyRotatedMass.inertiaTensorAtComPartKgM2.yz,
    tinyRotatedMass.inertiaTensorAtComPartKgM2.zz,
  ],
];
for (let row = 0; row < 3; row++)
  for (let column = 0; column < 3; column++) {
    const recomposed = tinyRotatedMass.principalAxesPart.reduce(
        (sum, axis, index) =>
          sum +
          tinyRotatedMass.principalMomentsKgM2[index] *
            axis[row] *
            axis[column],
        0,
      ),
      expected = tinyRotatedTensor[row][column];
    assert.ok(Math.abs(recomposed - expected) <= 2.5e-42, {
      row,
      column,
      recomposed,
      expected,
    });
  }
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "bad-orientation",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 2],
        massProperties: analyticMassProperties(1, [1, 1, 1]),
      },
    ]),
  /unit length/,
);
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "bad-mass",
        massKg: 2,
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: analyticMassProperties(1, [1, 1, 1]),
      },
    ]),
  /mass disagrees/,
);
for (const declaredMass of [Number.NaN, "1"]) {
  assert.throws(
    () =>
      composeRigidBodyMassProperties([
        {
          bodyId: "invalid-declared-mass",
          massKg: declaredMass,
          positionClusterM: [0, 0, 0],
          orientationCluster: [0, 0, 0, 1],
          massProperties: analyticMassProperties(1, [1, 1, 1]),
        },
      ]),
    /finite numeric data/,
  );
}
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "tiny-mass-mismatch",
        massKg: 2e-15,
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: analyticMassProperties(1e-15, [1e-30, 1e-30, 1e-30]),
      },
    ]),
  /mass disagrees/,
);
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "invalid-volume",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: {
          ...analyticMassProperties(1, [1, 1, 1]),
          volumeM3: null,
        },
      },
    ]),
  /volume must be finite and nonnegative/,
);
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "negative-member",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: analyticMassProperties(-1, [1, 1, 1]),
      },
      {
        bodyId: "positive-member",
        positionClusterM: [1, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: analyticMassProperties(2, [1, 1, 1]),
      },
    ]),
  /mass must be finite and positive/,
);
assert.throws(
  () =>
    composeRigidBodyMassProperties([
      {
        bodyId: "unphysical-member",
        positionClusterM: [0, 0, 0],
        orientationCluster: [0, 0, 0, 1],
        massProperties: analyticMassProperties(1, [1, 1, 3]),
      },
    ]),
  /physical moment inequalities/,
);
for (const hostileMassProperties of [
  {
    ...analyticMassProperties(1, [1, 1, 1]),
    rogueAuthority: "forged",
  },
  {
    ...analyticMassProperties(1, [1, 1, 1]),
    inertiaTensorAtComPartKgM2: {
      ...analyticMassProperties(1, [1, 1, 1]).inertiaTensorAtComPartKgM2,
      rogueTensorField: 1,
    },
  },
])
  assert.throws(
    () =>
      composeRigidBodyMassProperties([
        {
          bodyId: "rogue-mass-schema",
          positionClusterM: [0, 0, 0],
          orientationCluster: [0, 0, 0, 1],
          massProperties: hostileMassProperties,
        },
      ]),
    /invalid field set/,
    "open nested mass schema accepted an unknown authority field",
  );
assert.throws(
  () =>
    completeMassProperties(
      {
        sourceKind: "finite-tensor-principal-overflow-fixture-v1",
        massEvaluationPolicy: "analytic-fixture-v1",
        massKg: 1,
        volumeM3: 0,
        comPositionPartM: [0, 0, 0],
        inertiaTensorAtComPartKgM2: {
          xx: 1.35e308,
          yy: 1.35e308,
          zz: 9e307,
          xy: 4.5e307,
          xz: 0,
          yz: 0,
        },
        contributingSolidIds: [],
      },
      { normalizeScale: true },
    ),
  /principal inertia decomposition must remain finite/,
  "finite tensor produced a non-finite completed principal decomposition",
);

const zero = [0, 0, 0],
  identityQuaternion = [0, 0, 0, 1],
  analyticAttachmentFrame = (
    partId,
    side,
    sourceConnectionId,
    positionClusterM = zero,
  ) => ({
    partId,
    side,
    portId: `analytic-${side}`,
    sourceConnectionId,
    positionPartM: [...positionClusterM],
    orientationPart: identityQuaternion,
    positionClusterM: [...positionClusterM],
    orientationCluster: identityQuaternion,
  }),
  analyticCut = (
    constraintId,
    parentPartId,
    childPartId,
    subtreePartIds,
    positionClusterM = zero,
  ) => ({
    constraintId,
    parentPartId,
    childPartId,
    parentSide: "A",
    childSide: "B",
    subtreePartIds,
    sourceConnectionIds: [constraintId],
    failureAttachments: [
      { connectionId: constraintId, side: "A", bodyPartId: parentPartId },
      { connectionId: constraintId, side: "B", bodyPartId: childPartId },
    ],
    parentAttachmentFrame: analyticAttachmentFrame(
      parentPartId,
      "A",
      constraintId,
      positionClusterM,
    ),
    childAttachmentFrame: analyticAttachmentFrame(
      childPartId,
      "B",
      constraintId,
      positionClusterM,
    ),
  }),
  analyticEdge = (constraintId, a, b) => ({
    constraintId,
    a,
    b,
    breakForceN: 0,
    breakTorqueNm: 0,
  }),
  topology = {
    kind: "tree-newton-euler-cuts-v1",
    cycleRank: 0,
    fixedConstraintEdges: [
      analyticEdge("ab", "a", "b"),
      analyticEdge("bc", "b", "c"),
    ],
    cuts: [
      analyticCut("ab", "a", "b", ["b", "c"], [0.5, 0, 0]),
      analyticCut("bc", "b", "c", ["c"], [1.5, 0, 0]),
    ],
  },
  identityInertia = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  member = (partId, massKg, x, acceleration = zero) => ({
    partId,
    massKg,
    comPositionWorldM: [x, 0, 0],
    linearAccelerationWorldMps2: acceleration,
    angularVelocityWorldRadS: zero,
    angularAccelerationWorldRadS2: zero,
    inertiaTensorWorldKgM2: identityInertia,
  }),
  members = [member("a", 1, 0), member("b", 2, 1), member("c", 1, 2)],
  analyticDescriptor = (cutWrenchTopology, states) => {
    const memberPartIds = [
        ...new Set(states.map((state) => state.partId)),
      ].sort((left, right) =>
        `${typeof left}:${String(left)}` < `${typeof right}:${String(right)}`
          ? -1
          : 1,
      ),
      partIndex = new Map(
        memberPartIds.map((partId, index) => [partId, index]),
      ),
      analyticAssembly = compileAssembly(
        {
          revision: 1,
          parts: memberPartIds.map((partId, index) =>
            beam(partId, index * 2.4),
          ),
          connections: (cutWrenchTopology.fixedConstraintEdges || []).map(
            (edge) => {
              const aIndex = partIndex.get(edge.a),
                bIndex = partIndex.get(edge.b);
              return connection(
                edge.constraintId,
                edge.a,
                aIndex < bIndex ? "B" : "A",
                edge.b,
                bIndex < aIndex ? "B" : "A",
              );
            },
          ),
        },
        TYPES,
      ),
      expectedMembers = new Set(memberPartIds),
      descriptor = analyticAssembly.rigidClusters.find(
        (candidate) =>
          candidate.memberPartIds.length === expectedMembers.size &&
          candidate.memberPartIds.every((partId) =>
            expectedMembers.has(partId),
          ),
      );
    return descriptor || deepFreeze(structuredClone(cluster));
  },
  analyticOracleInput = (cutWrenchTopology, states, extra = {}) => ({
    clusterDescriptor: analyticDescriptor(cutWrenchTopology, states),
    rootPose: {
      positionWorldM: zero,
      orientationWorld: identityQuaternion,
    },
    members: states,
    externalWrenches: [],
    gravityWorldMps2: [0, 0, 0],
    ...extra,
  });

const assertInvalidTopology = (cutWrenchTopology, states) => {
  const detachedDescriptor = structuredClone(
    analyticDescriptor(topology, states.length ? states : members),
  );
  detachedDescriptor.cutWrenchTopology = structuredClone(cutWrenchTopology);
  detachedDescriptor.fixedConstraintIds = (
    cutWrenchTopology.fixedConstraintEdges || []
  ).map((edge) => edge.constraintId);
  assert.deepEqual(
    reconstructTreeCutWrenches({
      clusterDescriptor: deepFreeze(detachedDescriptor),
      rootPose: {
        positionWorldM: zero,
        orientationWorld: identityQuaternion,
      },
      members: states,
    }),
    {
      available: false,
      reason: "invalid-cut-topology-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    },
  );
};
assertInvalidTopology({ ...topology, cycleRank: 1 }, members);
assertInvalidTopology(
  {
    kind: "tree-newton-euler-cuts-v1",
    cycleRank: 0,
    fixedConstraintEdges: [],
    cuts: [],
  },
  [member("root", 1, 0), member("child", 1, 1)],
);
assertInvalidTopology(
  {
    ...topology,
    cuts: [{ ...topology.cuts[0], subtreePartIds: ["b"] }, topology.cuts[1]],
  },
  members,
);
assertInvalidTopology(
  {
    ...topology,
    cuts: [...topology.cuts, analyticCut("ca", "c", "a", ["a", "b", "c"])],
  },
  members,
);
assertInvalidTopology(topology, [...members, member("unused", 1, 3)]);
assertInvalidTopology(
  { kind: "singleton-v1", cycleRank: 0, fixedConstraintEdges: [], cuts: [] },
  [member("one", 1, 0), member("two", 1, 1)],
);

function closeArray(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  for (let index = 0; index < actual.length; index++)
    assert.ok(Math.abs(actual[index] - expected[index]) < 1e-12, {
      label,
      actual,
      expected,
    });
}

const staticBalance = reconstructTreeCutWrenches(
    analyticOracleInput(topology, members, {
      gravityWorldMps2: [0, -10, 0],
    }),
  ),
  byChild = new Map(
    staticBalance.wrenches.map((wrench) => [wrench.childPartId, wrench]),
  ),
  staticDescriptor = analyticDescriptor(topology, members),
  staticFramesByConstraint = new Map(
    rigidClusterCutFramesWorld(staticDescriptor, {
      positionWorldM: zero,
      orientationWorld: identityQuaternion,
    }).map((frame) => [frame.constraintId, frame]),
  ),
  expectedGravityTorque = (wrench) =>
    wrench.subtreePartIds.reduce((sum, partId) => {
      const state = members.find((candidate) => candidate.partId === partId);
      return (
        sum +
        (state.comPositionWorldM[0] -
          staticFramesByConstraint.get(wrench.constraintId).positionWorldM[0]) *
          state.massKg *
          10
      );
    }, 0);
{
  const validPose = {
      positionWorldM: zero,
      orientationWorld: identityQuaternion,
    },
    assertPlainBoundaryRejection = (invoke, label) =>
      assert.throws(
        invoke,
        (error) => error?.code === "INVALID_RIGID_CLUSTER_CUT_PLAIN_DATA",
        label,
      );

  let getterReads = 0;
  const accessorPose = { orientationWorld: identityQuaternion };
  Object.defineProperty(accessorPose, "positionWorldM", {
    enumerable: true,
    get() {
      getterReads++;
      return zero;
    },
  });
  assertPlainBoundaryRejection(
    () => rigidClusterCutFramesWorldBoundary(staticDescriptor, accessorPose),
    "cut-frame oracle accepted an executable root pose",
  );
  assert.equal(getterReads, 0, "cut-frame oracle executed a root-pose getter");

  let proxyReads = 0,
    proxyStructuralReads = 0;
  const proxyPose = new Proxy(validPose, {
    get(target, key, receiver) {
      proxyReads++;
      return Reflect.get(target, key, receiver);
    },
    getPrototypeOf(target) {
      proxyStructuralReads++;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      proxyStructuralReads++;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      proxyStructuralReads++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assertPlainBoundaryRejection(
    () => rigidClusterCutFramesWorldBoundary(staticDescriptor, proxyPose),
    "cut-frame oracle accepted a Proxy root pose",
  );
  assert.equal(proxyReads, 0, "cut-frame oracle executed a Proxy get trap");
  assert.equal(
    proxyStructuralReads,
    0,
    "cut-frame oracle executed a Proxy structural trap",
  );

  let clusterProxyReads = 0;
  const clusterProxy = new Proxy(staticDescriptor, {
    get(target, key, receiver) {
      clusterProxyReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  assert.throws(
    () => rigidClusterCutFramesWorld(clusterProxy, validPose),
    /contradictory member authority/,
    "cut-frame oracle accepted a Proxy in place of compiler authority",
  );
  assert.equal(
    clusterProxyReads,
    0,
    "cut-frame oracle read a non-owned cluster Proxy",
  );

  assertPlainBoundaryRejection(
    () =>
      rigidClusterCutFramesWorldBoundary(
        staticDescriptor,
        Object.assign(Object.create({ inherited: true }), validPose),
      ),
    "cut-frame oracle accepted a custom-prototype root pose",
  );
  const cyclicPose = structuredClone(validPose);
  cyclicPose.cycle = cyclicPose;
  assertPlainBoundaryRejection(
    () => rigidClusterCutFramesWorldBoundary(staticDescriptor, cyclicPose),
    "cut-frame oracle accepted a cyclic root pose",
  );

  const accessorInput = analyticOracleInput(topology, structuredClone(members));
  getterReads = 0;
  Object.defineProperty(accessorInput.members[0], "massKg", {
    enumerable: true,
    get() {
      getterReads++;
      return 1;
    },
  });
  assertPlainBoundaryRejection(
    () =>
      reconstructTreeCutWrenchesBoundary(
        accessorInput.clusterDescriptor,
        accessorInput,
      ),
    "cut-wrench oracle accepted an executable member graph",
  );
  assert.equal(getterReads, 0, "cut-wrench oracle executed a member getter");

  proxyReads = 0;
  proxyStructuralReads = 0;
  const validInput = analyticOracleInput(topology, members),
    proxyInput = new Proxy(validInput, {
      get(target, key, receiver) {
        proxyReads++;
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf(target) {
        proxyStructuralReads++;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyStructuralReads++;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        proxyStructuralReads++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
  assertPlainBoundaryRejection(
    () =>
      reconstructTreeCutWrenchesBoundary(
        validInput.clusterDescriptor,
        proxyInput,
      ),
    "cut-wrench oracle accepted a Proxy envelope",
  );
  assert.equal(proxyReads, 0, "cut-wrench oracle executed a Proxy get trap");
  assert.equal(
    proxyStructuralReads,
    0,
    "cut-wrench oracle executed a Proxy structural trap",
  );
  assertPlainBoundaryRejection(
    () =>
      reconstructTreeCutWrenchesBoundary(
        validInput.clusterDescriptor,
        Object.assign(Object.create({ inherited: true }), validInput),
      ),
    "cut-wrench oracle accepted a custom-prototype envelope",
  );
  const cyclicInput = analyticOracleInput(topology, members);
  cyclicInput.externalWrenches.push({ cycle: cyclicInput });
  assertPlainBoundaryRejection(
    () =>
      reconstructTreeCutWrenchesBoundary(
        cyclicInput.clusterDescriptor,
        cyclicInput,
      ),
    "cut-wrench oracle accepted a cyclic load graph",
  );
}
assert.equal(staticBalance.available, true);
assert.equal(staticBalance.authority, "conditional-supplied-load-set-v1");
assert.equal(staticBalance.failureAuthority, false);
assert.deepEqual(staticBalance.suppliedLoadSet, {
  gravityWorldMps2: [0, -10, 0],
  externalWrenches: [],
});
for (const omittedField of ["externalWrenches", "gravityWorldMps2"]) {
  const omitted = analyticOracleInput(topology, members);
  delete omitted[omittedField];
  assert.throws(
    () => reconstructTreeCutWrenches(omitted),
    /requires an explicit/,
    `cut reconstruction silently defaulted omitted ${omittedField}`,
  );
}
const explicitLoad = {
  loadId: "explicit-load",
  partId: "c",
  forceWorldN: [1, 0, 0],
  applicationPointWorldM: [2, 0, 0],
  coupleWorldNm: [0, 0, 0],
};
assert.throws(
  () =>
    reconstructTreeCutWrenches(
      analyticOracleInput(topology, members, {
        externalWrenches: [explicitLoad, structuredClone(explicitLoad)],
      }),
    ),
  /identities must be unique/,
  "duplicate external load identity was accepted",
);
const explicitLoadResult = reconstructTreeCutWrenches(
    analyticOracleInput(topology, members, {
      externalWrenches: [explicitLoad],
    }),
  ),
  changedExplicitLoadResult = reconstructTreeCutWrenches(
    analyticOracleInput(topology, members, {
      externalWrenches: [
        {
          ...explicitLoad,
          forceWorldN: [2, 0, 0],
          applicationPointWorldM: [3, 0, 0],
          coupleWorldNm: [0, 1, 0],
        },
      ],
    }),
  );
assert.deepEqual(explicitLoadResult.suppliedLoadSet, {
  gravityWorldMps2: [0, 0, 0],
  externalWrenches: [explicitLoad],
});
assert.notDeepEqual(
  changedExplicitLoadResult.suppliedLoadSet,
  explicitLoadResult.suppliedLoadSet,
  "cut-wrench result identity omitted force, point, or couple assumptions",
);
assert.throws(
  () =>
    reconstructTreeCutWrenches(
      analyticOracleInput(topology, members, {
        externalWrenches: [{ ...explicitLoad, partId: "not-a-member" }],
      }),
    ),
  /unknown member/,
  "external load outside the cluster was accepted",
);
closeArray(byChild.get("c").forceWorldN, [0, 10, 0], "c-subtree force");
closeArray(
  byChild.get("c").torqueWorldNm,
  [0, 0, expectedGravityTorque(byChild.get("c"))],
  "c-subtree torque",
);
closeArray(byChild.get("b").forceWorldN, [0, 30, 0], "b-subtree force");
closeArray(
  byChild.get("b").torqueWorldNm,
  [0, 0, expectedGravityTorque(byChild.get("b"))],
  "b-subtree torque",
);
assert.throws(
  () =>
    reconstructTreeCutWrenches(
      analyticOracleInput(topology, [
        members[0],
        {
          ...members[1],
          linearAccelerationWorldMps2: [Number.MAX_VALUE, 0, 0],
        },
        members[2],
      ]),
    ),
  /finite three-vector|not finite/,
);
assert.throws(
  () =>
    reconstructTreeCutWrenches({
      ...analyticOracleInput(topology, members, {
        gravityWorldMps2: [0, -10, 0],
      }),
      cutFrames: [
        {
          constraintId: "ab",
          positionWorldM: [1e9, 0, 0],
          source: "fabricated",
        },
      ],
    }),
  /derives authored frames/,
);

const freeFallMembers = [
    member("a", 1, 0, [0, -10, 0]),
    member("b", 2, 1, [0, -10, 0]),
    member("c", 1, 2, [0, -10, 0]),
  ],
  freeFall = reconstructTreeCutWrenches(
    analyticOracleInput(topology, freeFallMembers, {
      gravityWorldMps2: [0, -10, 0],
    }),
  );
for (const wrench of freeFall.wrenches) {
  closeArray(
    wrench.forceWorldN,
    zero,
    `${wrench.constraintId} free-fall force`,
  );
  closeArray(
    wrench.torqueWorldNm,
    zero,
    `${wrench.constraintId} free-fall torque`,
  );
}

const rotationalTopology = {
    kind: "tree-newton-euler-cuts-v1",
    cycleRank: 0,
    fixedConstraintEdges: [analyticEdge("rotor-cut", "root", "rotor")],
    cuts: [analyticCut("rotor-cut", "root", "rotor", ["rotor"])],
  },
  rotationalMembers = [
    member("root", 1, -1),
    {
      ...member("rotor", 1, 0),
      angularVelocityWorldRadS: [1, 2, 0],
      angularAccelerationWorldRadS2: [0, 0, 2],
      inertiaTensorWorldKgM2: [
        [2, 0, 0],
        [0, 3, 0],
        [0, 0, 4],
      ],
    },
  ],
  rotational = reconstructTreeCutWrenches(
    analyticOracleInput(rotationalTopology, rotationalMembers),
  );
closeArray(rotational.wrenches[0].forceWorldN, zero, "rotational force");
closeArray(
  rotational.wrenches[0].torqueWorldNm,
  [0, 0, 10],
  "Euler plus gyroscopic torque",
);
assert.throws(() => {
  const unphysicalTopology = {
      kind: "tree-newton-euler-cuts-v1",
      cycleRank: 0,
      fixedConstraintEdges: [
        analyticEdge("unphysical-cut", "a-root", "payload"),
      ],
      cuts: [analyticCut("unphysical-cut", "a-root", "payload", ["payload"])],
    },
    unphysicalMembers = [
      member("a-root", 1, -1),
      {
        ...member("payload", 1, 0),
        inertiaTensorWorldKgM2: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 3],
        ],
      },
    ];
  return reconstructTreeCutWrenches(
    analyticOracleInput(unphysicalTopology, unphysicalMembers),
  );
}, /physical moment inequalities/);
for (const invalidMassKg of ["1", true]) {
  assert.throws(() => {
    const invalidMassTopology = {
        kind: "tree-newton-euler-cuts-v1",
        cycleRank: 0,
        fixedConstraintEdges: [analyticEdge("mass-cut", "a-root", "payload")],
        cuts: [analyticCut("mass-cut", "a-root", "payload", ["payload"])],
      },
      invalidMassMembers = [
        member("a-root", 1, -1),
        { ...member("payload", 1, 0), massKg: invalidMassKg },
      ];
    return reconstructTreeCutWrenches(
      analyticOracleInput(invalidMassTopology, invalidMassMembers),
    );
  }, /invalid mass/);
}
assert.deepEqual(
  reconstructTreeCutWrenches(
    analyticOracleInput(
      {
        kind: "singleton-v1",
        cycleRank: 0,
        fixedConstraintEdges: [],
        cuts: [],
      },
      [
        {
          ...member("tiny-valid", 1e-100, 0),
          inertiaTensorWorldKgM2: [
            [1e-200, 0, 0],
            [0, 1e-200, 0],
            [0, 0, 1e-200],
          ],
        },
      ],
    ),
  ),
  {
    available: true,
    reason: null,
    authority: "conditional-supplied-load-set-v1",
    failureAuthority: false,
    suppliedLoadSet: {
      gravityWorldMps2: [0, 0, 0],
      externalWrenches: [],
    },
    wrenches: [],
  },
  "valid underflow-scale inertia was rejected",
);
const exactSingletonTopology = {
    kind: "singleton-v1",
    cycleRank: 0,
    fixedConstraintEdges: [],
    cuts: [],
  },
  exactSingletonState = [member("singleton-root", 1, 0)],
  contradictorySingletonDescriptor = structuredClone(
    analyticDescriptor(exactSingletonTopology, exactSingletonState),
  ),
  ghostBodyId = "forged-ghost-body";
contradictorySingletonDescriptor.memberPartIds.push("ghost");
contradictorySingletonDescriptor.memberBodyIds.push(ghostBodyId);
contradictorySingletonDescriptor.members.push({
  partId: "ghost",
  bodyId: ghostBodyId,
  positionClusterM: [0, 0, 0],
  orientationCluster: identityQuaternion,
  massKg: 1,
  massPropertySourceBodyId: ghostBodyId,
  geometrySourceBodyId: ghostBodyId,
  runtimeMassContributorKinds: [],
});
assert.deepEqual(
  reconstructTreeCutWrenches({
    clusterDescriptor: contradictorySingletonDescriptor,
    rootPose: {
      positionWorldM: zero,
      orientationWorld: identityQuaternion,
    },
    members: exactSingletonState,
  }),
  {
    available: false,
    reason: "invalid-cut-topology-v1",
    authority: "unavailable-v1",
    failureAuthority: false,
    wrenches: [],
  },
  "unused singleton descriptor membership was accepted",
);
for (const rootPose of [
  {
    positionWorldM: [Number.NaN, 0, 0],
    orientationWorld: identityQuaternion,
  },
  {
    positionWorldM: zero,
    orientationWorld: [0, 0, 0, 0],
  },
])
  assert.throws(
    () =>
      reconstructTreeCutWrenches({
        clusterDescriptor: analyticDescriptor(
          exactSingletonTopology,
          exactSingletonState,
        ),
        rootPose,
        members: exactSingletonState,
      }),
    /cluster root (?:position|orientation)/,
  );
for (const invalidTensor of [
  [
    [2e-24, 1e-25, 0],
    [0, 2e-24, 0],
    [0, 0, 2e-24],
  ],
  [
    [1e-24, 0, 0],
    [0, 1e-24, 0],
    [0, 0, 3e-24],
  ],
]) {
  assert.throws(() => {
    const tinyInvalidTopology = {
        kind: "tree-newton-euler-cuts-v1",
        cycleRank: 0,
        fixedConstraintEdges: [analyticEdge("tiny-cut", "a-root", "payload")],
        cuts: [analyticCut("tiny-cut", "a-root", "payload", ["payload"])],
      },
      tinyInvalidMembers = [
        member("a-root", 1, -1),
        {
          ...member("payload", 1, 0),
          inertiaTensorWorldKgM2: invalidTensor,
        },
      ];
    return reconstructTreeCutWrenches(
      analyticOracleInput(tinyInvalidTopology, tinyInvalidMembers),
    );
  });
}

const externalWrenches = [
    {
      loadId: "load-c",
      partId: "c",
      forceWorldN: [0, 4, 0],
      applicationPointWorldM: [2.5, 0, 0],
      coupleWorldNm: [0, 0, 3],
    },
    {
      loadId: "load-b",
      partId: "b",
      forceWorldN: [2, 0, 0],
      applicationPointWorldM: [1, 0, 0],
      coupleWorldNm: [0, 0, 0],
    },
  ],
  forward = reconstructTreeCutWrenches(
    analyticOracleInput(topology, members, { externalWrenches }),
  ),
  permutedMembers = [...members].reverse(),
  permuted = reconstructTreeCutWrenches(
    analyticOracleInput(topology, permutedMembers, {
      externalWrenches: [...externalWrenches].reverse(),
    }),
  );
assert.deepEqual(permuted, forward, "cut wrench depends on input array order");
const externalByConstraint = new Map(
  forward.wrenches.map((wrench) => [wrench.childPartId, wrench]),
);
closeArray(
  externalByConstraint.get("c").forceWorldN,
  [0, -4, 0],
  "c-subtree applied force",
);
const cCutFrameX = staticFramesByConstraint.get(
    externalByConstraint.get("c").constraintId,
  ).positionWorldM[0],
  bCutFrameX = staticFramesByConstraint.get(
    externalByConstraint.get("b").constraintId,
  ).positionWorldM[0],
  expectedCExternalTorque = -(
    (externalWrenches[0].applicationPointWorldM[0] - cCutFrameX) * 4 +
    3
  ),
  expectedBExternalTorque = -(
    (externalWrenches[0].applicationPointWorldM[0] - bCutFrameX) * 4 +
    3
  );
closeArray(
  externalByConstraint.get("c").torqueWorldNm,
  [0, 0, expectedCExternalTorque],
  "c-subtree translated force and couple",
);
closeArray(
  externalByConstraint.get("b").forceWorldN,
  [-2, -4, 0],
  "b-subtree applied force",
);
closeArray(
  externalByConstraint.get("b").torqueWorldNm,
  [0, 0, expectedBExternalTorque],
  "b-subtree translated force and couple",
);

const mixedIdTopology = {
    kind: "tree-newton-euler-cuts-v1",
    cycleRank: 0,
    fixedConstraintEdges: [analyticEdge("mixed-order-cut", "0-root", "1")],
    cuts: [analyticCut("mixed-order-cut", "0-root", "1", ["1", "01"])],
  },
  mixedIdMembers = [
    member("0-root", 1, -1),
    member("1", 1, 1),
    member("01", 2, 0),
  ],
  mixedIdForward = reconstructTreeCutWrenches(
    analyticOracleInput(mixedIdTopology, mixedIdMembers),
  ),
  mixedIdReversedMembers = [...mixedIdMembers].reverse(),
  mixedIdReversed = reconstructTreeCutWrenches(
    analyticOracleInput(
      {
        ...mixedIdTopology,
        cuts: [
          {
            ...mixedIdTopology.cuts[0],
            subtreePartIds: [
              ...mixedIdTopology.cuts[0].subtreePartIds,
            ].reverse(),
          },
        ],
      },
      mixedIdReversedMembers,
    ),
  );
assert.deepEqual(
  mixedIdReversed,
  mixedIdForward,
  "mixed-form string IDs made the oracle depend on authored order",
);

assert.deepEqual(
  reconstructTreeCutWrenches({
    clusterDescriptor: loop,
    rootPose: {
      positionWorldM: [0, 0, 0],
      orientationWorld: identityQuaternion,
    },
    members: loop.memberPartIds.map((partId, index) =>
      member(partId, 1, index),
    ),
  }),
  {
    available: false,
    reason: "statically-indeterminate-loop-v1",
    authority: "unavailable-v1",
    failureAuthority: false,
    wrenches: [],
  },
);

console.log(
  `rigid cluster cut wrench passed (${cluster.memberPartIds.length} authored members, ${staticBalance.wrenches.length} independent Newton-Euler cuts)`,
);
