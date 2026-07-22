import { assert } from "./lib/assert.mjs";
import { CHALLENGES } from "../src/application/content.js";
import {
  ChallengeRun,
  challengeReliability,
} from "../src/model/challenge-lab.js";
import * as publicCore from "../src/core/index.js";
import { recordChallengeResult } from "../src/application/challenge-state-adapter.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";

const cargoRelay = CHALLENGES.find(
    (challenge) => challenge.id === "cargo-relay",
  ),
  upAndHome = CHALLENGES.find((challenge) => challenge.id === "up-and-home");
const airCourier = CHALLENGES.find(
  (challenge) => challenge.id === "air-courier",
);

const TEST_CAPACITY = Object.freeze({
  ultimateForceN: 24_000,
  ultimateTorqueNm: 6_000,
});

export function machine({
  attached = true,
  energy = 100,
  extraMass = 0,
  kind = "wheel",
} = {}) {
  return {
    parts: [
      {
        id: 1,
        type: "cargo",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 80 },
      },
      {
        id: 2,
        type: "plate",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        config: { mass: 22 + extraMass },
      },
      {
        id: 3,
        type: "battery",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        storedEnergyWh: energy,
        config: { mass: 24 },
      },
      {
        id: 4,
        type: kind,
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        ...(kind === "wheel"
          ? { mechanism: mechanismComponentDefinition("wheel") }
          : {
              config: publicCore.resolveWireComponentConfig({
                type: kind,
                config: { mass: 55 },
              }),
            }),
      },
    ],
    connections: [
      ...(attached
        ? [
            {
              id: "payload-mount",
              a: 1,
              b: 2,
              portA: "MOUNT A",
              portB: "TOP",
              kind: "mechanical",
              capacity: TEST_CAPACITY,
            },
          ]
        : []),
      {
        id: "battery-mount",
        a: 2,
        b: 3,
        portA: "TOP",
        portB: "MOUNT",
        kind: "mechanical",
        capacity: TEST_CAPACITY,
      },
      {
        id: "actuator-mount",
        a: 2,
        b: 4,
        portA: "TOP",
        portB: kind === "wheel" ? "AXLE" : "MOUNT",
        kind: "mechanical",
        capacity: TEST_CAPACITY,
      },
    ],
  };
}

function physicalAssemblyTelemetry(parts, connections) {
  const adjacency = new Map(parts.map((part) => [part.id, new Set()]));
  for (const connection of connections) {
    if (!["mechanical", "mesh"].includes(connection.kind) || connection.failed)
      continue;
    adjacency.get(connection.a)?.add(connection.b);
    adjacency.get(connection.b)?.add(connection.a);
  }
  const unvisited = new Set(parts.map((part) => part.id)),
    components = [];
  while (unvisited.size) {
    const pending = [unvisited.values().next().value],
      partIds = [];
    unvisited.delete(pending[0]);
    while (pending.length) {
      const partId = pending.pop();
      partIds.push(partId);
      for (const neighbor of adjacency.get(partId) || []) {
        if (!unvisited.has(neighbor)) continue;
        unvisited.delete(neighbor);
        pending.push(neighbor);
      }
    }
    partIds.sort((left, right) => String(left).localeCompare(String(right)));
    components.push({
      id: `physical-test:${partIds.join("|")}`,
      partIds,
      bodyPartIds: partIds,
      compiledBodyIds: partIds.map((partId) => `body:${partId}`),
      constraintIds: [],
      sourceConnectionIds: [],
      supportPartIds: partIds,
      lineage: {
        parentIds: [],
        splitFromIds: [],
        structuralEventIds: [],
      },
    });
  }
  return {
    schemaVersion: 1,
    compiledIdentity: "compiled-physical:test",
    graphRevision: connections.filter((connection) => connection.failed).length,
    topologyRevision: 0,
    components,
  };
}

