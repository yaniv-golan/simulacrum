import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import {
  dampingForce,
  elasticResponse,
  springResponse,
  stopResponse,
} from "../src/simulation/two-frame-mechanisms.js";

const CAPACITY = { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 };

function mechanism(type, configure = () => {}) {
  const definition = structuredClone(mechanismComponentDefinition(type));
  configure(definition);
  return definition;
}

function springAssembly({ stiffnessNPerM = 240, dampingNsPerM = 0 } = {}) {
  return {
    revision: 4,
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [-1, 0, 0],
        orientation: [0, 0, 0, 1],
        config: { linearDamping: 0, angularDamping: 0 },
      },
      {
        id: 2,
        type: "spring",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        mechanism: mechanism("spring", (definition) => {
          definition.config.referenceLaw.freeLengthM = 2;
          definition.config.elasticLaw.stiffnessNPerM = stiffnessNPerM;
          definition.config.dampingLaw.dampingNsPerM = dampingNsPerM;
          definition.config.lengthRangeM = { lower: 0.5, upper: 3.5 };
        }),
      },
      {
        id: 3,
        type: "plate",
        pos: [1, 0, 0],
        orientation: [0, 0, 0, 1],
        config: { linearDamping: 0, angularDamping: 0 },
      },
    ],
    connections: [
      {
        id: "spring-a",
        a: 1,
        b: 2,
        kind: "mechanical",
        portA: "TOP",
        portB: "END_A",
        anchorA: [0, 0, 0],
        capacity: CAPACITY,
      },
      {
        id: "spring-b",
        a: 2,
        b: 3,
        kind: "mechanical",
        portA: "END_B",
        portB: "TOP",
        anchorB: [0, 0, 0],
        capacity: CAPACITY,
      },
    ],
  };
}

function runOscillator(dt, { dampingNsPerM = 0, periods = 20 } = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.solver.iterations = 40;
  world.solver.tolerance = 1e-10;
  const runtime = new MultibodyRuntime({ world, catalog: TYPES, fixedDt: dt });
  runtime.start(springAssembly({ dampingNsPerM }));
  const entry = runtime.constraintEntries.find(
      (candidate) => candidate.kind === "axial-force-v1",
    ),
    bodyA = runtime.bodyByPart.get(1),
    bodyB = runtime.bodyByPart.get(3),
    effectiveMassKg = (bodyA.mass * bodyB.mass) / (bodyA.mass + bodyB.mass),
    omega = Math.sqrt(240 / effectiveMassKg),
    analyticPeriodS = (2 * Math.PI) / omega,
    totalTicks = Math.ceil((periods * analyticPeriodS) / dt);
  bodyB.position.x += 0.15;
  const initialCenterOfMassX =
    (bodyA.mass * bodyA.position.x + bodyB.mass * bodyB.position.x) /
    (bodyA.mass + bodyB.mass);
  let previousDisplacement = 0.15,
    previousTime = 0,
    initialEnergyJ = null,
    finalEnergyJ = null;
  const positiveCrossingsS = [];
  for (let tick = 0; tick < totalTicks; tick++) {
    runtime.stepActuators({ services: {} }, dt);
    runtime.worldAdapter.integrate(dt, { tick: tick + 1 });
    const telemetry = runtime.afterIntegration(dt),
      state = telemetry.twoFrameMechanisms[0],
      displacementM = state.coordinateM - 2,
      relativeSpeedMPerS = state.rateMPerS,
      energyJ =
        0.5 * effectiveMassKg * relativeSpeedMPerS ** 2 +
        state.elasticPotentialJ,
      timeS = (tick + 1) * dt;
    if (initialEnergyJ == null) initialEnergyJ = energyJ;
    finalEnergyJ = energyJ;
    if (previousDisplacement < 0 && displacementM >= 0) {
      const fraction =
        -previousDisplacement / (displacementM - previousDisplacement);
      positiveCrossingsS.push(previousTime + fraction * dt);
    }
    previousDisplacement = displacementM;
    previousTime = timeS;
  }
  const measuredPeriods = positiveCrossingsS
      .slice(1)
      .map((time, index) => time - positiveCrossingsS[index]),
    measuredPeriodS =
      measuredPeriods.reduce((sum, value) => sum + value, 0) /
      measuredPeriods.length,
    finalCenterOfMassX =
      (bodyA.mass * bodyA.position.x + bodyB.mass * bodyB.position.x) /
      (bodyA.mass + bodyB.mass),
    report = {
      analyticPeriodS,
      measuredPeriodS,
      periodRelativeError:
        Math.abs(measuredPeriodS - analyticPeriodS) / analyticPeriodS,
      energyDriftRatio:
        Math.abs(finalEnergyJ - initialEnergyJ) / initialEnergyJ,
      centerOfMassDriftM: Math.abs(finalCenterOfMassX - initialCenterOfMassX),
      dampingWorkJ: entry.dampingWorkJ,
    };
  runtime.dispose();
  return report;
}

const fullStep = runOscillator(1 / 120),
  halfStep = runOscillator(1 / 240);
