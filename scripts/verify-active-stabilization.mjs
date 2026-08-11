import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { createControllerSensorCapture } from "../src/application/controller-sensor-capture.js";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { TYPES } from "../src/model/component-catalog.js";
import { instantiateSubassembly } from "../src/model/subassemblies.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { prepareWasmController } from "../src/scripting/controller-compilers.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { controllerSensorFrameForId } from "../src/model/controller-sensor-frame-evidence.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { ControllerSystem } from "../src/simulation/systems/controller-system.js";
import { MechanismSystem } from "../src/simulation/systems/mechanism-system.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { RollingContactSystem } from "../src/simulation/systems/rolling-contact-system.js";
import { SensorSystem } from "../src/simulation/systems/sensor-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120;

function activeRecord() {
  const record = builtInMechanismSubassemblies().find(
    (candidate) => candidate.asset.name === "Active leveling suspension",
  );
  assert.ok(record, "active suspension asset is missing");
  return record;
}

function actuatorIdsForControllers(snapshot) {
  const pairs = snapshot.connections
    .filter(
      (connection) =>
        connection.kind === "signal" && connection.portA === "OUT",
    )
    .map((connection) => ({
      controllerId: connection.a,
      actuatorId: connection.b,
    }));
  assert.equal(
    pairs.length,
    4,
    "each actuator needs one private control route",
  );
  return pairs;
}

function scenarioSnapshot(mode, scenario = null) {
  const instance = instantiateSubassembly(activeRecord().asset, {
      position: [-3, 0, 0],
    }),
    snapshot = {
      revision: 1,
      parts: instance.parts,
      connections: instance.connections,
    },
    actuatorIds = new Set(
      actuatorIdsForControllers(snapshot).map((pair) => pair.actuatorId),
    );
  if (mode === "power-loss")
    snapshot.connections = snapshot.connections.filter(
      (connection) => connection.kind !== "power",
    );
  if (mode === "sensor-loss")
    snapshot.connections = snapshot.connections.filter(
      (connection) =>
        !(connection.kind === "signal" && connection.portA === "SIGNAL"),
    );
  if (mode === "signal-loss")
    snapshot.connections = snapshot.connections.filter(
      (connection) =>
        !(connection.kind === "signal" && connection.portA === "OUT"),
    );
  if (mode === "saturation")
    for (const part of snapshot.parts) {
      if (!actuatorIds.has(part.id)) continue;
      for (const point of part.mechanism.config.forceSpeedEnvelope.points) {
        point.maxExtendForceN = 10;
        point.maxRetractForceN = 10;
      }
      part.mechanism.config.powerLaw.maximumMechanicalMotoringPowerW = 40;
    }
  if (mode === "overheating")
    for (const part of snapshot.parts) {
      if (!actuatorIds.has(part.id)) continue;
      part.mechanism.config.thermalLimits = {
        thermalMassJPerK: 0.1,
        ambientConductanceWPerK: 0,
        derateTemperatureK: 293.2,
        shutdownTemperatureK: 293.3,
      };
    }
  if (mode === "bottom-out")
    for (const part of snapshot.parts) {
      if (!actuatorIds.has(part.id)) continue;
      part.mechanism.config.lengthRangeM = { lower: 0.7, upper: 0.9 };
    }
  if (scenario?.powerScale != null)
    for (const part of snapshot.parts) {
      if (!actuatorIds.has(part.id)) continue;
      part.mechanism.config.powerLaw.maximumMechanicalMotoringPowerW *=
        scenario.powerScale;
    }
  if (scenario?.forceScale != null)
    for (const part of snapshot.parts) {
      if (!actuatorIds.has(part.id)) continue;
      for (const point of part.mechanism.config.forceSpeedEnvelope.points) {
        point.maxExtendForceN *= scenario.forceScale;
        point.maxRetractForceN *= scenario.forceScale;
      }
    }
  return snapshot;
}

function rollDegrees(quaternion) {
  const sin = 2 * (quaternion.w * quaternion.x + quaternion.y * quaternion.z),
    cos = 1 - 2 * (quaternion.x ** 2 + quaternion.y ** 2);
  return (Math.atan2(sin, cos) * 180) / Math.PI;
}

