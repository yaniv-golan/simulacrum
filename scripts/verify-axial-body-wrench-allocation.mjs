import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { DomainValidationError } from "../src/model/primitives.js";
import { allocateAxialBodyWrench } from "../src/simulation/axial-body-wrench-allocation.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { MechanismSystem } from "../src/simulation/systems/mechanism-system.js";
import { MotorEnergySettlementSystem } from "../src/simulation/systems/motor-energy-settlement-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120;
const CAPACITY = { ultimateForceN: 1_000_000, ultimateTorqueNm: 1_000_000 };
const CHECKPOINT_IDENTITIES = {
  runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
  blueprintFingerprint: `sim-sha256-${"2".repeat(64)}`,
  compiledTopologyFingerprint: `sim-sha256-${"3".repeat(64)}`,
};
const near = (left, right, tolerance = 1e-8) =>
  Math.abs(left - right) <=
  Math.max(tolerance, tolerance * Math.max(1, Math.abs(left), Math.abs(right)));
const add = (left, right) => left.map((entry, index) => entry + right[index]);
const subtract = (left, right) =>
  left.map((entry, index) => entry - right[index]);
const scale = (value, factor) => value.map((entry) => entry * factor);
const dot = (left, right) =>
  left.reduce((sum, entry, index) => sum + entry * right[index], 0);