export function telemetry(
  assembly,
  time,
  {
    x = 0,
    y = 0.5,
    velocity = { x: 0.1, y: 0, z: 0 },
    grounded = true,
    wetPartIds = [],
    targetMeasurement = null,
    positions = {},
    velocities = {},
  } = {},
) {
  const parts = structuredClone(assembly.parts),
    connections = structuredClone(assembly.connections),
    bodies = parts.map((part) => {
      const position = positions[part.id] || { x, y, z: 0 },
        bodyVelocity = velocities[part.id] || velocity;
      return {
        bodyId: `body:${part.id}`,
        partIds: [part.id],
        descriptors: [
          {
            massKg:
              part.mechanism?.massPropertySource?.massKg ?? part.config.mass,
          },
        ],
        pose: {
          position,
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
        },
        velocity: bodyVelocity,
        angularVelocity: { x: 0, y: 0, z: 0 },
        acceleration: { x: 0, y: 0, z: 0 },
        contacts: grounded
          ? [
              {
                otherBodyId: "environment:terrain",
                normal: { x: 0, y: 1, z: 0 },
                impulseNs: 10,
              },
            ]
          : [],
        loads: [],
        thermal: {},
        detached: Boolean(part.detached),
      };
    }),
    partIds = parts.map((part) => part.id);
  return {
    time,
    run: { parts, connections },
    bodies: {
      bodies,
      bodyByPart: partIds.map((partId) => ({
        partId,
        bodyId: `body:${partId}`,
      })),
    },
    systems: {
      physicalAssembly: physicalAssemblyTelemetry(parts, connections),
      fluids: {
        byPart: Object.fromEntries(
          partIds.map((id) => [
            String(id),
            { submerged: wetPartIds.includes(id) ? 0.5 : 0 },
          ]),
        ),
      },
      sensors: {
        controllers: targetMeasurement
          ? {
              "controller:test": {
                __bindings: [
                  {
                    bindingId: "target:test",
                    endpointPartId: targetMeasurement.endpointPartId ?? 4,
                    endpointPortId: "SIGNAL",
                    reading: "proximity_range_m",
                    routeOnline: targetMeasurement.routeOnline ?? true,
                    valid: targetMeasurement.valid ?? true,
                    bound: targetMeasurement.bound ?? true,
                    hitBodyId: targetMeasurement.hitBodyId,
                    rangeM: targetMeasurement.rangeM,
                    rangeRateMps: targetMeasurement.rangeRateMps,
                  },
                ],
              },
            }
          : {},
      },
    },
  };
}

export function challengeFrame(run, frame) {
  const binding = run.resolveBinding(frame);
  return binding
    ? {
        ...frame,
        systems: { ...(frame.systems || {}), challengeBinding: binding },
      }
    : frame;
}

export function stepChallenge(run, frame, dt) {
  return run.step(challengeFrame(run, frame), dt);
}

assert.ok(
  cargoRelay && airCourier && upAndHome,
  "open challenge contracts are missing",
);
assert.deepEqual(cargoRelay.startModes, ["empty", "current"]);

const roverMachine = machine(),
  roverRun = new ChallengeRun(cargoRelay, roverMachine),
  roverFinalMachine = machine({ energy: 92 });
stepChallenge(roverRun, telemetry(roverMachine, 0), 0);
const roverResult = stepChallenge(
  roverRun,
  telemetry(roverFinalMachine, 2, {
    x: 31,
    velocity: { x: 0, y: 0, z: 0 },
  }),
  1,
);
assert.equal(roverResult.status, "complete", "ground solution did not qualify");
assert.equal(roverResult.solution, "GROUND VEHICLE");
assert.ok(roverResult.criteria.every((entry) => entry.met));
assert.equal(roverResult.verificationEligible, true);
assert.equal(roverResult.metrics.energyUsed, 8);

const recordedState = {
    activeChallenge: cargoRelay.id,
    challengeStatus: "running",
    challengeProgress: 0,
    challengeScore: 0,
    challengeRecords: [],
    challengeBest: {},
  },
  storedValues = new Map();
recordChallengeResult({
  state: recordedState,
  result: roverResult,
  storage: {
    writeJson(key, value) {
      storedValues.set(key, structuredClone(value));
    },
  },
  keys: { challengeRecords: "records", challengeBest: "best" },
  assetFingerprint: `sim-sha256-${"1".repeat(64)}`,
  proofContext: { partIds: roverMachine.parts.map((part) => part.id) },
});
assert.equal(recordedState.challengeRecords[0].proofVersion, 1);
assert.deepEqual(
  recordedState.challengeRecords[0].binding,
  roverResult.metrics.proofBinding,
);
assert.ok(
  recordedState.challengeRecords[0].terminal.criteria.every(
    (entry) => entry.met,
  ),
);
assert.equal(
  storedValues.get("records")[0].assetFingerprint,
  `sim-sha256-${"1".repeat(64)}`,
);

