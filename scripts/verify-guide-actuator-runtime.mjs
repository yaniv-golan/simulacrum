import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { applyMechanismPose } from "../src/presentation/mechanism-pose-presenter.js";
import { mechanismDeformationTransforms } from "../src/model/component-geometry-contract.js";
import { disposeObject3D } from "../src/presentation/render-resources.js";

const DT = 1 / 120,
  CAPACITY = { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 };

function mechanism(type) {
  return structuredClone(mechanismComponentDefinition(type));
}

function guideAssembly() {
  return {
    revision: 4,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, -0.5],
        orientation: [0, 0, 0, 1],
        config: { linearDamping: 0, angularDamping: 0 },
      },
      {
        id: 2,
        type: "linear-guide",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("linear-guide"),
      },
      {
        id: 3,
        type: "beam",
        pos: [1.2, 0, 0.5],
        orientation: [0, 0, 0, 1],
        config: { linearDamping: 0, angularDamping: 0 },
      },
    ],
    connections: [
      {
        id: "guide-base",
        a: 1,
        b: 2,
        kind: "mechanical",
        portA: "TOP",
        portB: "BASE",
        anchorA: [0, 0, 0],
        capacity: CAPACITY,
      },
      {
        id: "guide-slider",
        a: 2,
        b: 3,
        kind: "mechanical",
        portA: "SLIDER",
        portB: "A",
        capacity: CAPACITY,
      },
    ],
  };
}

function actuatorAssembly({ powered = true } = {}) {
  const connections = [
    {
      id: "actuator-base",
      a: 1,
      b: 2,
      kind: "mechanical",
      portA: "TOP",
      portB: "BASE",
      anchorA: [0, 0, 0],
      capacity: CAPACITY,
    },
    {
      id: "actuator-rod",
      a: 2,
      b: 3,
      kind: "mechanical",
      portA: "ROD",
      portB: "TOP",
      anchorB: [0, 0, 0],
      capacity: CAPACITY,
    },
    {
      id: "battery-mount",
      a: 1,
      b: 4,
      kind: "mechanical",
      portA: "TOP",
      portB: "MOUNT",
      anchorA: [0.5, 0, 0],
      capacity: CAPACITY,
    },
  ];
  if (powered)
    connections.push({
      id: "actuator-power",
      a: 4,
      b: 2,
      kind: "power",
      portA: "POWER",
      portB: "POWER",
    });
  return {
    revision: 4,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 0, -0.55],
        orientation: [0, 0, 0, 1],
        config: { linearDamping: 0, angularDamping: 0 },
      },
      {
        id: 2,
        type: "linear-actuator",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("linear-actuator"),
      },
      {
        id: 3,
        type: "plate",
        pos: [0, 0, 0.55],
        orientation: [0, 0, 0, 1],
        config: { linearDamping: 0, angularDamping: 0 },
      },
      {
        id: 4,
        type: "battery",
        pos: [0.5, 0.5, -0.55],
        orientation: [0, 0, 0, 1],
        storedEnergyWh: 100,
        config: {
          capacityWh: 100,
          maxOutputWatts: 10_000,
          dischargeEfficiency: 1,
        },
      },
    ],
    connections,
  };
}

const guideWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
guideWorld.solver.iterations = 60;
guideWorld.solver.tolerance = 1e-10;
const guideRuntime = new MultibodyRuntime({
    world: guideWorld,
    catalog: TYPES,
  }),
  guideSnapshot = guideAssembly();
guideRuntime.start(guideSnapshot);
const guideEntry = guideRuntime.constraintEntries.find(
  (entry) => entry.descriptor.kind === "linear-guide",
);
assert.equal(guideEntry.constraint.equalityEquations.length, 5);
assert.equal(guideEntry.constraint.equations.length, 9);
let maximumTransverseM = 0,
  maximumAngularRad = 0;
const initialRelative = guideRuntime.bodyByPart
  .get(2)
  .quaternion.conjugate()
  .mult(guideRuntime.bodyByPart.get(3).quaternion);
