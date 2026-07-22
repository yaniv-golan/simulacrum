import { assert } from "./lib/assert.mjs";
import { machine, stepChallenge, telemetry } from "./verify-challenge-lab.mjs";
import {
  ChallengeRun,
  challengeReliability,
} from "../src/model/challenge-lab.js";
import {
  FailureRecorder,
  ReplayBuffer,
} from "../src/model/failure-analysis.js";
import { TYPES } from "../src/model/component-catalog.js";
import { resolveReferenceInitialControls } from "../src/model/challenge-reference-controls.js";
import {
  evaluateChallengeConstraints,
  evaluateChallengeObjective,
  evaluateReferenceControlAvailability,
  transitionChallengeStatus,
} from "../src/model/challenge-evaluators.js";
import { scoreChallengeResult } from "../src/model/challenge-score.js";
import {
  extractConnectionFailure,
  FailureEvent,
  observeConnectionFailure,
} from "../src/model/failure-event-extractors.js";
import { recordChallengeResult } from "../src/application/challenge-state-adapter.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const referenceProfiles = {
  gearbox: {
    controls: [
      {
        id: "gearbox-1",
        type: "range",
        min: -1,
        max: 1,
        defaultValue: 0,
        targetId: 2,
        channel: "throttle",
      },
      {
        id: "gearbox-2",
        type: "hold",
        defaultValue: 0,
        targetId: 2,
        channel: "brake",
      },
      {
        id: "gearbox-3",
        type: "range",
        min: -1,
        max: 1,
        defaultValue: 0,
        targetId: 2,
        channel: "throttle",
      },
    ],
  },
};
const referenceSetup = resolveReferenceInitialControls(
  {
    referenceInitialControls: [
      {
        profileId: "gearbox",
        controlId: "gearbox-1",
        value: 1,
        active: true,
      },
    ],
  },
  referenceProfiles,
);
assert.deepEqual(referenceSetup, [
  {
    profileId: "gearbox",
    controlId: "gearbox-1",
    value: 1,
    active: true,
  },
]);
assert.equal(Object.isFrozen(referenceSetup), true);
assert.equal(Object.isFrozen(referenceSetup[0]), true);
for (const [entry, message] of [
  [
    { profileId: "missing", controlId: "gearbox-1", value: 1, active: true },
    /loaded profile/,
  ],
  [
    { profileId: "gearbox", controlId: "missing", value: 1, active: true },
    /name a control/,
  ],
  [
    { profileId: "gearbox", controlId: "gearbox-1", value: 2, active: true },
    /within/,
  ],
  [
    { profileId: "gearbox", controlId: "gearbox-2", value: 0.5, active: true },
    /only 0 or 1/,
  ],
  [
    { profileId: "gearbox", controlId: "gearbox-1", value: 1, active: "yes" },
    /boolean/,
  ],
  [
    {
      profileId: "gearbox",
      controlId: "gearbox-1",
      value: 1,
      active: true,
      targetId: 5,
    },
    /unknown field/,
  ],
]) {
  assert.throws(
    () =>
      resolveReferenceInitialControls(
        { referenceInitialControls: [entry] },
        referenceProfiles,
      ),
    message,
  );
}
assert.throws(
  () =>
    resolveReferenceInitialControls(
      { referenceInitialControls: [referenceSetup[0], referenceSetup[0]] },
      referenceProfiles,
    ),
  /duplicates/,
);
assert.throws(
  () =>
    resolveReferenceInitialControls(
      {
        referenceInitialControls: [
          referenceSetup[0],
          {
            profileId: "gearbox",
            controlId: "gearbox-3",
            value: 1,
            active: true,
          },
        ],
      },
      referenceProfiles,
    ),
  /target\/channel authority/,
);
for (const [challenge, profiles, message] of [
  [{ referenceInitialControls: {} }, referenceProfiles, /must be an array/],
  [
    { referenceInitialControls: [null] },
    referenceProfiles,
    /must be an object/,
  ],
  [
    {
      referenceInitialControls: [
        { profileId: "", controlId: "gearbox-1", value: 1, active: true },
      ],
    },
    referenceProfiles,
    /profileId/,
  ],
  [
    {
      referenceInitialControls: [
        { profileId: "gearbox", controlId: 2, value: 1, active: true },
      ],
    },
    referenceProfiles,
    /controlId/,
  ],
  [
    {
      referenceInitialControls: [
        {
          profileId: "gearbox",
          controlId: "gearbox-1",
          value: "not-a-number",
          active: true,
        },
      ],
    },
    referenceProfiles,
    /finite number/,
  ],
  [
    {
      referenceInitialControls: [
        { profileId: "x", controlId: "x", value: 0, active: true },
      ],
    },
    { x: { controls: [{ id: "x", type: "dial" }] } },
    /unsupported type/,
  ],
])
  assert.throws(
    () => resolveReferenceInitialControls(challenge, profiles),
    message,
  );
const endpointOptionalProfiles = {
  optional: {
    controls: [
      { id: "a", type: "toggle", channel: "shared" },
      { id: "b", type: "toggle", channel: "shared" },
      { id: "c", type: "toggle", targetId: 7 },
      { id: "d", type: "toggle", targetId: 7 },
    ],
  },
};
assert.equal(
  resolveReferenceInitialControls(
    {
      referenceInitialControls: ["a", "b", "c", "d"].map((controlId) => ({
        profileId: "optional",
        controlId,
        value: 0,
        active: false,
      })),
    },
    endpointOptionalProfiles,
  ).length,
  4,
);

assert.deepEqual(
  scoreChallengeResult({
    elapsedS: 2,
    initialEnergyWh: 100,
    machine: { energy: 80, mass: 10, partCount: 3 },
    damage: { failed: 2, detached: 3 },
  }),
  {
    score: 7228,
    energyUsed: 20,
    breakdown: {
      completion: 10000,
      time: -24,
      mass: -14,
      complexity: -54,
      energy: -160,
      damage: -2520,
    },
  },
);