function pitchDegrees(quaternion) {
  const sin = Math.max(
    -1,
    Math.min(
      1,
      2 * (quaternion.w * quaternion.y - quaternion.z * quaternion.x),
    ),
  );
  return (Math.asin(sin) * 180) / Math.PI;
}

const FUEL_TRAP_SOURCE = `(module
  (func $heavy (result f32) ${"nop ".repeat(5_500)} (f32.const 1))
  (func (export "tick") (param f32)
    (drop (call $heavy))
    (drop (call $heavy))))`;

async function run(mode, scenario = null) {
  const snapshot = scenarioSnapshot(mode, scenario),
    catalog = scenario?.payloadKg
      ? {
          ...TYPES,
          plate: {
            ...TYPES.plate,
            mass: TYPES.plate.mass + scenario.payloadKg,
          },
        }
      : TYPES,
    runtimeCatalog = catalog === TYPES ? TYPES : JSON.stringify(catalog),
    world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    material = new CANNON.Material(`active-leveling-${mode}`),
    groundMaterial = new CANNON.Material(`active-ground-${mode}`),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Box(new CANNON.Vec3(8, 0.25, 4)),
      position: new CANNON.Vec3(0, -0.25, 0),
    }),
    curb = scenario?.terrainHeightM
      ? new CANNON.Body({
          type: CANNON.Body.STATIC,
          material: groundMaterial,
          shape: new CANNON.Box(
            new CANNON.Vec3(0.08, scenario.terrainHeightM / 2, 4),
          ),
          position: new CANNON.Vec3(0, scenario.terrainHeightM / 2, 0),
        })
      : null,
    adapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      material,
      catalog: runtimeCatalog,
      groundBody: ground,
      fieldBody: ground,
      fixedDt: DT,
    }),
    traces = [],
    outputs = new Map(),
    manager = new ControllerRuntimeManager({
      onCommands: (controllerId, commands) =>
        outputs.set(controllerId, Object.fromEntries(commands)),
      onTrace: (trace) => traces.push(trace),
    }),
    controllers = snapshot.parts.filter((part) => part.type === "computer"),
    sensorBank = new ControllerSensorBank(),
    readSensors = createControllerSensorCapture({
      sampleWind: () => ({ x: 0, y: 0, z: 0 }),
      sensorBank,
    });
  for (const [body, id, surface] of [
    [ground, "ground", "flat-course"],
    ...(curb ? [[curb, "curb", "course-curb"]] : []),
  ]) {
    body.userData = {
      externalBodyId: `fixture:${id}`,
      surface,
      materialKey: "workshop-steel",
    };
    world.addBody(body);
  }
  world.solver.iterations = 50;
  world.solver.tolerance = 0.0001;
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, groundMaterial, {
      friction: 0.68,
      restitution: 0.02,
    }),
  );
  runtime.start(JSON.stringify(snapshot));
  if (!["neutral", "power-loss", "sensor-loss", "signal-loss"].includes(mode))
    for (const controller of controllers) {
      const bindingManifest = controllerBindingManifest(
        controller,
        snapshot.parts,
        snapshot.connections,
        catalog,
      );
      manager.attach(
        controller.id,
        mode === "controller-failure"
          ? await prepareWasmController(FUEL_TRAP_SOURCE, bindingManifest)
          : await prepareTypeScriptController(
              controller.scriptSources.typescript,
              bindingManifest,
            ),
        "LEVELING",
      );
    }
  const session = new SimulationSession({
    systems: [
      new SensorSystem(),
      new ControllerSystem(),
      new PowerSystem(),
      new SignalSystem(),
      new CommandRoutingSystem(),
      new MechanismSystem(),
      new RollingContactSystem(),
      new RigidBodySystem(),
      new StructureSystem(),
      new TelemetrySystem(),
    ],
  }).start(snapshot, {
    world,
    worldAdapter: adapter,
    catalog,
    multibodyRuntime: runtime,
    readSensors,
    tickControllers: (dt, sensorSnapshot = {}) => {
      const powered = sensorSnapshot.poweredControllerIds;
      for (const controller of controllers) {
        if (Array.isArray(powered) && !powered.includes(controller.id)) {
          manager.dispose(controller.id);
          outputs.delete(controller.id);
          continue;
        }
        manager.tick(
          controller.id,
          dt,
          controllerSensorFrameForId(
            sensorSnapshot.controllers,
            controller.id,
          ) || {},
        );
      }
    },
    readCommandCandidates: () => ({
      remote: [],
      scripts: controllers
        .filter((controller) => manager.ready(controller.id))
        .flatMap((controller) => {
          const bindings = new Map(
            controller.controllerBindings.map((binding) => [
              binding.id,
              binding,
            ]),
          );
          return Object.entries(outputs.get(controller.id) || {}).map(
            ([bindingId, value]) => {
              const binding = bindings.get(bindingId);
              return {
                controllerId: controller.id,
                bindingId,
                targetId: binding?.endpointPartId,
                endpointPortId: binding?.endpointPortId,
                channel: binding?.channel,
                value,
              };
            },
          );
        }),
    }),
    controllerTelemetry: () => ({ onlineControllerIds: manager.ids() }),
    connectionValid: (connection) => !connection.failed,
    partMass: (part) => catalog[part.type]?.mass || 0,
  });
  const chassisId = snapshot.parts.find((part) => part.type === "plate").id,
    partById = new Map(snapshot.parts.map((part) => [part.id, part])),
    hubsByWheelSide = snapshot.parts
      .filter((part) => part.type === "motor")
      .map((part) => {
        const wheelConnection = snapshot.connections.find(
            (connection) =>
              connection.kind === "mechanical" &&
              ((connection.a === part.id &&
                connection.portA === "SHAFT" &&
                connection.portB === "AXLE") ||
                (connection.b === part.id &&
                  connection.portB === "SHAFT" &&
                  connection.portA === "AXLE")),
          ),
          wheelId =
            wheelConnection?.a === part.id
              ? wheelConnection.b
              : wheelConnection?.a,
          wheel = partById.get(wheelId);
        assert.ok(wheel, `motor ${part.id} has no authored wheel connection`);
        return {
          body: runtime.bodyByPart.get(part.id),
          side: Math.sign(wheel.pos[2]),
        };
      }),
    negativeHubs = hubsByWheelSide
      .filter(({ side }) => side < 0)
      .map(({ body }) => body),
    positiveHubs = hubsByWheelSide
      .filter(({ side }) => side > 0)
      .map(({ body }) => body),
    rolls = [],
    pitches = [],
    travelDifferentials = [],
    actuatorStates = [],
    samples = [];
  if (scenario?.speedMPerS)
    for (const body of runtime.bodyByPart.values())
      body.velocity.x = scenario.speedMPerS;
  let contactTicks = 0;
  assert.equal(negativeHubs.length, 2);
  assert.equal(positiveHubs.length, 2);
  const terminalTick = scenario?.durationTicks || 300;
  for (let tick = 1; tick <= terminalTick; tick++) {
    if (scenario && tick >= 60 && tick < terminalTick - 30) {
      const disturbanceN =
        scenario.disturbanceAmplitudeN *
        Math.sin(2 * Math.PI * scenario.disturbanceFrequencyHz * tick * DT);
      for (const hub of negativeHubs)
        hub.applyForce(new CANNON.Vec3(0, -disturbanceN, 0));
      for (const hub of positiveHubs)
        hub.applyForce(new CANNON.Vec3(0, disturbanceN, 0));
    } else if (!scenario && tick >= 100 && tick < 124) {
      const disturbanceN = mode === "bottom-out" ? 1_000 : 40;
      for (const hub of negativeHubs)
        hub.applyForce(new CANNON.Vec3(0, -disturbanceN, 0));
      for (const hub of positiveHubs)
        hub.applyForce(new CANNON.Vec3(0, disturbanceN, 0));
    }
    session.stepFixed();
    const chassisPose = runtime.bodyPose(chassisId),
      mechanisms = session.telemetry().systems.mechanisms,
      actuators =
        mechanisms?.twoFrameMechanisms?.filter(
          (state) => state.kind === "linear-actuator",
        ) || [];
    if (
      session
        .telemetry()
        .systems.mobility?.assemblies?.some((assembly) =>
          assembly.wheelStates.some((wheel) => wheel.touching),
        )
    )
      contactTicks++;
    assert.equal(actuators.length, 4);
    assert.ok(
      [
        rollDegrees(chassisPose.quaternion),
        ...actuators.flatMap((state) => [
          state.coordinateM,
          state.rateMPerS,
          state.forceN,
          state.electricalEnergyJ,
        ]),
      ].every(Number.isFinite),
      `${mode} produced non-finite stabilization state at tick ${tick}`,
    );
    if (tick >= 60) {
      rolls.push(rollDegrees(chassisPose.quaternion));
      pitches.push(pitchDegrees(chassisPose.quaternion));
      const sideCoordinates = [-1, 1].map((sign) => {
        const side = actuators.filter(
          (state) =>
            Math.sign(
              snapshot.parts.find((part) => part.id === state.sourcePartId)
                .pos[2],
            ) === sign,
        );
        return (
          side.reduce((sum, state) => sum + state.coordinateM, 0) / side.length
        );
      });
      travelDifferentials.push(
        Math.abs(sideCoordinates[0] - sideCoordinates[1]),
      );
      actuatorStates.push(...actuators.map((state) => ({ ...state, tick })));
    }
    if ([60, 99, 124, 180, terminalTick].includes(tick))
      samples.push({
        tick,
        rollDeg: rollDegrees(chassisPose.quaternion),
        pitchDeg: pitchDegrees(chassisPose.quaternion),
      });
  }
  const finalPose = runtime.bodyPose(chassisId);
  const result = {
    mode,
    scenario: scenario ? structuredClone(scenario) : null,
    maxRollDeg: Math.max(...rolls.map(Math.abs)),
    rmsRollDeg: Math.sqrt(
      rolls.reduce((sum, value) => sum + value ** 2, 0) / rolls.length,
    ),
    maxPitchDeg: Math.max(...pitches.map(Math.abs)),
    maxTravelDifferentialM: Math.max(...travelDifferentials),
    saturatedTicks: new Set(
      actuatorStates
        .filter((state) => state.saturated)
        .map((state) => state.tick),
    ).size,
    thermalDerateTicks: new Set(
      actuatorStates
        .filter((state) => state.thermalDerate < 1)
        .map((state) => state.tick),
    ).size,
    thermalShutdownTicks: new Set(
      actuatorStates
        .filter((state) => state.thermalShutdown)
        .map((state) => state.tick),
    ).size,
    hardLimitTicks: new Set(
      actuatorStates
        .filter((state) => {
          const part = snapshot.parts.find(
            (candidate) => candidate.id === state.sourcePartId,
          );
          const range = part.mechanism.config.lengthRangeM;
          return (
            Math.abs(state.coordinateM - range.lower) <= 1e-3 ||
            Math.abs(state.coordinateM - range.upper) <= 1e-3
          );
        })
        .map((state) => state.tick),
    ).size,
    coordinateRangeM: {
      minimum: Math.min(...actuatorStates.map((state) => state.coordinateM)),
      maximum: Math.max(...actuatorStates.map((state) => state.coordinateM)),
    },
    poweredTicks: new Set(
      actuatorStates
        .filter((state) => state.powered)
        .map((state) => state.tick),
    ).size,
    contactTicks,
    samples,
    traces,
    controllerStatuses: controllers.map((controller) =>
      manager.status(controller.id),
    ),
    events: session.context.runGraph.events(),
    final: {
      position: [
        finalPose.position.x,
        finalPose.position.y,
        finalPose.position.z,
      ],
      quaternion: [
        finalPose.quaternion.x,
        finalPose.quaternion.y,
        finalPose.quaternion.z,
        finalPose.quaternion.w,
      ],
      velocity: [
        finalPose.velocity.x,
        finalPose.velocity.y,
        finalPose.velocity.z,
      ],
    },
  };
  session.dispose();
  runtime.dispose();
  manager.disposeAll();
  if (curb) world.removeBody(curb);
  world.removeBody(ground);
  return result;
}