const norm = (value) => Math.hypot(...value);
const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];
const bodyAngularMomentumWorld = (body) => {
  const worldToPrincipal = body.quaternion.conjugate(new CANNON.Quaternion()),
    omegaPrincipal = worldToPrincipal.vmult(body.angularVelocity),
    spinPrincipal = new CANNON.Vec3(
      body.inertia.x * omegaPrincipal.x,
      body.inertia.y * omegaPrincipal.y,
      body.inertia.z * omegaPrincipal.z,
    ),
    spinWorld = body.quaternion.vmult(spinPrincipal),
    orbital = cross(
      [body.position.x, body.position.y, body.position.z],
      scale([body.velocity.x, body.velocity.y, body.velocity.z], body.mass),
    );
  return add(orbital, [spinWorld.x, spinWorld.y, spinWorld.z]);
};
const rotate = (value, quaternion) => {
  const [x, y, z] = value,
    [qx, qy, qz, qw] = quaternion,
    tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
};
const multiplyQuaternion = (left, right) => {
  const [lx, ly, lz, lw] = left,
    [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
};

const request = (overrides = {}) => ({
  version: 1,
  observationTick: 7,
  targetPartId: "target",
  targetWrenchPart: { forceN: [0, 0, 120], momentNm: [0, 0, 0] },
  actuators: [
    {
      actuatorPartId: "axis",
      minimumForceN: -1_000,
      maximumForceN: 1_000,
    },
  ],
  acceptance: {
    forceResidualToleranceN: 1e-7,
    momentResidualToleranceNm: 1e-7,
    momentReferenceLengthM: 1,
  },
  solver: { maxIterations: 64, projectedGradientToleranceN: 1e-8 },
  ...overrides,
});

const part = (id, type, pos, extra = {}) => ({
  id,
  type,
  pos,
  orientation: [0, 0, 0, 1],
  ...extra,
});

function forceMechanism() {
  const mechanism = structuredClone(
    mechanismComponentDefinition("linear-actuator"),
  );
  mechanism.config.commandLaw = { kind: "force-command-v1" };
  return mechanism;
}

function runtimeFixture({
  translation = [0, 0, 0],
  rotation = [0, 0, 0, 1],
  integrate = true,
  forceCommand = true,
  internalFixed = false,
} = {}) {
  const baseId = "basis-base",
    targetId = "basis-target",
    actuatorId = 2,
    batteryId = "basis-battery",
    controllerId = "basis-controller",
    anchor = [0.4, 0, 0],
    worldPosition = (local) => add(translation, rotate(local, rotation)),
    parts = [
      part(baseId, "plate", worldPosition([0, 0, -0.55]), {
        orientation: rotation,
        config: { linearDamping: 0, angularDamping: 0 },
      }),
      part(actuatorId, "linear-actuator", worldPosition([0.4, 0, 0]), {
        orientation: multiplyQuaternion(rotation, [0, 0, 0, 1]),
        mechanism: forceCommand
          ? forceMechanism()
          : structuredClone(mechanismComponentDefinition("linear-actuator")),
      }),
      part(targetId, "plate", worldPosition([0, 0, 0.55]), {
        orientation: rotation,
        config: { linearDamping: 0, angularDamping: 0 },
      }),
      part(batteryId, "battery", worldPosition([10, 0, 0]), {
        orientation: rotation,
        storedEnergyWh: 100,
        config: {
          capacityWh: 100,
          maxOutputWatts: 20_000,
          dischargeEfficiency: 1,
        },
      }),
      part(controllerId, "computer", worldPosition([12, 0, 0]), {
        orientation: rotation,
        controllerBindings: [],
      }),
    ],
    connections = [
      {
        id: "basis-base-attachment",
        a: baseId,
        b: actuatorId,
        kind: "mechanical",
        portA: "TOP",
        portB: "BASE",
        anchorA: anchor,
        capacity: CAPACITY,
      },
      {
        id: "basis-target-attachment",
        a: actuatorId,
        b: targetId,
        kind: "mechanical",
        portA: "ROD",
        portB: "TOP",
        anchorB: anchor,
        capacity: CAPACITY,
      },
      ...(internalFixed
        ? [
            {
              id: "basis-internal-fixed",
              a: baseId,
              b: targetId,
              kind: "mechanical",
              portA: "TOP",
              portB: "TOP",
              anchorA: [0, 0, 0.55],
              anchorB: [0, 0, -0.55],
              capacity: CAPACITY,
            },
          ]
        : []),
      {
        id: "basis-power",
        a: batteryId,
        b: actuatorId,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      {
        id: "basis-controller-power",
        a: batteryId,
        b: controllerId,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
      {
        id: "basis-signal",
        a: controllerId,
        b: actuatorId,
        kind: "signal",
        portA: "OUT",
        portB: "CONTROL",
      },
    ],
    snapshot = { parts, connections },
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    adapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      catalog: TYPES,
      fixedDt: DT,
    });
  runtime.start(JSON.stringify(snapshot));
  let demands = [];
  const session = new SimulationSession({
    systems: [
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
      new MechanismSystem(),
      new RigidBodySystem(),
      new MotorEnergySettlementSystem(),
      new StructureSystem(),
      new TelemetrySystem(),
    ],
  }).start(snapshot, {
    world,
    worldAdapter: adapter,
    catalog: TYPES,
    multibodyRuntime: runtime,
    readCommandCandidates: () => ({
      remote: demands.map((demand) => ({
        targetId: demand.actuatorPartId,
        channel: "linear_force_n",
        value: demand.forceN,
        active: true,
      })),
      scripts: [],
    }),
  });
  if (integrate) session.stepFixed();
  const coordinator = new RuntimeCheckpointCoordinator({
    session,
    multibodyRuntime: runtime,
    worldAdapter: adapter,
  });
  return {
    runtime,
    session,
    coordinator,
    baseId,
    targetId,
    actuatorId,
    setDemands(value) {
      demands = value.map((entry) => ({ ...entry }));
    },
  };
}

const dormantWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  dormantAdapter = new CannonWorldAdapter(dormantWorld),
  dormantRuntime = new MultibodyRuntime({
    world: dormantWorld,
    worldAdapter: dormantAdapter,
    catalog: TYPES,
    fixedDt: DT,
  }),
  invokeDormant = (candidate) =>
    allocateAxialBodyWrench(dormantRuntime, JSON.stringify(candidate));
assert.throws(
  () => allocateAxialBodyWrench(dormantRuntime, request()),
  /serialized JSON or an issued inert data root/,
);
const requestRejections = [
  [{ ...request(), callerGeometry: {} }, /invalid field set/],
  [request({ targetWrenchPart: null }), /invalid field set/],
  [request({ targetWrenchPart: [] }), /invalid field set/],
  [request({ version: 2 }), /version must be 1/],
  [request({ observationTick: -1 }), /non-negative safe integer/],
  [
    request({
      targetWrenchPart: { forceN: [0, 0], momentNm: [0, 0, 0] },
    }),
    /finite three-vector/,
  ],
  [
    request({
      targetWrenchPart: {
        forceN: [0, Number.NaN, 0],
        momentNm: [0, 0, 0],
      },
    }),
    /finite three-vector/,
  ],
  [
    request({
      acceptance: {
        forceResidualToleranceN: -1,
        momentResidualToleranceNm: 0,
        momentReferenceLengthM: 1,
      },
    }),
    /finite number in range/,
  ],
  [
    request({
      acceptance: {
        forceResidualToleranceN: Number.NaN,
        momentResidualToleranceNm: 0,
        momentReferenceLengthM: 1,
      },
    }),
    /finite number in range/,
  ],
  [
    request({
      acceptance: {
        forceResidualToleranceN: 0,
        momentResidualToleranceNm: 0,
        momentReferenceLengthM: 0,
      },
    }),
    /finite number in range/,
  ],
  [
    request({ solver: { maxIterations: 0, projectedGradientToleranceN: 0 } }),
    /iteration budget is out of range/,
  ],
  [
    request({
      solver: { maxIterations: 1_000_001, projectedGradientToleranceN: 0 },
    }),
    /iteration budget is out of range/,
  ],
  [
    request({
      solver: { maxIterations: 1, projectedGradientToleranceN: -1 },
    }),
    /finite number in range/,
  ],
  [request({ actuators: null }), /requires 1-32 actuators/],
  [request({ actuators: [] }), /requires 1-32 actuators/],
  [
    request({
      actuators: Array.from({ length: 33 }, (_, index) => ({
        actuatorPartId: index,
        minimumForceN: -1,
        maximumForceN: 1,
      })),
    }),
    /requires 1-32 actuators/,
  ],
  [
    request({
      actuators: [
        {
          actuatorPartId: "axis",
          minimumForceN: -1,
          maximumForceN: 1,
          geometry: {},
        },
      ],
    }),
    /invalid field set/,
  ],
  [
    request({
      actuators: [
        { actuatorPartId: "axis", minimumForceN: 1, maximumForceN: 2 },
      ],
    }),
    /contain fail-safe zero/,
  ],
  [
    request({
      actuators: [
        { actuatorPartId: "axis", minimumForceN: -2, maximumForceN: -1 },
      ],
    }),
    /contain fail-safe zero/,
  ],
  [
    request({
      actuators: [
        {
          actuatorPartId: "axis",
          minimumForceN: -1_000_001,
          maximumForceN: 1,
        },
      ],
    }),
    /exceed the ordinary scalar command envelope/,
  ],
  [
    request({
      actuators: [
        {
          actuatorPartId: "axis",
          minimumForceN: -1,
          maximumForceN: 1_000_001,
        },
      ],
    }),
    /exceed the ordinary scalar command envelope/,
  ],
  [
    request({
      actuators: [
        { actuatorPartId: "axis", minimumForceN: -1, maximumForceN: 1 },
        { actuatorPartId: "axis", minimumForceN: -1, maximumForceN: 1 },
      ],
    }),
    /IDs must be unique/,
  ],
];
for (const [candidate, expected] of requestRejections)
  assert.throws(() => invokeDormant(candidate), expected);
const zeroOnlyDormant = invokeDormant(
  request({
    observationTick: 0,
    actuators: [{ actuatorPartId: "axis", minimumForceN: 0, maximumForceN: 0 }],
    solver: { maxIterations: 1_000_000, projectedGradientToleranceN: 0 },
  }),
);
assert.equal(zeroOnlyDormant.authorityReason, "runtime-not-started-v1");
const exactEnvelopeDormant = invokeDormant(
  request({
    actuators: [
      {
        actuatorPartId: "axis",
        minimumForceN: -1_000_000,
        maximumForceN: 1_000_000,
      },
    ],
  }),
);
assert.equal(exactEnvelopeDormant.authorityValid, false);
const maximumCountDormant = invokeDormant(
  request({
    actuators: Array.from({ length: 32 }, (_, index) => ({
      actuatorPartId: index,
      minimumForceN: -1,
      maximumForceN: 1,
    })),
  }),
);
assert.equal(maximumCountDormant.candidateEfforts.length, 32);
const sortedDormant = invokeDormant(
  request({
    actuators: [
      { actuatorPartId: "b", minimumForceN: -1, maximumForceN: 1 },
      {
        actuatorPartId: "at-minimum-tolerance",
        minimumForceN: -(2 ** -30 * 100),
        maximumForceN: 100,
      },
      { actuatorPartId: "a", minimumForceN: -1, maximumForceN: 1 },
    ],
  }),
);
assert.deepEqual(
  sortedDormant.candidateEfforts.map((entry) => entry.actuatorPartId),
  ["a", "at-minimum-tolerance", "b"],
);
assert.equal(sortedDormant.candidateEfforts[0].saturated, false);
assert.equal(sortedDormant.candidateEfforts[1].atMinimum, true);
assert.equal(sortedDormant.candidateEfforts[1].atMaximum, false);
assert.equal(sortedDormant.saturated, true);
const maximumToleranceDormant = invokeDormant(
  request({
    actuators: [
      {
        actuatorPartId: "at-maximum-tolerance",
        minimumForceN: -1,
        maximumForceN: 2 ** -30,
      },
    ],
  }),
);
assert.equal(maximumToleranceDormant.candidateEfforts[0].atMinimum, false);
assert.equal(maximumToleranceDormant.candidateEfforts[0].atMaximum, true);
const dormantResult = allocateAxialBodyWrench(
  dormantRuntime,
  JSON.stringify(request({ observationTick: 0 })),
);
assert.equal(dormantResult.authorityValid, false);
assert.equal(dormantResult.authorityReason, "runtime-not-started-v1");
dormantRuntime.dispose();

const noConstraintWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0),
  }),
  noConstraintAdapter = new CannonWorldAdapter(noConstraintWorld),
  noConstraintRuntime = new MultibodyRuntime({
    world: noConstraintWorld,
    worldAdapter: noConstraintAdapter,
    catalog: TYPES,
    fixedDt: DT,
  });
noConstraintRuntime.start(
  JSON.stringify({
    parts: [
      part("generic-gear-small", "gear12", [0, 0, 0]),
      part("generic-gear-large", "gear24", [1.23, 0, 0]),
    ],
    connections: [
      {
        id: "generic-gear-mesh",
        a: "generic-gear-small",
        b: "generic-gear-large",
        kind: "mesh",
        portA: "MESH",
        portB: "MESH",
        capacity: CAPACITY,
      },
    ],
  }),
);
const noConstraintEntry = noConstraintRuntime.constraintEntries.find(
  (entry) => entry.descriptor.kind === "gear",
);
assert.equal(noConstraintEntry?.kind, "gear");
assert.equal(Object.hasOwn(noConstraintEntry, "constraint"), false);
noConstraintRuntime.dispose();

const unintegratedFixture = runtimeFixture({ integrate: false }),
  unintegratedResult = allocateAxialBodyWrench(
    unintegratedFixture.runtime,
    JSON.stringify({
      ...request({
        observationTick: 0,
        targetPartId: unintegratedFixture.targetId,
        actuators: [
          {
            actuatorPartId: unintegratedFixture.actuatorId,
            minimumForceN: -1_000,
            maximumForceN: 1_000,
          },
        ],
      }),
    }),
  );