const rocketMachine = machine({ kind: "rocket" }),
  flightRun = new ChallengeRun(airCourier, rocketMachine),
  rocketFinalMachine = machine({ kind: "rocket", energy: 88 });
stepChallenge(flightRun, telemetry(rocketMachine, 0, { grounded: false }), 0);
const flightResult = stepChallenge(
  flightRun,
  telemetry(rocketFinalMachine, 3, {
    x: 32,
    y: 20,
    grounded: false,
    velocity: { x: 0, y: 0, z: 0 },
  }),
  2,
);
assert.equal(
  flightResult.status,
  "complete",
  "flight solution did not qualify",
);
assert.equal(flightResult.solution, "FLIGHT VEHICLE");
assert.equal(flightResult.verificationEligible, true);
recordedState.activeChallenge = airCourier.id;
recordChallengeResult({
  state: recordedState,
  result: flightResult,
  storage: { writeJson() {} },
  keys: { challengeRecords: "records", challengeBest: "best" },
  assetFingerprint: `sim-sha256-${"2".repeat(64)}`,
  proofContext: {
    challengeVersion: 1,
    partIds: rocketMachine.parts.map((part) => part.id),
    environment: {
      seed: "test-world-v1",
      latitude: 32,
      longitude: 35,
      timeOfDay: 14,
      windEnabled: true,
    },
    controllerPrograms: [{ partId: 3, digest: "a".repeat(64) }],
    complete: true,
  },
});
const flightProof = recordedState.challengeRecords.at(-1);
assert.equal(flightProof.proofVersion, 1);
assert.equal(flightProof.verificationEligible, true);
assert.equal(flightProof.assetFingerprint, `sim-sha256-${"2".repeat(64)}`);
assert.equal(flightProof.terminal.metrics.payloadSecured, true);
assert.equal(flightProof.environment.seed, "test-world-v1");
assert.equal(flightProof.controllerPrograms[0].digest, "a".repeat(64));

const incompleteProofState = {
  ...structuredClone(recordedState),
  activeChallenge: airCourier.id,
  challengeRecords: [],
};
recordChallengeResult({
  state: incompleteProofState,
  result: flightResult,
  storage: { writeJson() {} },
  keys: { challengeRecords: "records", challengeBest: "best" },
  assetFingerprint: `sim-sha256-${"3".repeat(64)}`,
  proofContext: { complete: false },
});
assert.equal(
  incompleteProofState.challengeRecords[0].verificationEligible,
  false,
  "an incomplete start-design proof was treated as share-verifiable",
);

const looseMachine = machine({ attached: false }),
  loosePayload = new ChallengeRun(cargoRelay, looseMachine),
  looseResult = stepChallenge(
    loosePayload,
    telemetry(looseMachine, 2, { x: 35 }),
    1,
  );
assert.equal(looseResult.status, "running");
assert.equal(looseResult.metrics.candidate, null);

const returnRun = new ChallengeRun(upAndHome, rocketMachine);
stepChallenge(returnRun, telemetry(rocketMachine, 0, { grounded: false }), 0);
stepChallenge(
  returnRun,
  telemetry(rocketMachine, 2, {
    y: 35.5,
    grounded: false,
    velocity: { x: 0, y: 8, z: 0 },
  }),
  1,
);
const returnResult = stepChallenge(
  returnRun,
  telemetry(rocketMachine, 5, {
    y: 0.5,
    grounded: true,
    velocity: { x: 0, y: -3, z: 0 },
  }),
  1,
);
assert.equal(returnResult.status, "complete", "safe return was not recognized");
assert.ok(returnResult.metrics.apexM >= 30);