const neutral = await run("neutral"),
  active = await run("active"),
  repeat = await run("active"),
  powerLoss = await run("power-loss"),
  sensorLoss = await run("sensor-loss"),
  signalLoss = await run("signal-loss"),
  saturation = await run("saturation"),
  overheating = await run("overheating"),
  controllerFailure = await run("controller-failure"),
  bottomOut = await run("bottom-out");

assert.deepEqual(
  repeat.final,
  active.final,
  "active leveling is nondeterministic",
);
assert.equal(repeat.maxRollDeg, active.maxRollDeg);
assert.equal(repeat.rmsRollDeg, active.rmsRollDeg);
assert.ok(active.traces.length > 0, "authored controllers never executed");
assert.equal(
  active.traces[0].sensors["imu.roll"] ?? 0,
  0,
  "controller observed non-completed IMU state on its first tick",
);
assert.equal(
  signalLoss.traces.length,
  0,
  "controller with an invalid authored output binding started executing",
);
assert.equal(
  signalLoss.poweredTicks > 0,
  true,
  "signal loss incorrectly removed physical actuator power",
);
assert.deepEqual(
  signalLoss.final,
  neutral.final,
  "invalid output bindings did not produce the neutral fail-closed motion",
);
assert.ok(
  active.traces.some((trace) => Object.hasOwn(trace.sensors, "imu.roll")),
  "connected IMU never reached the previous-step controller snapshot",
);
assert.ok(
  active.rmsRollDeg < neutral.rmsRollDeg * 0.9,
  JSON.stringify({
    neutral: {
      rmsRollDeg: neutral.rmsRollDeg,
      maxPitchDeg: neutral.maxPitchDeg,
      contactTicks: neutral.contactTicks,
      samples: neutral.samples,
    },
    active: {
      rmsRollDeg: active.rmsRollDeg,
      maxPitchDeg: active.maxPitchDeg,
      contactTicks: active.contactTicks,
      samples: active.samples,
    },
  }),
);
assert.ok(
  active.maxRollDeg < neutral.maxRollDeg,
  JSON.stringify({ neutral: neutral.maxRollDeg, active: active.maxRollDeg }),
);
assert.equal(powerLoss.traces.length, 0, "unpowered controllers executed");
assert.equal(powerLoss.poweredTicks, 0, "unpowered actuators reported power");
assert.equal(
  sensorLoss.traces.some((trace) =>
    Object.hasOwn(trace.sensors, "imu_roll_deg"),
  ),
  false,
  "disconnected IMU leaked into controller input",
);
assert.ok(
  saturation.saturatedTicks > 0,
  "force-limited actuator never saturated",
);
assert.ok(
  overheating.thermalDerateTicks > 0 && overheating.thermalShutdownTicks > 0,
  "actuator thermal limit never derated and shut down",
);
assert.ok(
  overheating.poweredTicks < active.poweredTicks,
  "thermal shutdown did not withdraw actuator power",
);
assert.ok(
  controllerFailure.controllerStatuses.every(
    (status) => !status.ready && /fuel exhausted/.test(status.status),
  ),
  JSON.stringify(controllerFailure.controllerStatuses),
);
assert.equal(
  controllerFailure.traces.length,
  0,
  "watchdog-trapped controllers published successful traces",
);
assert.ok(
  bottomOut.hardLimitTicks > 0,
  `hard travel limit was never reached: ${JSON.stringify(bottomOut.coordinateRangeM)}`,
);
for (const result of [
  active,
  powerLoss,
  sensorLoss,
  signalLoss,
  saturation,
  overheating,
  controllerFailure,
  bottomOut,
]) {
  assert.deepEqual(
    result.events,
    [],
    `${result.mode} caused structural failure`,
  );
  assert.ok(
    result.final.position
      .concat(result.final.quaternion, result.final.velocity)
      .every(Number.isFinite),
    `${result.mode} passive fallback was not finite`,
  );
}