const gearMachine = {
    parts: [
      {
        id: 99,
        type: "plate",
        orientation: [0, 0, 0, 1],
        config: { mass: 1 },
      },
      {
        id: 0,
        type: "motor",
        orientation: [0, 0, 0, 1],
        config: { mass: 3 },
      },
      {
        id: 2,
        type: "gear24",
        orientation: [0, 0, 0, 1],
        config: { mass: 4 },
      },
      {
        id: 1,
        type: "gear12",
        orientation: [0, 0, 0, 1],
        config: { mass: 2 },
      },
    ],
    connections: [
      {
        id: "drive",
        a: 0,
        b: 1,
        portA: "SHAFT",
        portB: "AXLE",
        kind: "mechanical",
        capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
      },
      {
        id: "mesh",
        a: 1,
        b: 2,
        portA: "MESH",
        portB: "MESH",
        kind: "mesh",
        capacity: { ultimateForceN: 12_000, ultimateTorqueNm: 3_000 },
      },
    ],
  },
  gearChallenge = {
    id: "quality-gears",
    objective: { kind: "gear-ratio", ratio: 2, holdS: 1 },
    constraints: {},
  },
  gearRun = new ChallengeRun(gearChallenge, gearMachine);
let result = stepChallenge(
  gearRun,
  {
    time: 1,
    systems: {
      mechanisms: {
        poses: [
          { id: 99, phase: 99 },
          { id: 2, phase: -2 },
          { id: 1, phase: 4 },
        ],
      },
    },
  },
  1,
);
assert.equal(result.status, "complete");
assert.equal(result.criteria[0].id, "ratio");
assert.match(result.criteria[0].current, /2\.00:1/);
assert.equal(result.verificationEligible, true);
assert.equal(result.metrics.payloadSecured, false);
const directGearEvaluation = evaluateChallengeObjective({
  telemetry: {
    time: 1,
    systems: {
      mechanisms: {
        poses: [
          { id: 1, phase: 4 },
          { id: 2, phase: -2 },
        ],
      },
    },
  },
  objective: gearChallenge.objective,
  binding: { kind: "mechanism", inputPartId: 1, outputPartId: 2 },
  candidate: {},
  dt: 1,
  holdS: 0,
  apexM: 0,
  touchedWater: false,
});
assert.equal(Object.isFrozen(directGearEvaluation), true);
assert.equal(Object.isFrozen(directGearEvaluation.criteria[0].evidence), true);
assert.deepEqual(directGearEvaluation.criteria[0].evidence, {
  channelId: "mechanism:1:2",
  unit: "ratio",
  frame: "mechanism-phase",
  tick: 120,
  validity: "valid",
  provenance: { inputPartId: 1, outputPartId: 2 },
});
const thresholdGear = evaluateChallengeObjective({
  telemetry: {
    tick: 4,
    systems: {
      mechanisms: {
        poses: [
          { id: 1, phase: 4 },
          { id: 2, phase: -0.001 },
        ],
      },
    },
  },
  objective: { kind: "gear-ratio", ratio: 4000, holdS: 1 },
  binding: { kind: "mechanism", inputPartId: 1, outputPartId: 2 },
  candidate: {},
  dt: 1,
  holdS: 0,
});
assert.equal(thresholdGear.objectiveMet, false);
assert.equal(thresholdGear.criteria[0].current, "NO ROTATION");
const targetBoundary = evaluateChallengeObjective({
  telemetry: {
    tick: 6,
    systems: {
      sensors: {
        controllers: {
          9: {
            __bindings: [
              {
                bindingId: "far",
                valid: true,
                bound: true,
                endpointPartId: 5,
                hitBodyId: "target",
                rangeM: 12,
                rangeRateMps: 0,
              },
              {
                bindingId: "near",
                valid: true,
                bound: true,
                endpointPartId: 5,
                hitBodyId: "target",
                rangeM: 10,
                rangeRateMps: -2,
              },
            ],
          },
        },
      },
    },
  },
  objective: {
    kind: "target",
    targetBodyId: "target",
    maximumRangeM: 10,
    maximumRangeRateMps: 2,
    progressRangeM: 20,
    holdS: 1,
  },
  candidate: { partIds: [5] },
  dt: 1,
  holdS: 0,
});
assert.equal(targetBoundary.objectiveMet, true);
assert.equal(targetBoundary.criteria[0].evidence.channelId, "near");
assert.match(targetBoundary.criteria[0].current, /10\.0 M · -2\.0 M\/S/);
const deliveryContext = {
  telemetry: { tick: 7 },
  objective: {
    kind: "delivery",
    distanceM: 10,
    altitudeM: 5,
    requireWater: true,
    finishClearOfWater: true,
    finishGrounded: true,
    maxSpeedMps: 2,
    holdS: 1,
  },
  candidate: {
    distanceM: 10,
    altitudeM: 5,
    inWater: false,
    grounded: true,
    velocity: { x: 2, y: 0, z: 0 },
    partIds: [5],
  },
  touchedWater: true,
  dt: 1,
  holdS: 0,
};
const deliveryBoundary = evaluateChallengeObjective(deliveryContext);
assert.equal(deliveryBoundary.objectiveMet, true);
assert.deepEqual(
  deliveryBoundary.criteria.map((criterion) => [criterion.id, criterion.met]),
  [
    ["distance", true],
    ["altitude", true],
    ["water", true],
    ["stable", true],
  ],
);
for (const override of [
  { distanceM: 9 },
  { altitudeM: 4 },
  { inWater: true },
  { grounded: false },
  { velocity: { x: 2.1, y: 0, z: 0 } },
])
  assert.equal(
    evaluateChallengeObjective({
      ...deliveryContext,
      candidate: { ...deliveryContext.candidate, ...override },
    }).objectiveMet,
    false,
  );