// A separate vehicle cannot move a stationary payload component's score.
const exploitMachine = machine();
exploitMachine.connections = exploitMachine.connections.filter(
  (connection) => connection.id !== "actuator-mount",
);
const exploitRun = new ChallengeRun(cargoRelay, exploitMachine),
  exploitPositions = {
    1: { x: 0, y: 0.5, z: 0 },
    2: { x: 0, y: 0.5, z: 0 },
    3: { x: 0, y: 0.5, z: 0 },
    4: { x: 40, y: 0.5, z: 0 },
  },
  exploitVelocities = {
    1: { x: 0.1, y: 0, z: 0 },
    2: { x: 0.1, y: 0, z: 0 },
    3: { x: 0.1, y: 0, z: 0 },
    4: { x: 20, y: 0, z: 0 },
  };
stepChallenge(
  exploitRun,
  telemetry(exploitMachine, 0, {
    positions: exploitPositions,
    velocities: exploitVelocities,
  }),
  0,
);
exploitPositions[4] = { x: 80, y: 0.5, z: 0 };
const exploitResult = stepChallenge(
  exploitRun,
  telemetry(exploitMachine, 3, {
    positions: exploitPositions,
    velocities: exploitVelocities,
  }),
  1,
);
assert.equal(exploitResult.status, "running");
assert.equal(
  exploitResult.criteria.find((entry) => entry.id === "distance")?.met,
  false,
  "separate vehicle movement was credited to stationary cargo",
);

// Detaching cargo follows that cargo component and invalidates the hold.
const detachRun = new ChallengeRun(cargoRelay, roverMachine);
stepChallenge(detachRun, telemetry(roverMachine, 0), 0);
const detachedMachine = structuredClone(roverMachine);
detachedMachine.connections.find(
  (connection) => connection.id === "payload-mount",
).failed = true;
detachedMachine.parts.find((part) => part.id === 1).detached = true;
const detachResult = stepChallenge(
  detachRun,
  telemetry(detachedMachine, 3, {
    x: 31,
    velocity: { x: 0, y: 0, z: 0 },
  }),
  1,
);
assert.equal(detachResult.status, "running");
assert.equal(detachResult.metrics.candidate.policy, "follow-payload");
assert.equal(detachResult.metrics.payloadSecured, false);

// Once motion binds a mission component, a faster disconnected body cannot
// replace it halfway through a run.
const switchingChallenge = {
    ...structuredClone(cargoRelay),
    payload: null,
    objective: { kind: "delivery", distanceM: 10, holdS: 0.5 },
    constraints: {},
  },
  switchingMachine = machine();
switchingMachine.connections = switchingMachine.connections.filter(
  (connection) => connection.id !== "actuator-mount",
);
const switchingRun = new ChallengeRun(switchingChallenge, switchingMachine),
  switchStartPositions = {
    1: { x: 0, y: 0.5, z: 0 },
    2: { x: 0, y: 0.5, z: 0 },
    3: { x: 0, y: 0.5, z: 0 },
    4: { x: 0, y: 0.5, z: 0 },
  },
  switchStartVelocities = {
    1: { x: 4, y: 0, z: 0 },
    2: { x: 4, y: 0, z: 0 },
    3: { x: 4, y: 0, z: 0 },
    4: { x: 1, y: 0, z: 0 },
  };
stepChallenge(
  switchingRun,
  telemetry(switchingMachine, 0, {
    positions: switchStartPositions,
    velocities: switchStartVelocities,
  }),
  0,
);
const switchingResult = stepChallenge(
  switchingRun,
  telemetry(switchingMachine, 2, {
    positions: {
      1: { x: 1, y: 0.5, z: 0 },
      2: { x: 1, y: 0.5, z: 0 },
      3: { x: 1, y: 0.5, z: 0 },
      4: { x: 30, y: 0.5, z: 0 },
    },
    velocities: {
      1: { x: 0, y: 0, z: 0 },
      2: { x: 0, y: 0, z: 0 },
      3: { x: 0, y: 0, z: 0 },
      4: { x: 15, y: 0, z: 0 },
    },
  }),
  1,
);
assert.equal(switchingResult.status, "running");
assert.equal(switchingResult.metrics.candidate.rootPartId, 2);
assert.equal(
  switchingResult.criteria.find((entry) => entry.id === "distance")?.met,
  false,
  "challenge switched to a more favorable disconnected component",
);