assert.equal(unintegratedResult.authorityValid, false);
assert.equal(unintegratedResult.authorityReason, "no-completed-integration-v1");
const savedUnintegratedAdapter = unintegratedFixture.runtime.worldAdapter;
unintegratedFixture.runtime.worldAdapter = null;
const missingAdapterResult = allocateAxialBodyWrench(
  unintegratedFixture.runtime,
  JSON.stringify({
    ...request({
      observationTick: 0,
      targetPartId: unintegratedFixture.targetId,
      actuators: [
        {
          actuatorPartId: unintegratedFixture.actuatorId,
          minimumForceN: -1_000,
          maximumForceN: 1_000,
        },
      ],
    }),
  }),
);
assert.equal(missingAdapterResult.authorityValid, false);
assert.equal(
  missingAdapterResult.authorityReason,
  "no-completed-integration-v1",
);
unintegratedFixture.runtime.worldAdapter = savedUnintegratedAdapter;
unintegratedFixture.session.dispose();
unintegratedFixture.runtime.dispose();

const unsupportedFixture = runtimeFixture({ forceCommand: false }),
  unsupportedResult = allocateAxialBodyWrench(
    unsupportedFixture.runtime,
    JSON.stringify({
      ...request({
        observationTick: 1,
        targetPartId: unsupportedFixture.targetId,
        actuators: [
          {
            actuatorPartId: unsupportedFixture.actuatorId,
            minimumForceN: -1_000,
            maximumForceN: 1_000,
          },
        ],
      }),
    }),
  );
assert.equal(unsupportedResult.authorityValid, false);
assert.equal(unsupportedResult.authorityReason, "unsupported-actuator-v1");
unsupportedFixture.session.dispose();
unsupportedFixture.runtime.dispose();

const inactiveFixture = runtimeFixture(),
  inactiveEntry = inactiveFixture.runtime.constraintEntries.find(
    (entry) => entry.descriptor.sourcePartId === inactiveFixture.actuatorId,
  );
inactiveFixture.runtime.applyConnectionFailures([
  { id: inactiveEntry.descriptor.sourceConnectionIds[0], failed: true },
]);
const inactiveResult = allocateAxialBodyWrench(
  inactiveFixture.runtime,
  JSON.stringify({
    ...request({
      observationTick: 1,
      targetPartId: inactiveFixture.targetId,
      targetWrenchPart: { forceN: [0, 0, 0], momentNm: [0, 0, 0] },
      actuators: [
        {
          actuatorPartId: inactiveFixture.actuatorId,
          minimumForceN: -1_000,
          maximumForceN: 1_000,
        },
      ],
    }),
  }),
);
assert.equal(inactiveResult.authorityValid, false);
assert.equal(inactiveResult.authorityReason, "inactive-actuator-v1");
assert.equal(inactiveResult.effortDemands[0].forceN, 0);
inactiveFixture.session.dispose();
inactiveFixture.runtime.dispose();

const internalFixture = runtimeFixture({ internalFixed: true }),
  internalResult = allocateAxialBodyWrench(
    internalFixture.runtime,
    JSON.stringify({
      ...request({
        observationTick: 1,
        targetPartId: internalFixture.targetId,
        actuators: [
          {
            actuatorPartId: internalFixture.actuatorId,
            minimumForceN: -1_000,
            maximumForceN: 1_000,
          },
        ],
      }),
    }),
  );
assert.equal(
  internalResult.authorityValid,
  false,
  JSON.stringify({
    internalResult,
    diagnostics: internalFixture.runtime.compiled.diagnostics,
    constraints: internalFixture.runtime.constraintEntries.map((entry) => ({
      kind: entry.kind,
      descriptorKind: entry.descriptor.kind,
      a: entry.descriptor.a,
      b: entry.descriptor.b,
      sourceConnectionIds: entry.descriptor.sourceConnectionIds,
    })),
  }),
);
assert.equal(internalResult.authorityReason, "internal-actuator-v1");
assert.equal(internalResult.effortDemands[0].forceN, 0);
internalFixture.session.dispose();
internalFixture.runtime.dispose();

const authorityFalsifierFixture = runtimeFixture(),
  authorityFalsifierEntry =
    authorityFalsifierFixture.runtime.constraintEntries.find(
      (entry) =>
        entry.descriptor.sourcePartId === authorityFalsifierFixture.actuatorId,
    ),
  authorityFalsifierRequest = () =>
    JSON.stringify({
      ...request({
        observationTick: 1,
        targetPartId: authorityFalsifierFixture.targetId,
        targetWrenchPart: {
          forceN: [0, 0, 120],
          momentNm: [0, -48, 0],
        },
        actuators: [
          {
            actuatorPartId: authorityFalsifierFixture.actuatorId,
            minimumForceN: -1_000,
            maximumForceN: 1_000,
          },
        ],
      }),
    });

const savedEntryKind = authorityFalsifierEntry.kind;
authorityFalsifierEntry.kind = "not-an-axial-actuator";
const wrongEntryKind = allocateAxialBodyWrench(
  authorityFalsifierFixture.runtime,
  authorityFalsifierRequest(),
);
assert.equal(wrongEntryKind.authorityValid, false);
assert.equal(
  wrongEntryKind.authorityReason,
  "missing-or-ambiguous-actuator-v1",
);
authorityFalsifierEntry.kind = savedEntryKind;

const savedEffortEquation = authorityFalsifierEntry.constraint.effortEquation;
for (const forgedEffortEquation of [null, {}]) {
  authorityFalsifierEntry.constraint.effortEquation = forgedEffortEquation;
  assert.throws(
    () =>
      allocateAxialBodyWrench(
        authorityFalsifierFixture.runtime,
        authorityFalsifierRequest(),
      ),
    (error) =>
      error instanceof DomainValidationError &&
      error.code === "MULTIBODY_LIVE_ENGINE_AUTHORITY_MISMATCH",
  );
}
authorityFalsifierEntry.constraint.effortEquation = savedEffortEquation;

const falsifierTargetBody = authorityFalsifierFixture.runtime.bodyByPart.get(
    authorityFalsifierFixture.targetId,
  ),
  savedTargetPositionX = falsifierTargetBody.position.x;
falsifierTargetBody.position.x = Number.NaN;
const invalidTargetFrame = allocateAxialBodyWrench(
  authorityFalsifierFixture.runtime,
  authorityFalsifierRequest(),
);
assert.equal(invalidTargetFrame.authorityValid, false);
assert.equal(invalidTargetFrame.authorityReason, "invalid-target-frame-v1");
falsifierTargetBody.position.x = savedTargetPositionX;

const falsifierBaseBody = authorityFalsifierFixture.runtime.bodyByPart.get(
    authorityFalsifierFixture.baseId,
  ),
  savedGetVelocityAtWorldPoint = falsifierBaseBody.getVelocityAtWorldPoint;
for (const expectedError of [
  new Error("unexpected axial-state failure"),
  new DomainValidationError(
    "UNEXPECTED_AXIAL_STATE_DOMAIN",
    "unexpected axial-state domain failure",
  ),
]) {
  falsifierBaseBody.getVelocityAtWorldPoint = () => {
    throw expectedError;
  };
  assert.throws(
    () =>
      allocateAxialBodyWrench(
        authorityFalsifierFixture.runtime,
        authorityFalsifierRequest(),
      ),
    (error) => error === expectedError,
  );
}
falsifierBaseBody.getVelocityAtWorldPoint = savedGetVelocityAtWorldPoint;
const savedBaseVelocityX = falsifierBaseBody.velocity.x;
falsifierBaseBody.velocity.x = Number.NaN;
const invalidRuntimeGeometry = allocateAxialBodyWrench(
  authorityFalsifierFixture.runtime,
  authorityFalsifierRequest(),
);
assert.equal(invalidRuntimeGeometry.authorityValid, false);
assert.equal(
  invalidRuntimeGeometry.authorityReason,
  "invalid-runtime-geometry-v1",
);
falsifierBaseBody.velocity.x = savedBaseVelocityX;
authorityFalsifierFixture.session.dispose();
authorityFalsifierFixture.runtime.dispose();