assert.deepEqual(
  evaluateChallengeConstraints({
    telemetry: { tick: 8 },
    constraints: { noDamage: true, maxFatigue: 0.5 },
    damage: { failed: 0, detached: 0, worstFatigue: 0.5 },
  }).map((criterion) => [criterion.id, criterion.met]),
  [
    ["damage", true],
    ["fatigue", true],
  ],
);
assert.deepEqual(
  evaluateChallengeConstraints({
    telemetry: { tick: 9 },
    constraints: { noDamage: true, maxFatigue: 0.5 },
    damage: { failed: 1, detached: 0, worstFatigue: 0.5001 },
  }).map((criterion) => [criterion.id, criterion.met]),
  [
    ["damage", false],
    ["fatigue", false],
  ],
);
const unknownObjective = evaluateChallengeObjective({
  telemetry: { tick: 5 },
  objective: { kind: "demo-magic" },
  candidate: {},
  dt: 1,
  holdS: 0,
});
assert.equal(unknownObjective.objectiveMet, false);
assert.equal(unknownObjective.criteria[0].evidence.validity, "invalid");
const offlineReference = evaluateReferenceControlAvailability(
  {
    tick: 1,
    systems: { power: { poweredPartIds: [8] }, signals: { routes: [] } },
  },
  [{ profileId: "gearbox", controlId: "gearbox-1", targetId: 8 }],
)[0];
assert.equal(offlineReference.met, false);
assert.match(offlineReference.current, /NO SIGNAL ROUTE/);
assert.equal(offlineReference.evidence.validity, "offline");
const onlineReference = evaluateReferenceControlAvailability(
  {
    tick: 2,
    systems: {
      power: { poweredPartIds: [8] },
      signals: { routes: [{ targetId: 8, controllerIds: [9] }] },
    },
  },
  [{ profileId: "gearbox", controlId: "gearbox-1", targetId: 8 }],
)[0];
assert.equal(onlineReference.met, true);
assert.equal(Object.isFrozen(onlineReference.evidence), true);
assert.equal(
  transitionChallengeStatus({
    currentStatus: "running",
    candidate: { fallen: false },
    constraints: {},
    damage: { failed: 0, detached: 0 },
    objectiveMet: unknownObjective.objectiveMet,
    criteria: unknownObjective.criteria,
  }),
  "running",
);
assert.equal(
  transitionChallengeStatus({
    currentStatus: "complete",
    candidate: { fallen: true },
    constraints: { failOnDamage: true },
    damage: { failed: 1, detached: 1 },
    objectiveMet: false,
    criteria: [],
  }),
  "complete",
);
assert.equal(result.metrics.touchedWater, false);
const completedGearResult = result;
assert.equal(gearRun.step({}, 1), completedGearResult);

const partialGearRun = new ChallengeRun(gearChallenge, gearMachine);
result = stepChallenge(
  partialGearRun,
  {
    systems: {
      mechanisms: {
        poses: [
          { id: 99, phase: 99 },
          { id: 2, phase: -2 },
          { id: 1, phase: 4 },
        ],
      },
    },
  },
  0.5,
);
assert.equal(result.progress, 0.5);
assert.equal(result.status, "running");

function currentPart(id, type) {
  return {
    id,
    type,
    pos: [id / 10, 1, 0],
    orientation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    config: {},
  };
}

function rotaryConnection(id, a, b, portA, portB, kind = "mechanical") {
  return {
    id,
    a,
    b,
    portA,
    portB,
    kind,
    capacity: {
      ultimateForceN: kind === "mesh" ? 12_000 : 24_000,
      ultimateTorqueNm: kind === "mesh" ? 3_000 : 6_000,
    },
  };
}

const multiTrainAssembly = {
    revision: 17,
    parts: [
      currentPart(10, "motor"),
      currentPart(11, "gear12"),
      currentPart(12, "gear24"),
      currentPart(20, "motor"),
      currentPart(21, "gear12"),
      currentPart(22, "gear24"),
    ],
    connections: [
      rotaryConnection("drive-a", 10, 11, "SHAFT", "AXLE"),
      rotaryConnection("mesh-a", 11, 12, "MESH", "MESH", "mesh"),
      rotaryConnection("drive-b", 20, 21, "SHAFT", "AXLE"),
      rotaryConnection("mesh-b", 21, 22, "MESH", "MESH", "mesh"),
    ],
  },
  multiTrainChallenge = {
    id: "deterministic-multi-train",
    objective: { kind: "gear-ratio", ratio: 2, holdS: 1 },
    constraints: {},
  };

class MechanismPoseSystem {
  phase = "actuators";

  constructor(poses) {
    this.poses = poses;
  }

  step(context) {
    context.telemetry.mechanisms = {
      poses: structuredClone(this.poses),
    };
  }
}

function runMultiTrain(assembly) {
  const run = new ChallengeRun(multiTrainChallenge, assembly),
    poseSystem = new MechanismPoseSystem([
      { id: 11, phase: 4 },
      { id: 12, phase: -2 },
      { id: 21, phase: 8 },
      { id: 22, phase: -4 },
    ]),
    session = new SimulationSession({
      systems: [poseSystem, new TelemetrySystem()],
    }).start(assembly, {
      catalog: TYPES,
      resolveChallengeBinding: (frame) => run.resolveBinding(frame),
    });
  assert.equal(session.telemetry().systems.challengeBinding, undefined);
  session.stepFixed(120);
  const live = session.telemetry(),
    result = run.step(live, 1),
    replay = new ReplayBuffer({ sampleHz: 120 });
  replay.record(live, { force: true });
  const replayFrame = replay.frame(0).telemetry;
  assert.deepEqual(
    replayFrame.systems.challengeBinding,
    live.systems.challengeBinding,
  );
  poseSystem.poses = [
    { id: 11, phase: 0 },
    { id: 12, phase: 0 },
    { id: 21, phase: 10 },
    { id: 22, phase: -5 },
  ];
  session.stepFixed();
  const locked = session.telemetry().systems.challengeBinding;
  session.dispose();
  return { live, replayFrame, result, locked };
}

const canonicalTrain = runMultiTrain(multiTrainAssembly),
  reorderedTrain = runMultiTrain({
    ...multiTrainAssembly,
    parts: [...multiTrainAssembly.parts].reverse(),
    connections: [...multiTrainAssembly.connections].reverse(),
  }),
  expectedTrainBinding = {
    kind: "mechanism",
    policyVersion: 1,
    inputPartId: 11,
    outputPartId: 12,
  };
