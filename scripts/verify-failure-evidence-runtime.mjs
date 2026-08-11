import assert from "node:assert/strict";
import { TYPES } from "../src/model/component-catalog.js";
import { FailureEvidenceRecorder } from "../src/simulation/failure-evidence-recorder.js";
import { BodyRegistry } from "../src/simulation/body-registry.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { FailureEvidenceSystem } from "../src/simulation/systems/failure-evidence-system.js";
import { invalidConstraintReactionCandidate } from "../src/simulation/constraint-reaction-wrench.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";

assert.throws(
  () =>
    new FailureEvidenceRecorder({
      policy: { exactRetentionTicks: 481 },
    }),
  /exactRetentionTicks must be an integer between 1 and 480/,
);
assert.throws(
  () =>
    new FailureEvidenceRecorder({
      policy: { contextStrideTicks: 1 },
    }),
  /retain at most 360 context frames/,
);
assert.throws(
  () =>
    new FailureEvidenceRecorder({
      policy: { topRowsPerConnection: 8, maxRowsPerExactFrame: 4 },
    }),
  /maxRowsPerExactFrame must cover topRowsPerConnection/,
);

const unicodeMemoryRecorder = new FailureEvidenceRecorder();
unicodeMemoryRecorder.beginRun({ runIdentity: { id: "machine-א" } });
assert.equal(
  unicodeMemoryRecorder.telemetrySummary().memoryBytes,
  new TextEncoder().encode(JSON.stringify(unicodeMemoryRecorder.snapshot()))
    .byteLength,
  "failure-evidence memory accounting treated Unicode as single-byte text",
);

const assembly = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
      {
        id: 2,
        type: "plate",
        pos: [1, 0, 0],
        orientation: [0, 0, 0, 1],
        config: {},
      },
    ],
    connections: [
      {
        id: "weak-link",
        a: 1,
        b: 2,
        kind: "mechanical",
        portA: "TOP",
        portB: "BOTTOM",
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
        capacity: {
          ultimateForceN: 100,
          ultimateTorqueNm: 100,
        },
      },
    ],
  },
  order = [];
let preMutation = null;
let postMutation = null;
const structuralRecorder = {
    acceptingEvidence: () => true,
    recordStructurePreMutation(record) {
      order.push("pre");
      preMutation = structuredClone(record);
    },
    trigger(record) {
      order.push("trigger");
      assert.equal(record.kind, "structural-failure");
    },
    recordStructurePostMutation(record) {
      order.push("post");
      postMutation = structuredClone(record);
    },
  },
  runtime = {
    loadByConnection: new Map([["weak-link", 120]]),
    torqueByConnection: new Map(),
    applyConnectionFailures(connections) {
      order.push("apply");
      assert.equal(
        preMutation.topology.connections[0].failed,
        false,
        "pre-mutation evidence observed an already-failed connection",
      );
      assert.equal(
        connections.find((connection) => connection.id === "weak-link").failed,
        true,
      );
      return [];
    },
  },
  structureSession = new SimulationSession({
    systems: [new StructureSystem()],
  }).start(assembly, {
    catalog: TYPES,
    multibodyRuntime: runtime,
    failureEvidenceRecorder: structuralRecorder,
  });
structureSession.stepFixed();
assert.deepEqual(order, ["pre", "trigger", "apply", "post"]);
assert.equal(postMutation.topology.connections[0].failed, true);
assert.deepEqual(structureSession.telemetry().systems.structures.newlyFailed, [
  "weak-link",
]);
structureSession.dispose();