for (let tick = 0; tick < 3_600; tick++) {
  const moving = guideRuntime.bodyByPart.get(3);
  moving.applyForce(new CANNON.Vec3(80, 0, 120), new CANNON.Vec3(0, 0.5, 0));
  guideRuntime.stepActuators({ services: {} }, DT);
  guideRuntime.worldAdapter.integrate(DT, { tick: tick + 1 });
  const telemetry = guideRuntime.afterIntegration(DT),
    state = telemetry.twoFrameMechanisms.find(
      (candidate) => candidate.kind === "linear-guide",
    ),
    relative = guideRuntime.bodyByPart
      .get(2)
      .quaternion.conjugate()
      .mult(guideRuntime.bodyByPart.get(3).quaternion),
    orientationError = initialRelative.conjugate().mult(relative),
    angularError =
      2 *
      Math.atan2(
        Math.hypot(orientationError.x, orientationError.y, orientationError.z),
        Math.abs(orientationError.w),
      );
  assert.equal(state.coordinateId, "axial-extension");
  assert.equal(state.tick, tick + 1);
  assert.equal(state.unit, "m");
  assert.equal(state.validity, "measured");
  assert.ok(
    ["within-range", "below-range", "above-range"].includes(state.rangeStatus),
  );
  assert.deepEqual(state.allowedCoordinateRangeM, {
    minimum: 0,
    maximum: 0.6,
  });
  assert.ok(
    telemetry.poses.every((pose) => !Object.hasOwn(pose, "axialScale")),
    "legacy pose-owned deformation authority reappeared",
  );
  maximumTransverseM = Math.max(maximumTransverseM, state.transverseM);
  maximumAngularRad = Math.max(maximumAngularRad, angularError);
}
assert.ok(maximumTransverseM <= 1e-5, JSON.stringify({ maximumTransverseM }));
assert.ok(maximumAngularRad <= 1e-5, JSON.stringify({ maximumAngularRad }));
assert.ok(guideEntry.frictionWorkJ < 0, guideEntry);
assert.ok(Math.abs(guideEntry.appliedForceN) > 0, guideEntry);
assert.ok(
  Math.abs(guideEntry.appliedForceN) <=
    guideEntry.constraint.guideFrictionEquation.maxForce / DT + 1e-6,
  guideEntry,
);
assert.ok(
  guideEntry.coordinateM >= guideEntry.descriptor.limits[0] - 1e-6 &&
    guideEntry.coordinateM <= guideEntry.descriptor.limits[1] + 1e-6,
  JSON.stringify({
    coordinateM: guideEntry.coordinateM,
    limits: guideEntry.descriptor.limits,
    frictionForceN: guideEntry.appliedForceN,
  }),
);
const completedGuideTelemetry = guideRuntime.telemetry(),
  completedGuideState = completedGuideTelemetry.twoFrameMechanisms.find(
    (state) => state.kind === "linear-guide",
  ),
  completedGuidePose = completedGuideTelemetry.poses.find(
    (pose) => pose.id === completedGuideState.sourcePartId,
  ),
  guideCheckpoint = guideRuntime.exportState(),
  guideWorldCheckpoint = guideRuntime.worldAdapter.exportState(),
  replayWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  replayRuntime = new MultibodyRuntime({ world: replayWorld, catalog: TYPES });
replayRuntime.start(guideSnapshot);
replayRuntime.importState(guideCheckpoint);
replayRuntime.worldAdapter.importState(guideWorldCheckpoint);
const replayGuideState = replayRuntime
  .telemetry()
  .twoFrameMechanisms.find((state) => state.kind === "linear-guide");
assert.deepEqual(
  {
    tick: replayGuideState.tick,
    coordinateId: replayGuideState.coordinateId,
    coordinateM: replayGuideState.coordinateM,
    unit: replayGuideState.unit,
    validity: replayGuideState.validity,
    rangeStatus: replayGuideState.rangeStatus,
  },
  {
    tick: completedGuideState.tick,
    coordinateId: completedGuideState.coordinateId,
    coordinateM: completedGuideState.coordinateM,
    unit: completedGuideState.unit,
    validity: completedGuideState.validity,
    rangeStatus: completedGuideState.rangeStatus,
  },
  "checkpoint replay changed the completed deformation authority",
);
const guidePart = guideSnapshot.parts.find(
    (part) => part.id === completedGuideState.sourcePartId,
  ),
  renderedGuide = {
    ...guidePart,
    mesh: componentMesh(guidePart),
  },
  coordinateSample = {
    coordinateId: completedGuideState.coordinateId,
    coordinateM: completedGuideState.coordinateM,
  },
  expectedGuideTransforms = mechanismDeformationTransforms(
    renderedGuide.mesh.userData.geometryDescriptor,
    [coordinateSample],
  );
applyMechanismPose(renderedGuide, completedGuidePose, [coordinateSample]);
const renderedSliderTransform =
  renderedGuide.mesh.userData.mechanismDeformationRoots["slider-translation"];
assert.deepEqual(
  renderedSliderTransform.position.toArray(),
  expectedGuideTransforms["slider-translation"].positionM,
);
assert.deepEqual(
  renderedGuide.deformedBodyBoundsWorldM,
  completedGuidePose.deformedBodyBoundsWorldM,
);
disposeObject3D(renderedGuide.mesh);
replayRuntime.dispose();
guideRuntime.dispose();