assert.deepEqual(
  canonicalTrain.live.systems.challengeBinding,
  expectedTrainBinding,
);
assert.deepEqual(
  reorderedTrain.live.systems.challengeBinding,
  expectedTrainBinding,
);
assert.deepEqual(canonicalTrain.locked, expectedTrainBinding);
assert.deepEqual(
  canonicalTrain.result.metrics.proofBinding,
  expectedTrainBinding,
);

const proofState = {
  activeChallenge: multiTrainChallenge.id,
  challengeStatus: "running",
  challengeProgress: 0,
  challengeScore: 0,
  challengeRecords: [],
  challengeBest: {},
};
recordChallengeResult({
  state: proofState,
  result: canonicalTrain.result,
  storage: { writeJson() {} },
  keys: { challengeRecords: "records", challengeBest: "best" },
  assetFingerprint: `sim-sha256-${"4".repeat(64)}`,
  proofContext: {
    complete: true,
    partIds: multiTrainAssembly.parts.map((part) => part.id),
  },
});
assert.deepEqual(proofState.challengeRecords[0].binding, expectedTrainBinding);
assert.equal(proofState.challengeRecords[0].verificationEligible, true);

const invalidGearRun = new ChallengeRun(gearChallenge, gearMachine);
invalidGearRun.holdS = 0.75;
result = stepChallenge(
  invalidGearRun,
  {
    systems: {
      mechanisms: {
        poses: [
          { id: 99, phase: 99 },
          { id: 1, phase: 1 },
          { id: 2, phase: 1 },
        ],
      },
    },
  },
  0.5,
);
assert.equal(result.status, "running");
assert.equal(result.holdS, 0);
assert.equal(result.criteria[0].current, "1.00:1");
for (const [inputPhase, outputPhase] of [
  [3.8, -2],
  [4.2, -2],
  [4, 0],
]) {
  const boundaryRun = new ChallengeRun(gearChallenge, gearMachine);
  const boundary = stepChallenge(
    boundaryRun,
    {
      systems: {
        mechanisms: {
          poses: [
            { id: 99, phase: 99 },
            { id: 2, phase: outputPhase },
            { id: 1, phase: inputPhase },
          ],
        },
      },
    },
    1,
  );
  assert.equal(boundary.status, "running");
  assert.equal(boundary.holdS, 0);
}

for (const poses of [
  [
    { id: 99, phase: 99 },
    { id: 2, phase: 2 },
    { id: 1, phase: 4 },
  ],
  [
    { id: 99, phase: 99 },
    { id: 2, phase: 0.001 },
    { id: 1, phase: -0.002 },
  ],
  [
    { id: 99, phase: 99 },
    { id: 2, phase: -2 },
  ],
]) {
  const rejectedRun = new ChallengeRun(gearChallenge, gearMachine),
    rejected = stepChallenge(
      rejectedRun,
      { systems: { mechanisms: { poses } } },
      1,
    );
  assert.equal(rejected.status, "running");
  assert.equal(rejected.holdS, 0);
}
const longHoldRun = new ChallengeRun(
  {
    ...gearChallenge,
    objective: { ...gearChallenge.objective, holdS: 2 },
  },
  gearMachine,
);
result = stepChallenge(
  longHoldRun,
  {
    systems: {
      mechanisms: {
        poses: [
          { id: 99, phase: 99 },
          { id: 2, phase: -2 },
          { id: 1, phase: 4 },
        ],
      },
    },
  },
  1,
);
assert.equal(result.progress, 0.5);
assert.equal(result.status, "running");

const targetMachine = machine({ kind: "rocket" }),
  targetChallenge = {
    id: "quality-target",
    objective: {
      kind: "target",
      targetBodyId: "environment:test-target",
      maximumRangeM: 20,
      maximumRangeRateMps: 2,
      progressRangeM: 1_000,
      holdS: 0.5,
    },
    constraints: {},
  },
  targetRun = new ChallengeRun(targetChallenge, targetMachine);
stepChallenge(
  targetRun,
  telemetry(targetMachine, 0, {
    y: 0,
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
  }),
  0,
);
result = stepChallenge(
  targetRun,
  telemetry(targetMachine, 2, {
    y: 4,
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
    targetMeasurement: {
      hitBodyId: "environment:test-target",
      rangeM: 600,
      rangeRateMps: -8,
    },
  }),
  0.5,
);
assert.equal(result.status, "running");
assert.ok(Math.abs(result.progress - 0.32) < 1e-9);
result = stepChallenge(
  targetRun,
  telemetry(targetMachine, 3, {
    y: 12,
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
    targetMeasurement: {
      hitBodyId: "environment:test-target",
      rangeM: 12,
      rangeRateMps: 1,
    },
  }),
  0.5,
);
assert.equal(result.status, "complete");
assert.equal(result.criteria[0].current, "12.0 M · 1.0 M/S");

for (const targetMeasurement of [
  null,
  {
    hitBodyId: "environment:wrong-target",
    rangeM: 12,
    rangeRateMps: 1,
  },
  {
    hitBodyId: "environment:test-target",
    rangeM: 12,
    rangeRateMps: 3,
  },
  {
    hitBodyId: "environment:test-target",
    rangeM: 12,
    rangeRateMps: 1,
    valid: false,
  },
  {
    hitBodyId: "environment:test-target",
    rangeM: 12,
    rangeRateMps: 1,
    bound: false,
  },
]) {
  const rejectedTarget = new ChallengeRun(targetChallenge, targetMachine);
  stepChallenge(rejectedTarget, telemetry(targetMachine, 0), 0);
  const rejected = stepChallenge(
    rejectedTarget,
    telemetry(targetMachine, 1, {
      grounded: false,
      targetMeasurement,
    }),
    0.5,
  );
  assert.equal(rejected.status, "running");
  assert.equal(rejected.holdS, 0);
}