const fixture = runtimeFixture(),
  fixtureTargetBody = fixture.runtime.bodyByPart.get(fixture.targetId),
  fixtureActuatorEntry = fixture.runtime.constraintEntries.find(
    (entry) => entry.descriptor.sourcePartId === fixture.actuatorId,
  ),
  fixtureMassFrame = fixtureTargetBody.userData.massFrame,
  fixtureMassFrameEvidence = {
    comPart: [
      fixtureMassFrame.comPart.x,
      fixtureMassFrame.comPart.y,
      fixtureMassFrame.comPart.z,
    ],
    principalToPart: [
      fixtureMassFrame.principalToPart.x,
      fixtureMassFrame.principalToPart.y,
      fixtureMassFrame.principalToPart.z,
      fixtureMassFrame.principalToPart.w,
    ],
    localAnchorB: [
      fixtureActuatorEntry.localAnchorB.x,
      fixtureActuatorEntry.localAnchorB.y,
      fixtureActuatorEntry.localAnchorB.z,
    ],
  },
  liveRequest = (
    targetPartId,
    targetWrenchPart,
    observationTick = 1,
    maximumForceN = 1_000,
  ) =>
    JSON.stringify({
      ...request({
        observationTick,
        targetPartId,
        targetWrenchPart,
        actuators: [
          {
            actuatorPartId: fixture.actuatorId,
            minimumForceN: -maximumForceN,
            maximumForceN,
          },
        ],
      }),
    }),
  targetResult = allocateAxialBodyWrench(
    fixture.runtime,
    liveRequest(fixture.targetId, {
      forceN: [0, 0, 120],
      momentNm: [0, -48, 0],
    }),
  );
assert.ok(
  norm(fixtureMassFrameEvidence.comPart) > 1e-3,
  JSON.stringify(fixtureMassFrameEvidence),
);
assert.ok(
  norm(subtract(fixtureMassFrameEvidence.localAnchorB, [0.4, 0, 0])) > 1e-3,
  JSON.stringify(fixtureMassFrameEvidence),
);
assert.ok(
  norm(fixtureMassFrameEvidence.principalToPart.slice(0, 3)) > 1e-3,
  JSON.stringify(fixtureMassFrameEvidence),
);
const reconstructedTargetAnchor = fixtureMassFrame.principalToPart
  .vmult(fixtureActuatorEntry.localAnchorB)
  .vadd(fixtureMassFrame.comPart);
for (let axis = 0; axis < 3; axis++)
  assert.ok(
    near(
      [
        reconstructedTargetAnchor.x,
        reconstructedTargetAnchor.y,
        reconstructedTargetAnchor.z,
      ][axis],
      [0.4, 0, 0][axis],
    ),
    JSON.stringify(fixtureMassFrameEvidence),
  );
assert.equal(
  targetResult.accepted,
  true,
  JSON.stringify({
    targetResult,
    diagnostics: fixture.runtime.compiled.diagnostics,
    entries: fixture.runtime.constraintEntries.map((entry) => ({
      kind: entry.kind,
      descriptorKind: entry.descriptor.kind,
      sourcePartId: entry.descriptor.sourcePartId,
      a: entry.descriptor.a,
      b: entry.descriptor.b,
      active: entry.active,
    })),
  }),
);
assert.equal(targetResult.basis[0].targetEndpoint, "B");
assert.deepEqual(targetResult.basis[0].applicationPointPartM, [0.4, 0, 0]);
assert.ok(near(targetResult.basis[0].forcePerNewtonPart[2], 1));
assert.ok(near(targetResult.basis[0].momentPerNewtonPart[1], -0.4));
assert.ok(near(targetResult.effortDemands[0].forceN, 120));
assert.equal(targetResult.achievedWrenchPart.forceN.length, 3);
assert.equal(targetResult.achievedWrenchPart.momentNm.length, 3);
assert.equal(targetResult.candidateEfforts[0].atMinimum, false);
assert.equal(targetResult.candidateEfforts[0].atMaximum, false);
assert.equal(targetResult.candidateEfforts[0].saturated, false);
assert.equal(targetResult.saturated, false);

const singleAllocation = ({
  targetWrenchPart,
  minimumForceN = -1_000,
  maximumForceN = 1_000,
  acceptance = {
    forceResidualToleranceN: 1e-7,
    momentResidualToleranceNm: 1e-7,
    momentReferenceLengthM: 1,
  },
  solver = { maxIterations: 64, projectedGradientToleranceN: 1e-8 },
}) =>
  allocateAxialBodyWrench(
    fixture.runtime,
    JSON.stringify(
      request({
        observationTick: 1,
        targetPartId: fixture.targetId,
        targetWrenchPart,
        actuators: [
          {
            actuatorPartId: fixture.actuatorId,
            minimumForceN,
            maximumForceN,
          },
        ],
        acceptance,
        solver,
      }),
    ),
  );
const zeroAllocation = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, 0], momentNm: [0, 0, 0] },
});
assert.equal(zeroAllocation.accepted, true);
assert.equal(zeroAllocation.effortDemands[0].forceN, 0);

const maximumSaturation = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, 200], momentNm: [0, -80, 0] },
  minimumForceN: -100,
  maximumForceN: 100,
});
assert.equal(maximumSaturation.solverConverged, true);
assert.equal(maximumSaturation.accepted, false);
assert.equal(maximumSaturation.reason, "residual-tolerance-exceeded-v1");
assert.equal(maximumSaturation.candidateEfforts[0].forceN, 100);
assert.equal(maximumSaturation.candidateEfforts[0].atMaximum, true);
assert.equal(maximumSaturation.saturated, true);
assert.equal(maximumSaturation.effortDemands[0].forceN, 0);

const minimumSaturation = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, -200], momentNm: [0, 80, 0] },
  minimumForceN: -100,
  maximumForceN: 100,
});
assert.equal(minimumSaturation.candidateEfforts[0].forceN, -100);
assert.equal(minimumSaturation.candidateEfforts[0].atMinimum, true);
assert.equal(minimumSaturation.effortDemands[0].forceN, 0);

const exhaustedAllocation = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, 120], momentNm: [0, -48, 0] },
  solver: { maxIterations: 1, projectedGradientToleranceN: 0 },
});
assert.equal(exhaustedAllocation.solverConverged, false);
assert.equal(exhaustedAllocation.accepted, false);
assert.equal(exhaustedAllocation.reason, "solver-budget-exhausted-v1");
assert.equal(exhaustedAllocation.iterations, 1);
assert.ok(exhaustedAllocation.candidateEfforts[0].forceN > 0);
assert.equal(exhaustedAllocation.effortDemands[0].forceN, 0);

const unreachableAllocation = singleAllocation({
  targetWrenchPart: { forceN: [5, 0, 0], momentNm: [0, 0, 0] },
});
assert.equal(unreachableAllocation.solverConverged, true);
assert.equal(unreachableAllocation.accepted, false);
assert.equal(unreachableAllocation.reason, "residual-tolerance-exceeded-v1");
assert.ok(near(unreachableAllocation.residualWrenchPart.forceNormN, 5));