const capabilityCases = Object.freeze([
    {
      id: "nominal-flat",
      disturbanceAmplitudeN: 40,
      disturbanceFrequencyHz: 1,
      speedMPerS: 0,
      payloadKg: 0,
      powerScale: 1,
      terrainHeightM: 0,
      durationTicks: 240,
      limits: { rmsRollDeg: 5, maxRollDeg: 15 },
    },
    {
      id: "amplitude-boundary",
      disturbanceAmplitudeN: 120,
      disturbanceFrequencyHz: 1,
      speedMPerS: 0,
      payloadKg: 0,
      powerScale: 1,
      terrainHeightM: 0,
      durationTicks: 240,
      limits: { rmsRollDeg: 5, maxRollDeg: 15 },
    },
    {
      id: "frequency-boundary",
      disturbanceAmplitudeN: 40,
      disturbanceFrequencyHz: 3,
      speedMPerS: 0,
      payloadKg: 0,
      powerScale: 1,
      terrainHeightM: 0,
      durationTicks: 240,
      limits: { rmsRollDeg: 5, maxRollDeg: 15 },
    },
    {
      id: "curb-at-speed",
      disturbanceAmplitudeN: 40,
      disturbanceFrequencyHz: 1,
      speedMPerS: 1.5,
      payloadKg: 0,
      powerScale: 1,
      terrainHeightM: 0.08,
      durationTicks: 300,
      limits: { rmsRollDeg: 8, maxRollDeg: 25 },
    },
    {
      id: "payload-boundary",
      disturbanceAmplitudeN: 40,
      disturbanceFrequencyHz: 1,
      speedMPerS: 0,
      payloadKg: 120,
      powerScale: 1,
      terrainHeightM: 0,
      durationTicks: 240,
      limits: { rmsRollDeg: 8, maxRollDeg: 25 },
    },
    {
      id: "low-power-boundary",
      disturbanceAmplitudeN: 40,
      disturbanceFrequencyHz: 1,
      speedMPerS: 0,
      payloadKg: 0,
      powerScale: 0.2,
      terrainHeightM: 0,
      durationTicks: 240,
      limits: { rmsRollDeg: 8, maxRollDeg: 25 },
    },
    {
      id: "combined-degraded-envelope",
      disturbanceAmplitudeN: 250,
      disturbanceFrequencyHz: 3,
      speedMPerS: 2,
      payloadKg: 150,
      powerScale: 0.15,
      forceScale: 0.01,
      terrainHeightM: 0.16,
      durationTicks: 300,
      limits: { rmsRollDeg: 30, maxRollDeg: 60, requireSaturation: true },
    },
  ]),
  capabilityChart = [];