const interruptedFix = new ChallengeRun(targetChallenge, targetMachine);
stepChallenge(interruptedFix, telemetry(targetMachine, 0), 0);
result = stepChallenge(
  interruptedFix,
  telemetry(targetMachine, 1, {
    grounded: false,
    targetMeasurement: {
      hitBodyId: "environment:test-target",
      rangeM: 12,
      rangeRateMps: 1,
    },
  }),
  0.25,
);
assert.equal(result.holdS, 0.25);
result = stepChallenge(
  interruptedFix,
  telemetry(targetMachine, 2, { grounded: false }),
  0.25,
);
assert.equal(result.holdS, 0, "loss of sensor fix retained rendezvous hold");

const exactReturnChallenge = {
    id: "quality-exact-return",
    objective: {
      kind: "safe-return",
      altitudeM: 10,
      maxLandingSpeedMps: 5,
    },
    constraints: {},
  },
  exactReturn = new ChallengeRun(exactReturnChallenge, targetMachine);
stepChallenge(
  exactReturn,
  telemetry(targetMachine, 0, {
    y: 0,
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
  }),
  0,
);
result = stepChallenge(
  exactReturn,
  telemetry(targetMachine, 1, {
    y: 10,
    velocity: { x: 0, y: 3, z: 0 },
    grounded: false,
  }),
  0.5,
);
assert.equal(result.progress, 0.55);
assert.equal(result.status, "running");
result = stepChallenge(
  exactReturn,
  telemetry(targetMachine, 2, {
    y: 0,
    velocity: { x: 0, y: -5, z: 0 },
    grounded: true,
  }),
  0.5,
);
assert.equal(result.status, "complete");
assert.equal(result.progress, 1);

const unsafeReturn = new ChallengeRun(exactReturnChallenge, targetMachine);
stepChallenge(
  unsafeReturn,
  telemetry(targetMachine, 0, {
    y: 0,
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
  }),
  0,
);
result = stepChallenge(
  unsafeReturn,
  telemetry(targetMachine, 1, {
    y: 5,
    velocity: { x: 0, y: 2, z: 0 },
    grounded: false,
  }),
  0.5,
);
assert.equal(result.progress, 0.275);
assert.equal(result.criteria.find((entry) => entry.id === "apex").met, false);
stepChallenge(
  unsafeReturn,
  telemetry(targetMachine, 2, {
    y: 10,
    velocity: { x: 0, y: 2, z: 0 },
    grounded: false,
  }),
  0.5,
);
result = stepChallenge(
  unsafeReturn,
  telemetry(targetMachine, 3, {
    y: 0,
    velocity: { x: 0, y: -6, z: 0 },
    grounded: true,
  }),
  0.5,
);
assert.equal(result.status, "running");
assert.equal(result.progress, 0.55);
assert.equal(result.criteria.find((entry) => entry.id === "return").met, false);

const exactDelivery = new ChallengeRun(
  {
    id: "quality-exact-delivery",
    objective: {
      distanceM: 10,
      altitudeM: 5,
      maxSpeedMps: 2,
      finishGrounded: true,
      holdS: 1,
    },
    constraints: {},
  },
  targetMachine,
);
stepChallenge(
  exactDelivery,
  telemetry(targetMachine, 0, {
    y: 0,
    velocity: { x: 1, y: 0, z: 0 },
  }),
  0,
);
result = stepChallenge(
  exactDelivery,
  telemetry(targetMachine, 0.5, {
    x: 5,
    y: 2,
    velocity: { x: 1, y: 0, z: 0 },
    grounded: false,
  }),
  0.5,
);
assert.equal(result.status, "running");
assert.equal(result.progress, 0.4);
assert.deepEqual(
  result.criteria.map((entry) => entry.id),
  ["distance", "altitude", "stable"],
);
assert.equal(result.criteria.find((entry) => entry.id === "stable").met, false);
result = stepChallenge(
  exactDelivery,
  telemetry(targetMachine, 1, {
    x: 10,
    y: 5,
    velocity: { x: 2, y: 0, z: 0 },
    grounded: true,
  }),
  1,
);
assert.equal(result.status, "complete");
assert.equal(result.progress, 1);
assert.ok(result.criteria.every((entry) => entry.met));

const dryWaterRun = new ChallengeRun(
  {
    id: "quality-dry-water",
    objective: { requireWater: true, finishClearOfWater: true, holdS: 0 },
    constraints: {},
  },
  targetMachine,
);
result = stepChallenge(
  dryWaterRun,
  telemetry(targetMachine, 1, {
    velocity: { x: 1, y: 0, z: 0 },
    grounded: true,
  }),
  1,
);
assert.equal(result.status, "running");
assert.equal(result.criteria[0].met, false);

const wetWaterRun = new ChallengeRun(
  {
    id: "quality-wet-water",
    objective: { requireWater: true, finishClearOfWater: true, holdS: 0 },
    constraints: {},
  },
  targetMachine,
);
result = stepChallenge(
  wetWaterRun,
  telemetry(targetMachine, 1, {
    velocity: { x: 1, y: 0, z: 0 },
    grounded: true,
    wetPartIds: targetMachine.parts.map((part) => part.id),
  }),
  1,
);
assert.equal(result.status, "running");
assert.equal(result.criteria[0].id, "water");
assert.equal(result.criteria[0].current, "CONTACT PROVEN");
assert.equal(result.criteria[0].met, false);

const fallingMachine = {
    parts: [
      {
        id: 7,
        type: "plate",
        orientation: [0, 0, 0, 1],
        config: { mass: 1 },
      },
    ],
    connections: [],
  },
  fallingRun = new ChallengeRun(
    {
      id: "quality-fall",
      objective: { kind: "delivery", distanceM: 1 },
      constraints: {},
    },
    fallingMachine,
  );
result = stepChallenge(
  fallingRun,
  telemetry(fallingMachine, 1, {
    x: 2,
    y: -10,
    grounded: false,
    velocity: { x: 1, y: -1, z: 0 },
  }),
  1,
);
assert.equal(result.status, "failed");