const exactForceTolerance = singleAllocation({
  targetWrenchPart: { forceN: [5, 0, 0], momentNm: [0, 0, 0] },
  acceptance: {
    forceResidualToleranceN: 5,
    momentResidualToleranceNm: 0,
    momentReferenceLengthM: 1,
  },
});
assert.equal(exactForceTolerance.accepted, true);
const exactMomentTolerance = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, 0], momentNm: [5, 0, 0] },
  acceptance: {
    forceResidualToleranceN: 0,
    momentResidualToleranceNm: 5,
    momentReferenceLengthM: 1,
  },
});
assert.equal(exactMomentTolerance.accepted, true);
const momentOnlyRejection = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, 0], momentNm: [5, 0, 0] },
  acceptance: {
    forceResidualToleranceN: 0,
    momentResidualToleranceNm: 4,
    momentReferenceLengthM: 1,
  },
});
assert.equal(momentOnlyRejection.solverConverged, true);
assert.equal(momentOnlyRejection.accepted, false);

const conditionedAllocation = singleAllocation({
  targetWrenchPart: { forceN: [0, 0, 100], momentNm: [0, -20, 0] },
  acceptance: {
    forceResidualToleranceN: 100,
    momentResidualToleranceNm: 100,
    momentReferenceLengthM: 2,
  },
});
assert.ok(
  near(conditionedAllocation.candidateEfforts[0].forceN, 98.07692307692308),
  JSON.stringify(conditionedAllocation),
);
const extremeMomentConditioning = singleAllocation({
  targetWrenchPart: {
    forceN: [0, 0, 0],
    momentNm: [0, 0, Number.MAX_VALUE],
  },
  minimumForceN: -1,
  maximumForceN: 1,
  acceptance: {
    forceResidualToleranceN: Number.MAX_VALUE,
    momentResidualToleranceNm: Number.MAX_VALUE,
    momentReferenceLengthM: Number.MAX_VALUE,
  },
  solver: { maxIterations: 4, projectedGradientToleranceN: 1 },
});
assert.equal(extremeMomentConditioning.accepted, true);

const awkwardBound = 421_438.92448770045,
  awkwardUpper = singleAllocation({
    targetWrenchPart: {
      forceN: [0, 0, awkwardBound],
      momentNm: [0, -0.4 * awkwardBound, 0],
    },
    minimumForceN: -awkwardBound,
    maximumForceN: awkwardBound,
    acceptance: {
      forceResidualToleranceN: 1e-7,
      momentResidualToleranceNm: 1e-7,
      momentReferenceLengthM: 1,
    },
    solver: { maxIterations: 64, projectedGradientToleranceN: 0 },
  }),
  awkwardLower = singleAllocation({
    targetWrenchPart: {
      forceN: [0, 0, -awkwardBound],
      momentNm: [0, 0.4 * awkwardBound, 0],
    },
    minimumForceN: -awkwardBound,
    maximumForceN: awkwardBound,
    acceptance: {
      forceResidualToleranceN: 1e-7,
      momentResidualToleranceNm: 1e-7,
      momentReferenceLengthM: 1,
    },
    solver: { maxIterations: 64, projectedGradientToleranceN: 0 },
  });
assert.equal(awkwardUpper.accepted, true, JSON.stringify(awkwardUpper));
assert.ok(awkwardUpper.effortDemands[0].forceN <= awkwardBound);
assert.equal(awkwardUpper.candidateEfforts[0].atMaximum, true);
assert.equal(awkwardLower.accepted, true, JSON.stringify(awkwardLower));
assert.ok(awkwardLower.effortDemands[0].forceN >= -awkwardBound);
assert.equal(awkwardLower.candidateEfforts[0].atMinimum, true);

assert.throws(
  () =>
    singleAllocation({
      targetWrenchPart: {
        forceN: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
        momentNm: [0, 0, 0],
      },
    }),
  /allocation exceeds finite numerical range/,
);

const baseResult = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest(fixture.baseId, {
    forceN: [0, 0, -120],
    momentNm: [0, 48, 0],
  }),
);
assert.equal(baseResult.accepted, true, JSON.stringify(baseResult));
assert.equal(baseResult.basis[0].targetEndpoint, "A");
assert.ok(near(baseResult.basis[0].forcePerNewtonPart[2], -1));
assert.ok(near(baseResult.basis[0].momentPerNewtonPart[1], 0.4));
assert.ok(near(baseResult.effortDemands[0].forceN, 120));

const virtualVelocityA = [0.3, -0.2, 0.5],
  virtualAngularA = [0.1, 0.4, -0.3],
  virtualVelocityB = [-0.2, 0.6, -0.1],
  virtualAngularB = [-0.5, 0.2, 0.3],
  anchorA = baseResult.basis[0].applicationPointPartM,
  anchorB = targetResult.basis[0].applicationPointPartM,
  anchorVelocityA = add(virtualVelocityA, cross(virtualAngularA, anchorA)),
  anchorVelocityB = add(virtualVelocityB, cross(virtualAngularB, anchorB)),
  targetWrenchPower =
    dot(targetResult.basis[0].forcePerNewtonPart, virtualVelocityB) +
    dot(targetResult.basis[0].momentPerNewtonPart, virtualAngularB),
  baseWrenchPower =
    dot(baseResult.basis[0].forcePerNewtonPart, virtualVelocityA) +
    dot(baseResult.basis[0].momentPerNewtonPart, virtualAngularA),
  endpointPower =
    dot(targetResult.basis[0].forcePerNewtonPart, anchorVelocityB) +
    dot(baseResult.basis[0].forcePerNewtonPart, anchorVelocityA),
  virtualCoordinateRate = anchorVelocityB[2] - anchorVelocityA[2];
assert.ok(
  near(
    targetWrenchPower,
    dot(targetResult.basis[0].forcePerNewtonPart, anchorVelocityB),
  ),
);
assert.ok(
  near(
    baseWrenchPower,
    dot(baseResult.basis[0].forcePerNewtonPart, anchorVelocityA),
  ),
);
assert.ok(near(endpointPower, virtualCoordinateRate));

const stale = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest(
    fixture.targetId,
    { forceN: [0, 0, 120], momentNm: [0, -48, 0] },
    0,
  ),
);
assert.equal(stale.authorityValid, false);
assert.equal(stale.authorityReason, "stale-observation-tick-v1");
assert.equal(stale.effortDemands[0].forceN, 0);

const missingTarget = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest("missing-target", {
    forceN: [0, 0, 0],
    momentNm: [0, 0, 0],
  }),
);
assert.equal(missingTarget.authorityValid, false);
assert.equal(missingTarget.authorityReason, "missing-target-body-v1");
assert.equal(missingTarget.effortDemands[0].forceN, 0);

const ghostActuator = allocateAxialBodyWrench(
  fixture.runtime,
  JSON.stringify({
    ...request({
      observationTick: 1,
      targetPartId: fixture.targetId,
      actuators: [
        { actuatorPartId: 999, minimumForceN: -100, maximumForceN: 100 },
      ],
    }),
  }),
);
assert.equal(ghostActuator.authorityValid, false);
assert.equal(ghostActuator.authorityReason, "missing-or-ambiguous-actuator-v1");
assert.equal(ghostActuator.effortDemands[0].forceN, 0);

const actuatorEntry = fixture.runtime.constraintEntries.find(
  (entry) => entry.descriptor.sourcePartId === fixture.actuatorId,
);
const baseBody = fixture.runtime.bodyByPart.get(fixture.baseId),
  targetBodyForDegenerateProbe = fixture.runtime.bodyByPart.get(
    fixture.targetId,
  ),
  savedTargetPosition = targetBodyForDegenerateProbe.position.clone(),
  worldAnchorA = baseBody.pointToWorldFrame(actuatorEntry.localAnchorA),
  worldAnchorB = targetBodyForDegenerateProbe.pointToWorldFrame(
    actuatorEntry.localAnchorB,
  );