const recorder = new FailureEvidenceRecorder({
  policy: {
    exactRetentionTicks: 8,
    contextRetentionTicks: 8,
    contextStrideTicks: 1,
    topRowsPerConnection: 1,
    maxRowsOnTriggerTick: 8,
    nearFailureUtilization: 0.8,
    stallDwellTicks: 3,
    stallShaftProgressMinRad: 0.03,
  },
});
const emptyBodyRegistry = () => new BodyRegistry();
assert.equal(recorder.acceptingEvidence(), false);
recorder.beginRun({
  runIdentity: {
    runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
  },
});
assert.equal(recorder.acceptingEvidence(), true);
recorder.setReplayability({ supported: true });
const failureSystem = new FailureEvidenceSystem();
failureSystem.initialize();
const context = {
  clock: { tick: 0 },
  time: 0,
  services: { failureEvidenceRecorder: recorder },
  telemetry: {},
  runGraph: { graphRevision: 0 },
  bodyRegistry: emptyBodyRegistry(),
};
for (let tick = 1; tick <= 3; tick++) {
  context.clock.tick = tick;
  context.time = tick / 120;
  context.telemetry = {
    mobility: {
      assemblies: [
        {
          assemblyId: "player-authored-rolling-assembly",
          signedSpeed: 0,
          pose: {
            position: { x: tick * 0.001, y: 1, z: 0 },
          },
          brake: 0,
          grounded: true,
          driveForce: {
            availableMotorPowerW: 100,
            deliveredMotorPowerW: 25,
            motors: [
              {
                partId: 41,
                resolvedThrottle: 0.8,
                commandSource: "remote",
                availablePowerW: 100,
                deliveredPowerW: 25,
                operational: true,
                shaftPositionRad: 0,
                shaftAngularSpeedRadPerS: 0,
              },
            ],
          },
          wheelStates: [
            {
              touching: true,
              angularSpeed: 0,
              normalLoadN: 100,
              longitudinalForceN: 0,
              lateralForceN: 0,
            },
          ],
        },
      ],
    },
  };
  failureSystem.step(context);
}
const snapshot = recorder.snapshot();
assert.equal(snapshot.trigger.kind, "rolling-actuator-stall");
assert.equal(snapshot.trigger.tick, 3);
assert.equal(snapshot.replayability.state, "supported");
assert.equal(snapshot.trigger.subjectId, "41");
assert.equal(context.telemetry.failureEvidence.captureState, "captured");
assert.equal(snapshot.exactFrames.length, 3);
assert.ok(Object.isFrozen(snapshot));
assert.equal(recorder.acceptingEvidence(), false);
context.bodyRegistry = {};
failureSystem.step(context);
assert.equal(context.telemetry.failureEvidence.captureState, "captured");
failureSystem.dispose();
recorder.rearmEpisode({
  priorEpisodeBoundaries: [
    {
      episodeIndex: 0,
      trigger: snapshot.trigger,
      policyFingerprint: snapshot.policyFingerprint,
    },
  ],
});
assert.equal(recorder.acceptingEvidence(), true);
assert.equal(recorder.snapshot().trigger, null);
assert.equal(recorder.telemetrySummary().episodeIndex, 1);

function runStallClassification({
  deliveredPowerW = 25,
  brake = 0,
  shaftProgressPerTickRad = 0,
  wheelAngularSpeed = 0,
  availablePowerW = 100,
  operational = true,
  grounded = true,
}) {
  const candidateRecorder = new FailureEvidenceRecorder({
      policy: {
        exactRetentionTicks: 8,
        contextRetentionTicks: 8,
        contextStrideTicks: 1,
        stallDwellTicks: 3,
        stallShaftProgressMinRad: 0.03,
      },
    }),
    system = new FailureEvidenceSystem(),
    candidateContext = {
      clock: { tick: 0 },
      time: 0,
      services: { failureEvidenceRecorder: candidateRecorder },
      telemetry: {},
      runGraph: { graphRevision: 0 },
      bodyRegistry: emptyBodyRegistry(),
    };
  candidateRecorder.beginRun({ runIdentity: { id: "classification" } });
  system.initialize(candidateContext);
  for (let tick = 1; tick <= 3; tick++) {
    candidateContext.clock.tick = tick;
    candidateContext.time = tick / 120;
    candidateContext.telemetry = {
      mobility: {
        assemblies: [
          {
            assemblyId: "renamed-player-machine",
            signedSpeed: 0,
            pose: {
              position: { x: 0, y: 1, z: 0 },
            },
            brake,
            grounded,
            driveForce: {
              availableMotorPowerW: availablePowerW,
              deliveredMotorPowerW: deliveredPowerW,
              motors: [
                {
                  partId: 41,
                  resolvedThrottle: 0.8,
                  commandSource: "script",
                  availablePowerW,
                  deliveredPowerW,
                  operational,
                  shaftPositionRad: shaftProgressPerTickRad * tick,
                  shaftAngularSpeedRadPerS: shaftProgressPerTickRad * 120,
                },
              ],
            },
            wheelStates: [
              {
                partId: 42,
                touching: true,
                angularSpeed: wheelAngularSpeed,
                normalLoadN: 100,
                longitudinalForceN: 0,
                lateralForceN: 0,
              },
            ],
          },
        ],
      },
    };
    system.step(candidateContext);
  }
  const trigger = candidateRecorder.snapshot().trigger;
  system.dispose();
  return trigger;
}