// Articulated bodies use their measured velocity rather than a hard-coded zero.
const articulatedMachine = {
    parts: [
      {
        id: 10,
        type: "plate",
        orientation: [0, 0, 0, 1],
        rigRole: "pelvis",
        config: { mass: 40 },
      },
      {
        id: 11,
        type: "cargo",
        orientation: [0, 0, 0, 1],
        config: { mass: 80 },
      },
    ],
    connections: [
      {
        id: "hip-cargo",
        a: 10,
        b: 11,
        portA: "TOP",
        portB: "MOUNT A",
        kind: "mechanical",
        capacity: TEST_CAPACITY,
      },
    ],
  },
  articulatedChallenge = {
    ...structuredClone(cargoRelay),
    objective: {
      kind: "delivery",
      distanceM: 10,
      maxSpeedMps: 2,
      holdS: 0.5,
    },
    constraints: {},
  },
  articulatedRun = new ChallengeRun(articulatedChallenge, articulatedMachine);
stepChallenge(articulatedRun, telemetry(articulatedMachine, 0), 0);
const articulatedResult = stepChallenge(
  articulatedRun,
  telemetry(articulatedMachine, 2, {
    x: 12,
    velocity: { x: 4, y: 0, z: 0 },
  }),
  1,
);
assert.equal(articulatedResult.status, "running");
assert.equal(articulatedResult.solution, "ARTICULATED MACHINE");
assert.equal(
  articulatedResult.criteria.find((entry) => entry.id === "stable")?.met,
  false,
  "articulated speed was replaced with a zero-value shortcut",
);

// Water state follows fluid displacement for the bound component even when it
// is flight-capable.
const waterChallenge = CHALLENGES.find(
    (challenge) => challenge.id === "water-haul",
  ),
  waterRun = new ChallengeRun(waterChallenge, rocketMachine);
stepChallenge(waterRun, telemetry(rocketMachine, 0, { grounded: false }), 0);
stepChallenge(
  waterRun,
  telemetry(rocketMachine, 2, {
    x: 20,
    grounded: false,
    wetPartIds: [1, 2, 4],
  }),
  0.25,
);
const waterResult = stepChallenge(
  waterRun,
  telemetry(rocketMachine, 5, {
    x: 60,
    grounded: true,
    velocity: { x: 0, y: 0, z: 0 },
  }),
  1,
);
assert.equal(waterResult.status, "complete");
assert.equal(waterResult.metrics.touchedWater, true);

// One component's altitude and another component's distance cannot be combined
// into a hybrid success.
const hybridMachine = machine({ kind: "rocket" });
hybridMachine.connections = hybridMachine.connections.filter(
  (connection) => connection.id !== "actuator-mount",
);
const hybridRun = new ChallengeRun(airCourier, hybridMachine);
stepChallenge(hybridRun, telemetry(hybridMachine, 0, { grounded: false }), 0);
const hybridResult = stepChallenge(
  hybridRun,
  telemetry(hybridMachine, 3, {
    grounded: false,
    positions: {
      1: { x: 0, y: 20, z: 0 },
      2: { x: 0, y: 20, z: 0 },
      3: { x: 0, y: 20, z: 0 },
      4: { x: 30, y: 0.5, z: 0 },
    },
    velocities: {
      1: { x: 0, y: 0, z: 0 },
      2: { x: 0, y: 0, z: 0 },
      3: { x: 0, y: 0, z: 0 },
      4: { x: 0, y: 0, z: 0 },
    },
  }),
  2,
);
assert.equal(hybridResult.status, "running");
assert.equal(
  hybridResult.criteria.find((entry) => entry.id === "altitude")?.met,
  true,
);
assert.equal(
  hybridResult.criteria.find((entry) => entry.id === "distance")?.met,
  false,
  "criteria were combined across disconnected physical components",
);

function createHybridMachine() {
  const assembly = machine({ kind: "rocket" });
  assembly.parts.push({
    id: 5,
    type: "wheel",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    mechanism: mechanismComponentDefinition("wheel"),
  });
  assembly.connections.push({
    id: "hybrid-wheel-mount",
    a: 2,
    b: 5,
    portA: "TOP",
    portB: "AXLE",
    kind: "mechanical",
    capacity: TEST_CAPACITY,
  });
  return assembly;
}