targetBodyForDegenerateProbe.position.vadd(
  worldAnchorA.vsub(worldAnchorB),
  targetBodyForDegenerateProbe.position,
);
const degenerateAxis = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest(fixture.targetId, {
    forceN: [0, 0, 0],
    momentNm: [0, 0, 0],
  }),
);
assert.equal(degenerateAxis.authorityValid, false);
assert.equal(degenerateAxis.authorityReason, "degenerate-actuator-axis-v1");
assert.equal(degenerateAxis.effortDemands[0].forceN, 0);
targetBodyForDegenerateProbe.position.copy(savedTargetPosition);

const wrongTarget = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest("basis-battery", {
    forceN: [0, 0, 0],
    momentNm: [0, 0, 0],
  }),
);
assert.equal(wrongTarget.authorityValid, false);
assert.equal(wrongTarget.authorityReason, "target-not-exactly-one-endpoint-v1");
assert.equal(wrongTarget.effortDemands[0].forceN, 0);

const fixtureCheckpoint = fixture.coordinator.capture(
  JSON.stringify(CHECKPOINT_IDENTITIES),
);

const excessiveSingle = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest(
    fixture.targetId,
    { forceN: [0, 0, 10_000], momentNm: [0, -4_000, 0] },
    1,
    15_000,
  ),
);
assert.equal(excessiveSingle.accepted, true, JSON.stringify(excessiveSingle));
const physicalTargetBody = fixture.runtime.bodyByPart.get(fixture.targetId),
  physicalBaseBody = fixture.runtime.bodyByPart.get(fixture.baseId),
  physicalTargetVelocityBefore = [
    physicalTargetBody.velocity.x,
    physicalTargetBody.velocity.y,
    physicalTargetBody.velocity.z,
  ],
  physicalBaseVelocityBefore = [
    physicalBaseBody.velocity.x,
    physicalBaseBody.velocity.y,
    physicalBaseBody.velocity.z,
  ],
  physicalTargetAngularBefore = [
    physicalTargetBody.angularVelocity.x,
    physicalTargetBody.angularVelocity.y,
    physicalTargetBody.angularVelocity.z,
  ],
  physicalAngularMomentumBefore = add(
    bodyAngularMomentumWorld(physicalTargetBody),
    bodyAngularMomentumWorld(physicalBaseBody),
  ),
  physicalInvInertiaWorldBefore = new CANNON.Mat3([
    ...physicalTargetBody.invInertiaWorld.elements,
  ]);
fixture.setDemands(excessiveSingle.effortDemands);
fixture.session.stepFixed();
const excessiveSingleState = fixture.session
    .telemetry()
    .systems.mechanisms.twoFrameMechanisms.find(
      (state) => state.sourcePartId === fixture.actuatorId,
    ),
  excessiveSingleActual = wrenchFromBasis(excessiveSingle.basis, [
    excessiveSingleState.appliedForceN,
  ]),
  excessiveSingleResidual = [
    ...subtract(
      excessiveSingle.targetWrenchPart.forceN,
      excessiveSingleActual.forceN,
    ),
    ...subtract(
      excessiveSingle.targetWrenchPart.momentNm,
      excessiveSingleActual.momentNm,
    ),
  ],
  physicalTargetVelocityAfter = [
    physicalTargetBody.velocity.x,
    physicalTargetBody.velocity.y,
    physicalTargetBody.velocity.z,
  ],
  physicalBaseVelocityAfter = [
    physicalBaseBody.velocity.x,
    physicalBaseBody.velocity.y,
    physicalBaseBody.velocity.z,
  ],
  physicalTargetAngularAfter = [
    physicalTargetBody.angularVelocity.x,
    physicalTargetBody.angularVelocity.y,
    physicalTargetBody.angularVelocity.z,
  ],
  physicalAngularMomentumAfter = add(
    bodyAngularMomentumWorld(physicalTargetBody),
    bodyAngularMomentumWorld(physicalBaseBody),
  ),
  physicalTargetMomentumDelta = scale(
    subtract(physicalTargetVelocityAfter, physicalTargetVelocityBefore),
    physicalTargetBody.mass,
  ),
  physicalBaseMomentumDelta = scale(
    subtract(physicalBaseVelocityAfter, physicalBaseVelocityBefore),
    physicalBaseBody.mass,
  ),
  physicalFrameQuaternion =
    excessiveSingle.targetFrameWorld.quaternionWorldFromPart,
  physicalForceWorld = rotate(
    excessiveSingleActual.forceN,
    physicalFrameQuaternion,
  ),
  physicalComPart = fixtureMassFrameEvidence.comPart,
  physicalTorqueAtComWorld = rotate(
    subtract(
      excessiveSingleActual.momentNm,
      cross(physicalComPart, excessiveSingleActual.forceN),
    ),
    physicalFrameQuaternion,
  ),
  physicalExpectedAngularDeltaVector = physicalInvInertiaWorldBefore.vmult(
    new CANNON.Vec3(...scale(physicalTorqueAtComWorld, DT)),
  ),
  physicalExpectedAngularDelta = [
    physicalExpectedAngularDeltaVector.x,
    physicalExpectedAngularDeltaVector.y,
    physicalExpectedAngularDeltaVector.z,
  ],
  physicalActualAngularDelta = subtract(
    physicalTargetAngularAfter,
    physicalTargetAngularBefore,
  );
assert.equal(excessiveSingleState.requestedForceN, 10_000);
assert.ok(excessiveSingleState.appliedForceN < 10_000);
assert.ok(norm(excessiveSingleResidual) > 1);
for (let axis = 0; axis < 3; axis++) {
  assert.ok(
    near(
      physicalTargetMomentumDelta[axis],
      physicalForceWorld[axis] * DT,
      1e-6,
    ),
  );
  assert.ok(
    near(
      physicalTargetMomentumDelta[axis] + physicalBaseMomentumDelta[axis],
      0,
      1e-6,
    ),
  );
  assert.ok(
    near(
      physicalActualAngularDelta[axis],
      physicalExpectedAngularDelta[axis],
      1e-5,
    ),
  );
  assert.ok(
    near(
      physicalAngularMomentumAfter[axis],
      physicalAngularMomentumBefore[axis],
      1e-5,
    ),
  );
}
assert.ok(norm(physicalActualAngularDelta) > 0);
fixture.coordinator.restore(
  JSON.stringify(fixtureCheckpoint),
  JSON.stringify(CHECKPOINT_IDENTITIES),
);
const restoredResult = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest(fixture.targetId, {
    forceN: [0, 0, 120],
    momentNm: [0, -48, 0],
  }),
);
assert.deepEqual(restoredResult, targetResult);
const futureAfterRestore = allocateAxialBodyWrench(
  fixture.runtime,
  liveRequest(
    fixture.targetId,
    { forceN: [0, 0, 120], momentNm: [0, -48, 0] },
    2,
  ),
);
assert.equal(futureAfterRestore.authorityValid, false);
assert.equal(futureAfterRestore.authorityReason, "stale-observation-tick-v1");
assert.equal(futureAfterRestore.effortDemands[0].forceN, 0);

fixture.session.dispose();
fixture.runtime.dispose();

const covarianceAxis = scale([0.3, -0.4, 0.5], 1 / norm([0.3, -0.4, 0.5])),
  covarianceHalfAngle = 0.73 / 2,
  covarianceRotation = [
    ...scale(covarianceAxis, Math.sin(covarianceHalfAngle)),
    Math.cos(covarianceHalfAngle),
  ],
  covariantFixture = runtimeFixture({
    translation: [9_000_000, -8_000_000, 7_000_000],
    rotation: covarianceRotation,
  }),
  covariantResult = allocateAxialBodyWrench(
    covariantFixture.runtime,
    JSON.stringify({
      ...request({
        observationTick: 1,
        targetPartId: covariantFixture.targetId,
        targetWrenchPart: {
          forceN: [0, 0, 120],
          momentNm: [0, -48, 0],
        },
        actuators: [
          {
            actuatorPartId: covariantFixture.actuatorId,
            minimumForceN: -1_000,
            maximumForceN: 1_000,
          },
        ],
        acceptance: {
          forceResidualToleranceN: 1e-6,
          momentResidualToleranceNm: 1e-6,
          momentReferenceLengthM: 1,
        },
      }),
    }),
  );