assert.equal(
  runStallClassification({ shaftProgressPerTickRad: 0.1 }),
  null,
  "a rotating powered shaft was classified as stalled",
);
assert.equal(
  runStallClassification({ deliveredPowerW: 0 })?.kind,
  "rolling-actuator-stall",
  "zero mechanical power at zero speed hid a powered shaft stall",
);
assert.equal(
  runStallClassification({ availablePowerW: 0 }),
  null,
  "a motor without allocated power was classified as a powered stall",
);
assert.equal(
  runStallClassification({ operational: false }),
  null,
  "an inoperative actuator was classified as stalled",
);
assert.equal(
  runStallClassification({ brake: 1 }),
  null,
  "a braked assembly was classified as stalled",
);
assert.equal(
  runStallClassification({
    wheelAngularSpeed: 20,
    shaftProgressPerTickRad: 0.2,
  }),
  null,
  "wheelspin with real shaft motion was classified as a mechanical stall",
);
assert.equal(
  runStallClassification({ grounded: false }),
  null,
  "an airborne actuator was classified as a rolling stall",
);

function runContactInvariantClassification(forceN) {
  const candidateRecorder = new FailureEvidenceRecorder({
      policy: { contactInvariantLoadFloorN: 1 },
    }),
    system = new FailureEvidenceSystem(),
    bodyRegistry = new BodyRegistry(
      {
        parts: [
          {
            id: 42,
            type: "plate",
            pos: [0, 0, 0],
            orientation: [0, 0, 0, 1],
            scale: { x: 1, y: 1, z: 1 },
            config: {},
          },
        ],
        connections: [],
      },
      TYPES,
    ),
    candidateContext = {
      clock: { tick: 1 },
      time: 1 / 120,
      services: { failureEvidenceRecorder: candidateRecorder },
      telemetry: { mobility: { assemblies: [] } },
      runGraph: { graphRevision: 0 },
      bodyRegistry,
    };
  bodyRegistry.beginTick(1);
  bodyRegistry.recordContact(bodyRegistry.bodyForPart(42).bodyId, {
    normalForceValid: true,
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    forceN,
    relativeVelocity: { x: 0, y: 0, z: 0 },
    forceWorldN: { x: 0, y: forceN, z: 0 },
    tireEvidence: {
      tirePartId: 42,
      withinGeometricTolerance: false,
      validity: "measured",
    },
  });
  candidateRecorder.beginRun({ runIdentity: { id: "contact-invariant" } });
  system.initialize(candidateContext);
  system.step(candidateContext);
  const trigger = candidateRecorder.snapshot().trigger;
  system.dispose();
  return trigger;
}

assert.equal(
  runContactInvariantClassification(0),
  null,
  "an unloaded raw candidate froze failure evidence",
);
assert.equal(
  runContactInvariantClassification(10)?.kind,
  "contact-invariant",
  "a loaded invalid tire row did not trigger evidence",
);

const anomalyRecorder = new FailureEvidenceRecorder(),
  anomalySystem = new FailureEvidenceSystem(),
  anomalyContext = {
    clock: { tick: 1 },
    time: 1 / 120,
    services: { failureEvidenceRecorder: anomalyRecorder },
    telemetry: {
      mobility: {
        assemblies: [
          {
            assemblyId: "non-finite-machine",
            signedSpeed: Number.NaN,
            pose: { position: { x: 0, y: 1, z: 0 } },
            driveForce: { motors: [] },
            wheelStates: [],
          },
        ],
      },
    },
    runGraph: { graphRevision: 1, events: () => [] },
    bodyRegistry: emptyBodyRegistry(),
  };
anomalyRecorder.beginRun({ runIdentity: { id: "numerical" } });
anomalySystem.initialize({
  ...anomalyContext,
  runGraph: { ...anomalyContext.runGraph, graphRevision: 0 },
});
anomalySystem.step(anomalyContext);
assert.equal(anomalyRecorder.snapshot().trigger.kind, "numerical-anomaly");
assert.ok(
  anomalyRecorder.telemetrySummary().memoryBytes > 0,
  "non-finite evidence prevented bounded memory accounting",
);
anomalySystem.dispose();

assert.equal(
  invalidConstraintReactionCandidate({
    side: "A",
    constraint: {
      bodyA: { position: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } },
    },
    forceMagnitudeN: 0,
    momentMagnitudeNm: 0,
  }),
  true,
  "a non-finite solver application point escaped anomaly classification",
);