let nominalEnvelopeFinal = null;
for (const scenario of capabilityCases) {
  const result = await run("active", scenario),
    row = {
      ...scenario,
      rmsRollDeg: result.rmsRollDeg,
      maxRollDeg: result.maxRollDeg,
      maxPitchDeg: result.maxPitchDeg,
      maxTravelDifferentialM: result.maxTravelDifferentialM,
      saturatedTicks: result.saturatedTicks,
      contactTicks: result.contactTicks,
      status:
        result.rmsRollDeg <= scenario.limits.rmsRollDeg &&
        result.maxRollDeg <= scenario.limits.maxRollDeg
          ? scenario.limits.requireSaturation
            ? "bounded-degraded"
            : "controlled"
          : "outside-declared-envelope",
    };
  assert.deepEqual(
    result.events,
    [],
    `${scenario.id} caused structural failure`,
  );
  assert.ok(
    result.rmsRollDeg <= scenario.limits.rmsRollDeg,
    `${scenario.id} exceeded RMS roll envelope: ${JSON.stringify(row)}`,
  );
  assert.ok(
    result.maxRollDeg <= scenario.limits.maxRollDeg,
    `${scenario.id} exceeded peak roll envelope: ${JSON.stringify(row)}`,
  );
  if (scenario.limits.requireSaturation)
    assert.ok(
      result.saturatedTicks > 0,
      `${scenario.id} failed to disclose bounded actuator saturation: ${JSON.stringify(row)}`,
    );
  if (scenario.id === "nominal-flat") nominalEnvelopeFinal = result.final;
  capabilityChart.push(row);
}
const repeatedEnvelope = await run("active", capabilityCases[0]);
assert.deepEqual(
  repeatedEnvelope.final,
  nominalEnvelopeFinal,
  "capability chart nominal cell is nondeterministic",
);

console.log(
  `active stabilization passed (neutral ${neutral.rmsRollDeg.toFixed(2)}° RMS, active ${active.rmsRollDeg.toFixed(2)}° RMS; ${saturation.saturatedTicks} saturated, ${overheating.thermalShutdownTicks} thermal-shutdown, ${bottomOut.hardLimitTicks} hard-limit ticks; capability chart ${JSON.stringify(capabilityChart)})`,
);