assert.equal(covariantResult.accepted, true, JSON.stringify(covariantResult));
assert.ok(
  near(
    covariantResult.effortDemands[0].forceN,
    targetResult.effortDemands[0].forceN,
  ),
);
for (const field of [
  "applicationPointPartM",
  "forcePerNewtonPart",
  "momentPerNewtonPart",
])
  for (let axis = 0; axis < 3; axis++)
    assert.ok(
      near(
        covariantResult.basis[0][field][axis],
        targetResult.basis[0][field][axis],
      ),
    );
covariantFixture.session.dispose();
covariantFixture.runtime.dispose();

function quaternionFromPositiveZ(axis) {
  const raw = [-axis[1], axis[0], 0, 1 + axis[2]],
    magnitude = norm(raw);
  return raw.map((entry) => entry / magnitude);
}

function determinant(matrix) {
  const working = matrix.map((row) => [...row]);
  let result = 1;
  for (let columnIndex = 0; columnIndex < working.length; columnIndex++) {
    let pivotIndex = columnIndex;
    for (let row = columnIndex + 1; row < working.length; row++)
      if (
        Math.abs(working[row][columnIndex]) >
        Math.abs(working[pivotIndex][columnIndex])
      )
        pivotIndex = row;
    if (Math.abs(working[pivotIndex][columnIndex]) < 1e-12) return 0;
    if (pivotIndex !== columnIndex) {
      [working[pivotIndex], working[columnIndex]] = [
        working[columnIndex],
        working[pivotIndex],
      ];
      result *= -1;
    }
    const pivot = working[columnIndex][columnIndex];
    result *= pivot;
    for (let row = columnIndex + 1; row < working.length; row++) {
      const factor = working[row][columnIndex] / pivot;
      for (let index = columnIndex + 1; index < working.length; index++)
        working[row][index] -= factor * working[columnIndex][index];
    }
  }
  return result;
}

const parallelLegs = [
  {
    target: [-0.09316975846886633, 0, 0.18549336679279804],
    base: [0.6398830717402143, 0, 0.36614094668928326],
  },
  {
    target: [-0.17336581684648988, 0, -0.15857764706015587],
    base: [0.0484326969985166, 0, 0.5630908497277713],
  },
  {
    target: [-0.33911198526620867, 0, -0.7995664793998003],
    base: [-1.0569016068097796, 0, -0.5655193490940917],
  },
  {
    target: [-0.26196172647178173, 0, 0.13495331406593325],
    base: [-0.3105930565092085, 0, -0.6184622377637267],
  },
  {
    target: [-0.004854988306760788, 0, 0.7282974455505611],
    base: [0.7311646016956439, 0, 0.560145243267355],
  },
  {
    target: [0.6610926460474731, 0, -0.7856290735304357],
    base: [-0.05389015923625995, 0, -1.0281153373653251],
  },
];

function parallelFixture() {
  const baseId = "parallel-base",
    targetId = "parallel-target",
    batteryId = "parallel-battery",
    controllerId = "parallel-controller",
    actuatorIds = parallelLegs.map((_, index) => 100 + index),
    basePosition = [0, -0.4, 0],
    targetPosition = [0, 0.4, 0],
    actuators = parallelLegs.map((leg, index) => {
      const baseWorld = add(basePosition, leg.base),
        targetWorld = add(targetPosition, leg.target),
        difference = subtract(targetWorld, baseWorld),
        length = norm(difference),
        axis = scale(difference, 1 / length),
        midpoint = scale(add(baseWorld, targetWorld), 0.5);
      assert.ok(near(length, 1.1, 1e-12));
      return part(actuatorIds[index], "linear-actuator", midpoint, {
        orientation: quaternionFromPositiveZ(axis),
        mechanism: forceMechanism(),
      });
    }),
    parts = [
      part(baseId, "plate", basePosition, {
        config: { linearDamping: 0, angularDamping: 0 },
      }),
      ...actuators,
      part(targetId, "plate", targetPosition, {
        config: { linearDamping: 0, angularDamping: 0 },
      }),
      part(batteryId, "battery", [10, 0, 0], {
        storedEnergyWh: 1_000,
        config: {
          capacityWh: 1_000,
          maxOutputWatts: 200_000,
          dischargeEfficiency: 1,
        },
      }),
      part(controllerId, "computer", [12, 0, 0], {
        controllerBindings: [],
      }),
    ],
    connections = [
      ...parallelLegs.flatMap((leg, index) => {
        const actuatorId = actuatorIds[index];
        return [
          {
            id: `parallel-base-${index}`,
            a: baseId,
            b: actuatorId,
            kind: "mechanical",
            portA: "TOP",
            portB: "BASE",
            anchorA: leg.base,
            capacity: CAPACITY,
          },
          {
            id: `parallel-target-${index}`,
            a: actuatorId,
            b: targetId,
            kind: "mechanical",
            portA: "ROD",
            portB: "TOP",
            anchorB: leg.target,
            capacity: CAPACITY,
          },
          {
            id: `parallel-power-${index}`,
            a: batteryId,
            b: actuatorId,
            kind: "power",
            portA: "POWER",
            portB: "POWER",
          },
          {
            id: `parallel-signal-${index}`,
            a: controllerId,
            b: actuatorId,
            kind: "signal",
            portA: "OUT",
            portB: "CONTROL",
          },
        ];
      }),
      {
        id: "parallel-controller-power",
        a: batteryId,
        b: controllerId,
        kind: "power",
        portA: "POWER",
        portB: "POWER",
      },
    ],
    snapshot = { parts, connections },
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    adapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      catalog: TYPES,
      fixedDt: DT,
    });
  runtime.start(JSON.stringify(snapshot));
  let demands = [];
  const session = new SimulationSession({
    systems: [
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
      new MechanismSystem(),
      new RigidBodySystem(),
      new MotorEnergySettlementSystem(),
      new StructureSystem(),
      new TelemetrySystem(),
    ],
  }).start(snapshot, {
    world,
    worldAdapter: adapter,
    catalog: TYPES,
    multibodyRuntime: runtime,
    readCommandCandidates: () => ({
      remote: demands.map((demand) => ({
        targetId: demand.actuatorPartId,
        channel: "linear_force_n",
        value: demand.forceN,
        active: true,
      })),
      scripts: [],
    }),
  });
  session.stepFixed();
  return {
    runtime,
    session,
    baseId,
    targetId,
    actuatorIds,
    setDemands(value) {
      demands = value.map((entry) => ({ ...entry }));
    },
    dispose() {
      session.dispose();
      runtime.dispose();
    },
  };
}

function parallelRequest(
  fixtureValue,
  targetWrenchPart,
  maximumForceN,
  observationTick,
) {
  return JSON.stringify({
    version: 1,
    observationTick,
    targetPartId: fixtureValue.targetId,
    targetWrenchPart,
    actuators: fixtureValue.actuatorIds.map((actuatorPartId) => ({
      actuatorPartId,
      minimumForceN: -maximumForceN,
      maximumForceN,
    })),
    acceptance: {
      forceResidualToleranceN: 1e-5,
      momentResidualToleranceNm: 1e-5,
      momentReferenceLengthM: 1,
    },
    solver: {
      maxIterations: 16_384,
      projectedGradientToleranceN: 1e-7,
    },
  });
}

function wrenchFromBasis(basis, efforts) {
  const forceN = [0, 0, 0],
    momentNm = [0, 0, 0];
  for (let index = 0; index < basis.length; index++)
    for (let axis = 0; axis < 3; axis++) {
      forceN[axis] += basis[index].forcePerNewtonPart[axis] * efforts[index];
      momentNm[axis] += basis[index].momentPerNewtonPart[axis] * efforts[index];
    }
  return { forceN, momentNm };
}