function guidePermutationState(reverseRows) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.solver.iterations = 60;
  world.solver.tolerance = 1e-10;
  const runtime = new MultibodyRuntime({ world, catalog: TYPES });
  runtime.start(guideAssembly());
  const entry = runtime.constraintEntries.find(
    (candidate) => candidate.descriptor.kind === "linear-guide",
  );
  if (reverseRows) entry.constraint.equations.reverse();
  for (let tick = 0; tick < 600; tick++) {
    runtime.bodyByPart
      .get(3)
      .applyForce(new CANNON.Vec3(80, 0, 120), new CANNON.Vec3(0, 0.5, 0));
    runtime.stepActuators({ services: {} }, DT);
    runtime.worldAdapter.integrate(DT, { tick: tick + 1 });
    runtime.afterIntegration(DT);
  }
  const values = [2, 3].flatMap((id) => {
    const body = runtime.bodyByPart.get(id);
    return [
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
      body.angularVelocity.x,
      body.angularVelocity.y,
      body.angularVelocity.z,
    ];
  });
  runtime.dispose();
  return values;
}

const canonicalRows = guidePermutationState(false),
  reversedRows = guidePermutationState(true),
  rowPermutationDistance = Math.hypot(
    ...canonicalRows.map((value, index) => value - reversedRows[index]),
  );
assert.ok(
  rowPermutationDistance <= 1e-10,
  JSON.stringify({ rowPermutationDistance }),
);

function runActuator(snapshot, command = null, externalForceN = 0) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.solver.iterations = 60;
  world.solver.tolerance = 1e-10;
  const runtime = new MultibodyRuntime({ world, catalog: TYPES }),
    graph = new RunAssemblyGraph(snapshot),
    power = new PowerNetwork(TYPES),
    commandBus = new CommandBus(),
    context = {
      runGraph: graph,
      powerNetwork: power,
      commandBus,
      services: {},
    };
  runtime.start(snapshot);
  if (command != null) commandBus.writeRemote(2, "linear_target", command);
  let telemetry;
  for (let tick = 0; tick < 360; tick++) {
    power.resolve(graph, DT);
    if (externalForceN)
      runtime.bodyByPart
        .get(3)
        .applyForce(new CANNON.Vec3(0, 0, externalForceN));
    runtime.stepActuators(context, DT);
    runtime.worldAdapter.integrate(DT, { tick: tick + 1 });
    telemetry = runtime.afterIntegration(DT);
  }
  return { runtime, graph, telemetry };
}

const poweredSnapshot = actuatorAssembly(),
  initialEnergyJ =
    poweredSnapshot.parts.find((part) => part.id === 4).storedEnergyWh * 3600,
  powered = runActuator(poweredSnapshot, 0.8),
  poweredState = powered.telemetry.twoFrameMechanisms.find(
    (state) => state.kind === "linear-actuator",
  );
assert.ok(poweredState.coordinateM > 0.75, poweredState);
assert.equal(poweredState.coordinateId, "axial-extension");
assert.ok(poweredState.coordinateM <= 1.4 + 1e-6, poweredState);
assert.ok(poweredState.electricalEnergyJ > 0, poweredState);
assert.ok(poweredState.dissipatedEnergyJ >= 0, poweredState);
assert.ok(poweredState.temperatureK >= 293.15, poweredState);
assert.ok(powered.graph.part(4).energyJ < initialEnergyJ);
powered.runtime.dispose();

const unpowered = runActuator(actuatorAssembly({ powered: false }), null, 1000),
  unpoweredState = unpowered.telemetry.twoFrameMechanisms.find(
    (state) => state.kind === "linear-actuator",
  ),
  unpoweredEntry = unpowered.runtime.constraintEntries.find(
    (entry) => entry.descriptor.kind === "linear-actuator",
  );
assert.ok(
  Math.abs(unpoweredState.coordinateM - 1.1) <= 1e-4,
  JSON.stringify({
    ...unpoweredState,
    holdMultiplier: unpoweredEntry.constraint.holdEquation.multiplier,
    holdMinimum: unpoweredEntry.constraint.holdEquation.minForce,
    holdMaximum: unpoweredEntry.constraint.holdEquation.maxForce,
  }),
);
assert.equal(unpoweredState.powered, false);
assert.equal(unpoweredState.electricalEnergyJ, 0);
assert.equal(unpoweredEntry.kind, "axial-actuator-v1");
assert.equal(unpoweredEntry.constraint.holdEquation.enabled, true);
unpowered.runtime.dispose();

console.log(
  `guide/actuator runtime passed (${maximumTransverseM.toExponential(2)} m transverse, ${poweredState.coordinateM.toFixed(3)} m powered stroke)`,
);