const detachedDamageMachine = structuredClone(fallingMachine);
detachedDamageMachine.parts[0].detached = true;
const damageRun = new ChallengeRun(
  {
    id: "quality-damage",
    objective: {},
    constraints: { noDamage: true, failOnDamage: true, maxFatigue: 0.5 },
  },
  detachedDamageMachine,
);
result = stepChallenge(
  damageRun,
  telemetry(detachedDamageMachine, 1, {
    velocity: { x: 1, y: 0, z: 0 },
  }),
  1,
);
assert.equal(result.status, "failed");
assert.equal(result.criteria.find((entry) => entry.id === "damage").met, false);
assert.equal(result.metrics.damage, 1);

const fatigueMachine = {
    parts: [
      {
        id: 1,
        type: "plate",
        orientation: [0, 0, 0, 1],
        config: { mass: 1 },
      },
      {
        id: 2,
        type: "plate",
        orientation: [0, 0, 0, 1],
        config: { mass: 1 },
      },
    ],
    connections: [
      {
        id: "fatigued-joint",
        a: 1,
        b: 2,
        portA: "TOP",
        portB: "TOP",
        kind: "mechanical",
        capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
        fatigue: 0.5,
      },
    ],
  },
  fatigueRun = new ChallengeRun(
    {
      id: "quality-fatigue",
      objective: {},
      constraints: { noDamage: true, maxFatigue: 0.5 },
    },
    fatigueMachine,
  );
result = stepChallenge(
  fatigueRun,
  telemetry(fatigueMachine, 1, {
    velocity: { x: 1, y: 0, z: 0 },
  }),
  1,
);
assert.equal(result.status, "complete");
assert.deepEqual(
  Object.fromEntries(
    Object.entries(
      result.criteria.find((entry) => entry.id === "fatigue"),
    ).filter(([key]) => key !== "evidence"),
  ),
  {
    id: "fatigue",
    label: "PEAK FATIGUE",
    current: "50%",
    target: "≤ 50%",
    met: true,
  },
);
assert.deepEqual(
  result.criteria.find((entry) => entry.id === "fatigue").evidence,
  {
    channelId: "physical-component:fatigue",
    unit: "ratio",
    frame: "assembly-graph",
    tick: 120,
    validity: "valid",
    provenance: { worstFatigue: 0.5 },
  },
);
assert.equal(result.criteria.find((entry) => entry.id === "damage").met, true);

const abortRun = new ChallengeRun(
  { id: "quality-abort", objective: { kind: "delivery" } },
  {},
);
assert.equal(abortRun.abort().status, "failed");
assert.equal(abortRun.abort().status, "failed");
abortRun.last = null;
assert.equal(abortRun.snapshot().status, "failed");
assert.deepEqual(challengeReliability([], "missing"), {
  attempts: 0,
  successes: 0,
  reliability: 0,
  solutions: [],
  best: 0,
});
assert.deepEqual(
  challengeReliability([{ id: "other", success: true }], "missing"),
  {
    attempts: 0,
    successes: 0,
    reliability: 0,
    solutions: [],
    best: 0,
  },
);
assert.equal(
  challengeReliability(
    [{ id: "scored", success: true, solution: "A" }],
    "scored",
  ).best,
  0,
);
assert.equal(
  challengeReliability(
    [
      { id: "mixed", success: true, solution: "A", score: 10 },
      { id: "mixed", success: false, solution: "B", score: 20 },
    ],
    "mixed",
  ).reliability,
  0.5,
);

const noRotationRun = new ChallengeRun(gearChallenge, gearMachine);
result = noRotationRun.step({}, 0.25);
assert.equal(result.criteria[0].current, "NO ROTATION");
const defaultObjectiveRun = new ChallengeRun(
  { id: "defaults" },
  {
    parts: [
      {
        id: 9,
        type: "battery",
        orientation: [0, 0, 0, 1],
        energyJ: 7200,
        mass: 3,
      },
    ],
    connections: [],
  },
);
assert.equal(defaultObjectiveRun.initial.energy, 2);
assert.equal(defaultObjectiveRun.initial.mass, 3);
assert.equal(defaultObjectiveRun.makeResult().metrics.damage, 0);
const payloadDefaultRun = new ChallengeRun(
  { id: "payload-default", payload: {}, objective: {} },
  {},
);
assert.match(payloadDefaultRun.snapshot().criteria[0].target, /80 KG/);

const waterContactOnly = new ChallengeRun(
  {
    id: "water-contact-only",
    objective: { requireWater: true },
    constraints: {},
  },
  targetMachine,
);
stepChallenge(
  waterContactOnly,
  telemetry(targetMachine, 0, {
    velocity: { x: 1, y: 0, z: 0 },
    wetPartIds: targetMachine.parts.map((part) => part.id),
  }),
  0,
);
result = stepChallenge(
  waterContactOnly,
  telemetry(targetMachine, 1, {
    velocity: { x: 0, y: 0, z: 0 },
    wetPartIds: targetMachine.parts.map((part) => part.id),
  }),
  1,
);
assert.equal(result.status, "complete");
assert.equal(result.criteria[0].target, "CONTACT WATER");

const lostRun = new ChallengeRun(
  {
    id: "lost-bound-component",
    objective: { distanceM: 1 },
    constraints: {},
  },
  fallingMachine,
);
stepChallenge(
  lostRun,
  telemetry(fallingMachine, 0, {
    velocity: { x: 1, y: 0, z: 0 },
  }),
  0,
);
result = stepChallenge(lostRun, { time: 1 }, 1);
assert.equal(result.criteria.at(-1).current, "BOUND COMPONENT LOST");

const catalog = {
  beam: { name: "Test Beam" },
  plate: { name: "Test Plate" },
};