function zeroBasis(fixtureValue, maximumForceN = 1_000) {
  return allocateAxialBodyWrench(
    fixtureValue.runtime,
    parallelRequest(
      fixtureValue,
      { forceN: [0, 0, 0], momentNm: [0, 0, 0] },
      maximumForceN,
      fixtureValue.session.context.clock.tick,
    ),
  );
}

const parallel = parallelFixture(),
  basisResult = zeroBasis(parallel),
  modestEfforts = [120, -90, 70, -50, 30, -10],
  modestWrench = wrenchFromBasis(basisResult.basis, modestEfforts),
  matrix = Array.from({ length: 6 }, (_, row) =>
    basisResult.basis.map((entry) =>
      row < 3
        ? entry.forcePerNewtonPart[row]
        : entry.momentPerNewtonPart[row - 3],
    ),
  ),
  matrixDeterminant = determinant(matrix);
assert.equal(basisResult.accepted, true, JSON.stringify(basisResult));
assert.ok(Math.abs(matrixDeterminant) > 0.1, String(matrixDeterminant));
const modestAllocation = allocateAxialBodyWrench(
  parallel.runtime,
  parallelRequest(parallel, modestWrench, 500, 1),
);
assert.equal(modestAllocation.accepted, true, JSON.stringify(modestAllocation));
for (let index = 0; index < modestEfforts.length; index++)
  assert.ok(
    near(
      modestAllocation.effortDemands[index].forceN,
      modestEfforts[index],
      1e-5,
    ),
  );
const permutedModestRequest = JSON.parse(
    parallelRequest(parallel, modestWrench, 500, 1),
  ),
  permutedModestAllocation = allocateAxialBodyWrench(
    parallel.runtime,
    JSON.stringify({
      ...permutedModestRequest,
      actuators: [...permutedModestRequest.actuators].reverse(),
    }),
  );
assert.deepEqual(permutedModestAllocation, modestAllocation);

const constrainedSourceEfforts = [600, 0, 0, 0, 0, 0],
  constrainedWrench = wrenchFromBasis(
    basisResult.basis,
    constrainedSourceEfforts,
  ),
  constrainedRequest = JSON.parse(
    parallelRequest(parallel, constrainedWrench, 1_000, 1),
  );
constrainedRequest.actuators[0].minimumForceN = -100;
constrainedRequest.actuators[0].maximumForceN = 100;
const constrainedAllocation = allocateAxialBodyWrench(
  parallel.runtime,
  JSON.stringify(constrainedRequest),
);
assert.equal(constrainedAllocation.candidateEfforts[0].forceN, 100);
assert.ok(
  norm(
    constrainedAllocation.candidateEfforts
      .slice(1)
      .map((entry) => entry.forceN),
  ) > 1,
  JSON.stringify(constrainedAllocation),
);
const negativeConstrainedWrench = wrenchFromBasis(
    basisResult.basis,
    [-600, 0, 0, 0, 0, 0],
  ),
  negativeConstrainedRequest = JSON.parse(
    parallelRequest(parallel, negativeConstrainedWrench, 1_000, 1),
  );
negativeConstrainedRequest.actuators[0].minimumForceN = -100;
negativeConstrainedRequest.actuators[0].maximumForceN = 100;
const negativeConstrainedAllocation = allocateAxialBodyWrench(
  parallel.runtime,
  JSON.stringify(negativeConstrainedRequest),
);
assert.equal(negativeConstrainedAllocation.candidateEfforts[0].forceN, -100);
assert.ok(
  norm(
    negativeConstrainedAllocation.candidateEfforts
      .slice(1)
      .map((entry) => entry.forceN),
  ) > 1,
  JSON.stringify(negativeConstrainedAllocation),
);

const targetBody = parallel.runtime.bodyByPart.get(parallel.targetId),
  baseBodyParallel = parallel.runtime.bodyByPart.get(parallel.baseId),
  targetVelocityBefore = [
    targetBody.velocity.x,
    targetBody.velocity.y,
    targetBody.velocity.z,
  ],
  baseVelocityBeforeParallel = [
    baseBodyParallel.velocity.x,
    baseBodyParallel.velocity.y,
    baseBodyParallel.velocity.z,
  ],
  targetAngularBefore = [
    targetBody.angularVelocity.x,
    targetBody.angularVelocity.y,
    targetBody.angularVelocity.z,
  ],
  totalAngularMomentumBefore = add(
    bodyAngularMomentumWorld(targetBody),
    bodyAngularMomentumWorld(baseBodyParallel),
  ),
  comPart = [
    targetBody.userData.massFrame.comPart.x,
    targetBody.userData.massFrame.comPart.y,
    targetBody.userData.massFrame.comPart.z,
  ],
  torqueAtCom = subtract(
    modestWrench.momentNm,
    cross(comPart, modestWrench.forceN),
  ),
  expectedAngularDelta = new CANNON.Vec3();
targetBody.invInertiaWorld.vmult(
  new CANNON.Vec3(...scale(torqueAtCom, DT)),
  expectedAngularDelta,
);
parallel.setDemands(modestAllocation.effortDemands);
parallel.session.stepFixed();

const mechanismStates = new Map(
    parallel.session
      .telemetry()
      .systems.mechanisms.twoFrameMechanisms.map((state) => [
        state.sourcePartId,
        state,
      ]),
  ),
  appliedEfforts = parallel.actuatorIds.map((id) => {
    const state = mechanismStates.get(id);
    assert.equal(state.commandValidity, "current");
    return state.appliedForceN;
  }),
  actualWrench = wrenchFromBasis(modestAllocation.basis, appliedEfforts),
  targetVelocityAfter = [
    targetBody.velocity.x,
    targetBody.velocity.y,
    targetBody.velocity.z,
  ],
  baseVelocityAfterParallel = [
    baseBodyParallel.velocity.x,
    baseBodyParallel.velocity.y,
    baseBodyParallel.velocity.z,
  ],
  targetAngularAfter = [
    targetBody.angularVelocity.x,
    targetBody.angularVelocity.y,
    targetBody.angularVelocity.z,
  ],
  totalAngularMomentumAfter = add(
    bodyAngularMomentumWorld(targetBody),
    bodyAngularMomentumWorld(baseBodyParallel),
  ),
  targetMomentumDelta = scale(
    subtract(targetVelocityAfter, targetVelocityBefore),
    targetBody.mass,
  ),
  baseMomentumDelta = scale(
    subtract(baseVelocityAfterParallel, baseVelocityBeforeParallel),
    baseBodyParallel.mass,
  ),
  angularDelta = subtract(targetAngularAfter, targetAngularBefore);
for (let index = 0; index < appliedEfforts.length; index++)
  assert.ok(
    near(
      appliedEfforts[index],
      modestAllocation.effortDemands[index].forceN,
      1e-6,
    ),
  );
for (let axis = 0; axis < 3; axis++) {
  assert.ok(
    near(targetMomentumDelta[axis], actualWrench.forceN[axis] * DT, 1e-6),
  );
  assert.ok(near(targetMomentumDelta[axis] + baseMomentumDelta[axis], 0, 1e-6));
  assert.ok(
    near(
      totalAngularMomentumAfter[axis],
      totalAngularMomentumBefore[axis],
      1e-5,
    ),
  );
  assert.ok(
    near(
      angularDelta[axis],
      [expectedAngularDelta.x, expectedAngularDelta.y, expectedAngularDelta.z][
        axis
      ],
      1e-5,
    ),
  );
}
assert.ok(norm(targetAngularAfter) > 0);
parallel.dispose();

console.log("axial body-wrench allocation verification passed");