const stageRecorder = new FailureEvidenceRecorder();
stageRecorder.beginRun({ runIdentity: { id: "stage-order" } });
stageRecorder.recordPhysicsStage({ tick: 1 });
assert.throws(
  () =>
    stageRecorder.recordCommandStage({
      tick: 1,
      commandLedger: {},
    }),
  /stage command cannot follow physics/,
);

const contributionRecorder = new FailureEvidenceRecorder({
  policy: {
    exactRetentionTicks: 4,
    contextRetentionTicks: 4,
    contextStrideTicks: 1,
    topRowsPerConnection: 1,
    maxRowsOnTriggerTick: 4,
    nearFailureUtilization: 0.8,
  },
});
contributionRecorder.beginRun({ runIdentity: { id: "fixture" } });
contributionRecorder.recordPhysicsStage({
  tick: 1,
  timeS: 1 / 120,
  solverContributions: [1, 2, 3, 4, 5, 6].map((forceMagnitudeN) => ({
    rowId: `row-${forceMagnitudeN}`,
    side: "A",
    sourceConnectionIds: ["connection"],
    forceMagnitudeN,
    momentMagnitudeNm: 0,
  })),
});
contributionRecorder.recordStructurePreMutation({
  tick: 1,
  timeS: 1 / 120,
  evaluations: [
    {
      connectionId: "connection",
      forceUtilization: 1.2,
      torqueUtilization: 0,
    },
  ],
  topology: { graphRevision: 0, connections: [] },
});
contributionRecorder.trigger({
  kind: "structural-failure",
  tick: 1,
  subjectId: "connection",
});
contributionRecorder.recordStructurePostMutation({
  tick: 1,
  event: { failedConnectionIds: ["connection"] },
  topology: { graphRevision: 1, connections: [] },
});
contributionRecorder.completeTick({ tick: 1, timeS: 1 / 120 });
assert.equal(
  contributionRecorder.snapshot().exactFrames[0].solverContributions.length,
  4,
  "trigger tick did not enforce the configured contributor safety bound",
);
assert.equal(
  contributionRecorder.snapshot().exactFrames[0].contributionValidity,
  "truncated",
);
assert.equal(contributionRecorder.snapshot().exactFrames[0].omittedRowCount, 2);

const normalCapRecorder = new FailureEvidenceRecorder({
  policy: {
    exactRetentionTicks: 4,
    contextRetentionTicks: 4,
    contextStrideTicks: 1,
    topRowsPerConnection: 1,
    maxRowsPerExactFrame: 3,
  },
});
normalCapRecorder.beginRun({ runIdentity: { id: "normal-cap" } });
normalCapRecorder.recordPhysicsStage({
  tick: 1,
  solverContributions: [1, 2, 3, 4, 5, 6].map((forceMagnitudeN) => ({
    rowId: `normal-row-${forceMagnitudeN}`,
    side: "A",
    sourceConnectionIds: ["near-connection"],
    forceMagnitudeN,
    momentMagnitudeNm: 0,
  })),
});
normalCapRecorder.recordStructurePreMutation({
  tick: 1,
  evaluations: [
    {
      connectionId: "near-connection",
      forceUtilization: 0.9,
      torqueUtilization: 0,
    },
  ],
  topology: { graphRevision: 0, connections: [] },
});
normalCapRecorder.completeTick({ tick: 1, timeS: 1 / 120 });
assert.deepEqual(
  normalCapRecorder
    .snapshot()
    .exactFrames[0].solverContributions.map((row) => row.forceMagnitudeN),
  [6, 5, 4],
  "normal near-failure retention ignored the global exact-frame cap",
);
assert.equal(normalCapRecorder.snapshot().exactFrames[0].omittedRowCount, 3);
assert.equal(
  normalCapRecorder.snapshot().exactFrames[0].contributionValidity,
  "truncated",
  "an omitted non-trigger solver-row set was reported as measured",
);
assert.deepEqual(
  normalCapRecorder.snapshot().exactFrames[0].structurePreMutation.topology,
  { snapshotState: "revision-only", graphRevision: 0 },
);
assert.equal(
  normalCapRecorder.snapshot().exactFrames[0].structurePostMutation,
  null,
);

console.log(
  "failure evidence runtime passed (pre-mutation order, stall matrix, stage order, bounded trigger rows)",
);