function snapshot({
  time = 1,
  connection = {},
  detached = false,
  contact = null,
  thermal = [],
  includeBodies = true,
} = {}) {
  const parts = [
      { id: 1, type: "beam", orientation: [0, 0, 0, 1] },
      { id: 2, type: "plate", orientation: [0, 0, 0, 1], detached },
    ],
    connections = [
      {
        id: "joint",
        a: 1,
        b: 2,
        kind: "mechanical",
        capacity: { ultimateForceN: 100, ultimateTorqueNm: 40 },
        lastLoadN: 125,
        failed: true,
        ...connection,
      },
    ],
    body = {
      bodyId: "body:assembly",
      partIds: [1, 2],
      descriptors: [{ massKg: 3 }],
      pose: {
        position: { x: 4, y: 2, z: -1 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
      },
      velocity: { x: 0, y: 0, z: 0 },
      contacts: contact ? [contact] : [],
    };
  return {
    time,
    run: { parts, connections },
    bodies: includeBodies
      ? {
          bodies: [body],
          bodyByPart: [1, 2].map((partId) => ({
            partId,
            bodyId: body.bodyId,
          })),
        }
      : { bodies: [], bodyByPart: [] },
    systems: {
      physicalAssembly: {
        schemaVersion: 1,
        compiledIdentity: "compiled-physical:failure-test",
        graphRevision: connections[0].failed ? 1 : 0,
        topologyRevision: connections[0].failed ? 1 : 0,
        components: (connections[0].failed ? [[1], [2]] : [[1, 2]]).map(
          (partIds) => ({
            id: `physical-test:${partIds.join("|")}`,
            partIds,
            bodyPartIds: partIds,
            compiledBodyIds: partIds.map((partId) => `body:${partId}`),
            constraintIds: connections[0].failed ? [] : ["joint"],
            sourceConnectionIds: connections[0].failed ? [] : ["joint"],
            supportPartIds: partIds,
            lineage: {
              parentIds: [],
              splitFromIds: [],
              structuralEventIds: [],
            },
          }),
        ),
      },
      aerothermal: { parts: thermal },
      fluids: { byPart: {} },
      flight: { groups: [] },
    },
  };
}

function firstFailure(options) {
  const recorder = new FailureRecorder({ catalog }),
    created = recorder.ingest(snapshot(options));
  assert.equal(created.length, 1);
  assert.equal(recorder.ingest(snapshot(options)).length, 0);
  return { recorder, event: created[0] };
}

assert.equal(new FailureRecorder().report().status, "nominal");
assert.equal(
  new FailureRecorder({ catalog }).ingest(
    snapshot({ connection: { kind: "power", capacity: undefined } }),
  ).length,
  0,
  "a detached electrical route became a zero-rated physical failure",
);
assert.equal(
  new FailureRecorder({ catalog }).ingest(
    snapshot({ connection: { failureMode: "commanded-release" } }),
  ).length,
  0,
  "an intentional commanded release became a failure event",
);
assert.equal(
  firstFailure({ connection: { failureReason: "heat limit" } }).event.mode,
  "thermal",
);
assert.equal(
  firstFailure({ connection: { failureReason: "drag pressure" } }).event.mode,
  "aerodynamic",
);
assert.equal(
  firstFailure({ connection: { failureReason: "hard landing" } }).event.mode,
  "impact",
);
assert.equal(
  firstFailure({
    connection: {
      fatigue: 1,
      lastLoadN: 0,
      capacity: { ultimateForceN: 0, ultimateTorqueNm: 0 },
    },
  }).event.mode,
  "fatigue",
);
assert.equal(
  firstFailure({
    connection: {
      lastLoadN: 0,
      capacity: { ultimateForceN: 0, ultimateTorqueNm: 0 },
    },
    contact: {
      surface: "terrain",
      relativeVelocity: { x: 3, y: 4, z: 0 },
    },
  }).event.mode,
  "impact",
);
assert.equal(
  firstFailure({
    connection: {
      lastLoadN: 0,
      capacity: { ultimateForceN: 0, ultimateTorqueNm: 0 },
    },
    thermal: [
      {
        id: 1,
        aerodynamicForceN: 20,
        thermal: { temperatureK: 400, health: 1 },
      },
    ],
  }).event.mode,
  "aerodynamic",
);
const overload = firstFailure({
  connection: {
    lastLoadN: 0,
    peakLoadN: 0,
    stress: 0,
    capacity: { ultimateForceN: 0, ultimateTorqueNm: 0 },
  },
}).event;
assert.equal(overload.mode, "overload");
assert.equal(overload.load.utilization, 0);
assert.equal(overload.reason, "Physical attachment capacity was exceeded");
assert.equal(
  overload.causalChain.some((entry) => entry.label === "PEAK TRANSMITTED LOAD"),
  false,
);
const loaded = firstFailure({}).event;
assert.equal(loaded instanceof FailureEvent, true);
assert.equal(Object.isFrozen(loaded), true);
assert.equal(Object.isFrozen(loaded.evidence.provenance), true);
assert.equal(loaded.id, "failure-1");
assert.equal(loaded.load.peakN, 125);
assert.equal(loaded.load.ratedN, 100);
assert.equal(loaded.load.utilization, 1.25);
assert.equal(loaded.environment.surface, null);
assert.deepEqual(loaded.evidence, {
  channelId: "connection:joint",
  unit: "N,Nm,ratio",
  frame: "world-and-attachment",
  tick: 120,
  validity: "valid",
  provenance: { connectionId: "joint", partIds: [1, 2] },
});
const directFailureSnapshot = snapshot(),
  directFailureConnection = directFailureSnapshot.run.connections[0],
  directObservation = observeConnectionFailure(directFailureConnection, 0),
  directFailure = extractConnectionFailure({
    snapshot: directFailureSnapshot,
    connection: directFailureConnection,
    catalog,
    observation: directObservation,
    eventId: "failure-direct",
  });
assert.equal(Object.isFrozen(directFailure), true);
assert.equal(Object.isFrozen(directFailure.evidence), true);
assert.match(
  loaded.causalChain.find((entry) => entry.label === "ATTACHMENT CAPACITY")
    .value,
  /125% utilized/,
);

assert.equal(
  firstFailure({
    connection: {
      fatigue: 0.99,
      lastLoadN: 0,
      capacity: { ultimateForceN: 0, ultimateTorqueNm: 0 },
    },
  }).event.mode,
  "fatigue",
);

const stressRecorder = new FailureRecorder({ catalog });
const stressed = snapshot({
  connection: {
    failed: false,
    capacity: { ultimateForceN: 100, ultimateTorqueNm: 40 },
    stress: 0.5,
    lastLoadN: 0,
    peakLoadN: 0,
  },
});
stressRecorder.ingest(stressed);
stressed.run.connections[0].failed = true;
stressed.run.connections[0].stress = 0.1;
assert.equal(stressRecorder.ingest(stressed)[0].load.peakN, 50);

const delayedDetachment = new FailureRecorder({ catalog });
delayedDetachment.ingest(snapshot({ detached: false }));
delayedDetachment.ingest(snapshot({ time: 2, detached: true }));
const detachedReport = delayedDetachment.report();
assert.equal(Object.isFrozen(detachedReport), true);
assert.equal(Object.isFrozen(detachedReport.timeline), true);
assert.equal(detachedReport.primary instanceof FailureEvent, true);
assert.deepEqual(detachedReport.primary.detachedPartIds, [2]);
assert.equal(detachedReport.primary.severity, 1.25);
assert.match(
  detachedReport.primary.causalChain.at(-1).value,
  /1 component detached/,
);
assert.equal(detachedReport.timeline.length, 1);

const pluralDetachment = new FailureRecorder({ catalog });
const pluralSnapshot = snapshot({ detached: true });
pluralSnapshot.run.parts[0].detached = true;
pluralDetachment.ingest(pluralSnapshot);
assert.match(
  pluralDetachment.report().primary.causalChain.at(-1).value,
  /2 components detached/,
);

const completeFailureFrame = snapshot({
    connection: { failureReason: "overload" },
  }),
  liveFailureRecorder = new FailureRecorder({ catalog }),
  replayFailureRecorder = new FailureRecorder({ catalog }),
  liveFailure = liveFailureRecorder.ingest(completeFailureFrame)[0],
  replayFailure = replayFailureRecorder.ingest(
    structuredClone(completeFailureFrame),
  )[0];
assert.ok(completeFailureFrame.run.parts.length > 0);
assert.ok(completeFailureFrame.bodies.bodies.length > 0);
assert.deepEqual(
  replayFailure,
  liveFailure,
  "post-mortem evidence diverged when the same complete frame was replayed",
);
assert.equal(
  new FailureRecorder().ingest({}).length,
  0,
  "an incomplete frame invented failure evidence",
);

const thermalRecorder = new FailureRecorder({ catalog });
const thermalSnapshot = snapshot({
  connection: { failed: false },
  thermal: [
    {
      id: 1,
      aerodynamicForceN: 0,
      thermal: {
        consumed: true,
        ablative: true,
        health: 0,
        temperatureK: 1273.15,
      },
    },
  ],
});
const thermalEvent = thermalRecorder.ingest(thermalSnapshot)[0];
assert.equal(thermalEvent.mode, "thermal");
assert.equal(thermalEvent.connectionId, null);
assert.ok(Math.abs(thermalEvent.environment.temperatureC - 1000) < 1e-9);
assert.equal(thermalEvent.id, "failure-1");
assert.ok(Math.abs(thermalEvent.severity - 1.25) < 1e-9);
assert.equal(thermalRecorder.ingest(thermalSnapshot).length, 0);
thermalRecorder.reset();
assert.equal(thermalRecorder.report().eventCount, 0);

const healthRecorder = new FailureRecorder({ catalog });
assert.equal(
  healthRecorder.ingest(
    snapshot({
      connection: { failed: false },
      thermal: [
        {
          id: 2,
          thermal: { ablative: false, health: 0, temperatureK: 900 },
        },
      ],
    }),
  ).length,
  1,
);

const orphanThermalRecorder = new FailureRecorder();
const orphanThermal = orphanThermalRecorder.ingest({
  time: "invalid",
  systems: {
    aerothermal: {
      parts: [
        {
          id: 404,
          thermal: { consumed: true, temperatureK: "invalid" },
        },
      ],
    },
  },
})[0];
assert.equal(orphanThermal.partA.type, "thermal");
assert.equal(orphanThermal.partA.name, "Thermal protection");
assert.equal(orphanThermal.timeS, 0);

const replay = new ReplayBuffer({
  seconds: 1,
  sampleHz: 2,
  postFailureSeconds: 0.5,
});
assert.equal(replay.frame(0), null);
assert.deepEqual(replay.snapshot(), {
  frameCount: 0,
  durationS: 0,
  startTimeS: 0,
  endTimeS: 0,
  failureTimeS: null,
  frozen: false,
});
assert.equal(replay.record({ time: 0, value: "start" }), true);
assert.equal(replay.record({ time: 0.1 }), false);
assert.equal(
  replay.record({ time: 0.1, value: "forced" }, { force: true }),
  true,
);
assert.equal(replay.record({ time: 0.7, value: "latest" }), true);
assert.equal(replay.snapshot().frameCount, 2);
assert.equal(replay.frame(-20).telemetry.value, "forced");
assert.equal(replay.frame(20).telemetry.value, "latest");
replay.pinFailure(0.7);
replay.pinFailure(99);
assert.equal(replay.record({ time: 1.2 }), true);
assert.equal(replay.snapshot().frozen, true);
assert.equal(replay.record({ time: 2 }, { force: true }), false);
assert.ok(Math.abs(replay.snapshot().durationS - 0.5) < 1e-9);
replay.reset();
assert.equal(replay.snapshot().failureTimeS, null);

const replayBoundary = new ReplayBuffer({
  seconds: 3,
  sampleHz: 2,
  postFailureSeconds: 0.5,
});
assert.equal(replayBoundary.maxFrames, 6);
assert.equal(replayBoundary.record({ time: 1 }), true);
assert.equal(replayBoundary.record({ time: 1.499999 }), true);
replayBoundary.pinFailure(1.5);
assert.equal(replayBoundary.record({ time: 1.999999 }), true);
assert.equal(replayBoundary.snapshot().frozen, true);
assert.ok(Math.abs(replayBoundary.snapshot().durationS - 0.999999) < 1e-9);
assert.equal(replayBoundary.snapshot().endTimeS, 1.999999);

console.log("challenge and failure quality matrix passed");