function completeOpenContract(challenge, assembly) {
  const run = new ChallengeRun(challenge, assembly),
    objective = challenge.objective;
  stepChallenge(
    run,
    telemetry(assembly, 0, {
      grounded: !["air-courier", "up-and-home"].includes(challenge.id),
    }),
    0,
  );
  if (objective.requireWater)
    stepChallenge(
      run,
      telemetry(assembly, 1, {
        x: objective.distanceM * 0.4,
        grounded: false,
        wetPartIds: assembly.parts.map((part) => part.id),
      }),
      0.25,
    );
  if (objective.kind === "safe-return")
    stepChallenge(
      run,
      telemetry(assembly, 2, {
        y: objective.altitudeM + 1,
        grounded: false,
        velocity: { x: 0, y: 6, z: 0 },
      }),
      1,
    );
  const finalOptions =
    objective.kind === "safe-return"
      ? {
          y: 0.5,
          grounded: true,
          velocity: { x: 0, y: -3, z: 0 },
        }
      : {
          x: (objective.distanceM || 0) + 1,
          y: (objective.altitudeM || 0) + 0.5,
          grounded: Boolean(objective.finishGrounded),
          velocity: { x: 0, y: 0, z: 0 },
        };
  return stepChallenge(
    run,
    telemetry(assembly, 5, finalOptions),
    Math.max(2, objective.holdS || 0),
  );
}

// Contract matrix: each open problem has a passing reference fixture plus two
// independently assembled capability classes. These exercise the evaluator's
// general contract rather than selecting challenge- or demo-specific physics.
for (const challenge of CHALLENGES.filter((entry) => entry.payload)) {
  const referenceAssembly = ["air-courier", "up-and-home"].includes(
      challenge.id,
    )
      ? machine({ kind: "rocket", extraMass: 8 })
      : machine(),
    independentAssemblies = [
      machine({ kind: "rocket" }),
      createHybridMachine(),
    ],
    referenceResult = completeOpenContract(challenge, referenceAssembly),
    independentResults = independentAssemblies.map((assembly) =>
      completeOpenContract(challenge, assembly),
    );
  assert.equal(
    referenceResult.status,
    "complete",
    `${challenge.id} reference trajectory failed its physical contract`,
  );
  assert.ok(
    independentResults.every((result) => result.status === "complete"),
    `${challenge.id} did not accept two independently built solutions`,
  );
  assert.equal(
    new Set(independentResults.map((result) => result.solution)).size,
    2,
    `${challenge.id} alternatives did not represent distinct solution classes`,
  );
}

const efficient = new ChallengeRun(cargoRelay, roverMachine);
stepChallenge(efficient, telemetry(roverMachine, 0), 0);
const efficientResult = stepChallenge(
  efficient,
  telemetry(roverMachine, 2, { x: 31, velocity: { x: 0, y: 0, z: 0 } }),
  1,
);
const heavyMachine = machine({ extraMass: 300 }),
  heavy = new ChallengeRun(cargoRelay, heavyMachine);
stepChallenge(heavy, telemetry(heavyMachine, 0), 0);
const heavyResult = stepChallenge(
  heavy,
  telemetry(heavyMachine, 7, { x: 31, velocity: { x: 0, y: 0, z: 0 } }),
  1,
);
assert.ok(efficientResult.score > heavyResult.score);

const reliability = challengeReliability(
  [
    {
      id: "cargo-relay",
      success: true,
      score: 8000,
      solution: "FLIGHT VEHICLE",
    },
    { id: "cargo-relay", success: false, score: 0, solution: "GROUND VEHICLE" },
    {
      id: "cargo-relay",
      success: true,
      score: 8500,
      solution: "GROUND VEHICLE",
    },
  ],
  "cargo-relay",
);
assert.equal(reliability.attempts, 3);
assert.equal(reliability.successes, 2);
assert.equal(reliability.best, 8500);
assert.equal(publicCore.ChallengeRun, ChallengeRun);
assert.equal(publicCore.challengeReliability, challengeReliability);

console.log(
  `challenge lab passed (bound ground ${roverResult.score}, bound flight ${flightResult.score}, exploits rejected)`,
);