assert.ok(fullStep.periodRelativeError <= 0.005, fullStep);
assert.ok(fullStep.energyDriftRatio <= 0.002, fullStep);
assert.ok(fullStep.centerOfMassDriftM <= 1e-10, fullStep);
assert.ok(
  halfStep.periodRelativeError < fullStep.periodRelativeError,
  `h/2 did not improve period error: ${JSON.stringify({ fullStep, halfStep })}`,
);

const damped = runOscillator(1 / 120, {
  dampingNsPerM: 12,
  periods: 4,
});
assert.ok(damped.dampingWorkJ < 0, damped);
assert.ok(dampingForce({ kind: "linear-v1", dampingNsPerM: 12 }, -2) < 0);

const offCenterSnapshot = springAssembly(),
  offCenterWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  offCenterRuntime = new MultibodyRuntime({
    world: offCenterWorld,
    catalog: TYPES,
  });
for (const part of [offCenterSnapshot.parts[0], offCenterSnapshot.parts[2]]) {
  part.type = "bearing";
  part.mechanism = mechanism("bearing");
}
offCenterSnapshot.connections[0].portA = "MOUNT";
offCenterSnapshot.connections[1].portB = "MOUNT";
offCenterRuntime.start(offCenterSnapshot);
offCenterRuntime.bodyByPart.get(3).position.x += 0.2;
offCenterRuntime.stepActuators({ services: {} }, 1 / 120);
const offCenterA = offCenterRuntime.bodyByPart.get(1),
  offCenterB = offCenterRuntime.bodyByPart.get(3),
  netForce = offCenterA.force.vadd(offCenterB.force),
  netTorque = offCenterA.position
    .cross(offCenterA.force)
    .vadd(offCenterA.torque)
    .vadd(offCenterB.position.cross(offCenterB.force))
    .vadd(offCenterB.torque);
assert.ok(offCenterA.torque.length() > 1e-3);
assert.ok(offCenterB.torque.length() > 1e-3);
assert.ok(netForce.length() <= 1e-10, netForce);
assert.ok(netTorque.length() <= 1e-10, netTorque);
offCenterRuntime.dispose();

const limitedWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
  limitedRuntime = new MultibodyRuntime({
    world: limitedWorld,
    catalog: TYPES,
  });
limitedWorld.solver.iterations = 60;
limitedWorld.solver.tolerance = 1e-10;
limitedRuntime.start(springAssembly());
limitedRuntime.bodyByPart.get(3).position.x += 2;
let limitedState;
for (let tick = 0; tick < 240; tick++) {
  limitedRuntime.stepActuators({ services: {} }, 1 / 120);
  limitedRuntime.worldAdapter.integrate(1 / 120, { tick: tick + 1 });
  limitedState = limitedRuntime.afterIntegration(1 / 120).twoFrameMechanisms[0];
}
assert.ok(limitedState.coordinateM <= 3.5 + 1e-5, limitedState);
limitedRuntime.dispose();

const progressive = {
    kind: "piecewise-force-v1",
    points: [
      { displacementM: -1, forceN: -300 },
      { displacementM: 0, forceN: 0 },
      { displacementM: 0.1, forceN: 60 },
      { displacementM: 0.2, forceN: 180 },
      { displacementM: 1, forceN: 900 },
    ],
    interpolation: "linear",
    extrapolation: "reject",
  },
  progressiveResponse = elasticResponse(progressive, 0.15),
  lowerStop = stopResponse(
    {
      engageCoordinate: 1.8,
      elasticLaw: { kind: "linear-v1", stiffnessNPerM: 2000 },
      dampingLaw: { kind: "linear-v1", dampingNsPerM: 80 },
    },
    "lower",
    1.7,
    -0.5,
  ),
  upperStop = stopResponse(
    {
      engageCoordinate: 2.2,
      elasticLaw: { kind: "linear-v1", stiffnessNPerM: 2000 },
      dampingLaw: { kind: "linear-v1", dampingNsPerM: 80 },
    },
    "upper",
    2.3,
    0.5,
  );
assert.ok(Math.abs(progressiveResponse.forceN - 120) <= 1e-12);
assert.ok(progressiveResponse.potentialJ > 0);
assert.ok(lowerStop.forceN < 0 && upperStop.forceN > 0);
assert.ok(lowerStop.dampingPowerW <= 0 && upperStop.dampingPowerW <= 0);
assert.equal(
  springResponse(
    {
      referenceLaw: {
        kind: "force-at-reference-v1",
        referenceLengthM: 2,
        forceAtReferenceN: 75,
      },
      elasticLaw: { kind: "linear-v1", stiffnessNPerM: 200 },
      dampingLaw: { kind: "linear-v1", dampingNsPerM: 0 },
    },
    2,
    0,
  ).forceN,
  75,
);

const runtimeSource = fs.readFileSync(
  new URL("../src/simulation/multibody-runtime.js", import.meta.url),
  "utf8",
);
assert.doesNotMatch(runtimeSource, /CANNON\.Spring|\.spring\.applyForce/);

console.log(
  `elastic elements passed (period error ${(fullStep.periodRelativeError * 100).toFixed(3)}%, energy drift ${(fullStep.energyDriftRatio * 100).toFixed(3)}%)`,
);
