import assert from "node:assert/strict";
import fs from "node:fs/promises";
import * as CANNON from "cannon-es";
import { DRONE_TS_SOURCE } from "../src/application/content.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { TYPES } from "../src/model/component-catalog.js";
import { rotorAerodynamicPerformance } from "../src/model/rotor-aerodynamics-contracts.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { quaternionToAircraftDegrees } from "../src/simulation/attitude-math.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { createPhysicalFlightServices } from "../src/simulation/physical-flight-services.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import {
  AerodynamicSystem,
  MechanismSystem,
  MotorEnergySettlementSystem,
  PhysicalFlightTelemetrySystem,
  PowerSystem,
  RigidBodySystem,
  RotorPropulsionSystem,
  StructureSystem,
  TelemetrySystem,
  ThermalSystem,
} from "../src/simulation/systems/index.js";
import { PhysicalAssemblySystem } from "../src/simulation/systems/physical-assembly-system.js";

const qualification = JSON.parse(
    await fs.readFile(
      new URL(
        "../test/fixtures/flight/electric-multirotor-qualification-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  DT = qualification.fixedStepS,
  demo = builtInDemo("drone", { droneTypescript: DRONE_TS_SOURCE }),
  snapshot = decodeBlueprintOrThrow(demo.blueprint).assembly,
  controller = snapshot.parts.find((part) => part.type === "computer"),
  motors = snapshot.parts.filter((part) => part.type === "motor"),
  rotors = snapshot.parts.filter((part) => part.type === "rotor"),
  battery = snapshot.parts.find((part) => part.type === "battery"),
  imu = snapshot.parts.find((part) => part.type === "imu"),
  navigation = snapshot.parts.find((part) => part.type === "navsensor"),
  manifest = controllerBindingManifest(
    controller,
    snapshot.parts,
    snapshot.connections,
  ),
  outputBindings = manifest.filter((binding) => binding.direction === "output"),
  controllerProgram = await prepareTypeScriptController(
    DRONE_TS_SOURCE,
    manifest,
  );

function inBand(value, band, label) {
  assert.ok(
    value >= band.minimum && value <= band.maximum,
    `${label} ${value} outside [${band.minimum}, ${band.maximum}]`,
  );
}

function maximumPowerDynamometer() {
  const electricalPowerW = motors.reduce(
      (sum, motor) => sum + motor.config.power * 1000,
      0,
    ),
    efficiency = Math.min(
      ...motors.map((motor) => motor.config.electricalEfficiency),
    ),
    perRotorMechanicalPowerW = (electricalPowerW * efficiency) / rotors.length,
    performances = rotors.map((rotor) => {
      let best = null;
      for (let rpm = 1; rpm <= rotor.config.maximumRpm; rpm++) {
        const performance = rotorAerodynamicPerformance(
          { ...rotor.config, kind: "shaft-rotor-aerodynamics-v1" },
          {
            airDensityKgM3: qualification.dynamometer.airDensityKgM3,
            axialInflowMps: 0,
            angularSpeedRadS:
              (rpm * rotor.config.handedness * Math.PI * 2) / 60,
          },
        );
        if (performance.aerodynamicPowerW <= perRotorMechanicalPowerW)
          best = performance;
      }
      assert.ok(best, "rotor dynamometer found no admissible operating point");
      return best;
    }),
    bands = qualification.dynamometer.bands,
    durationS = qualification.dynamometer.qualifyingTicks * DT,
    remainingBatteryWh =
      battery.storedEnergyWh -
      (electricalPowerW * durationS) /
        battery.config.dischargeEfficiency /
        3600;
  inBand(electricalPowerW, bands.totalBusPowerW, "total bus power W");
  inBand(
    electricalPowerW * efficiency,
    bands.totalPositiveMotorWorkW,
    "total positive motor work W",
  );
  for (const performance of performances) {
    inBand(
      Math.abs(performance.aerodynamicTorqueNm),
      bands.perRotorTorqueNm,
      "rotor torque Nm",
    );
    inBand(Math.abs(performance.rpm), bands.perRotorAbsoluteRpm, "rotor rpm");
    inBand(performance.thrustN, bands.perRotorThrustN, "rotor thrust N");
    inBand(performance.tipMach, bands.perRotorTipMach, "rotor tip Mach");
  }
  inBand(remainingBatteryWh, bands.remainingBatteryWh, "remaining battery Wh");
  return {
    electricalPowerW,
    mechanicalPowerW: electricalPowerW * efficiency,
    durationS,
    remainingBatteryWh,
    rotors: performances.map((performance) => ({
      rpm: Math.abs(performance.rpm),
      torqueNm: Math.abs(performance.aerodynamicTorqueNm),
      thrustN: performance.thrustN,
      tipMach: performance.tipMach,
    })),
  };
}

function commandAtTick(tick) {
  const entry = qualification.mission.commandSchedule.find(
    (candidate) => tick >= candidate.startTick && tick < candidate.endTick,
  );
  assert.ok(entry, `mission command schedule has no entry for tick ${tick}`);
  return entry;
}

function windAt(_position, time) {
  const tick = Math.max(0, Math.round(time / DT)),
    entry = qualification.mission.windSchedule.find(
      (candidate) => tick >= candidate.startTick && tick < candidate.endTick,
    ),
    [x, y, z] = entry?.velocityMps || [0, 0, 0];
  return { x, y, z };
}

function groundContact(world, ground) {
  return world.contacts.some(
    (contact) => contact.bi === ground || contact.bj === ground,
  );
}

function primaryState(multibodyRuntime) {
  const imuPose = multibodyRuntime.bodyPose(imu.id),
    navigationPose = multibodyRuntime.bodyPose(navigation.id),
    imuBody = multibodyRuntime.bodyByPart.get(imu.id),
    attitude = quaternionToAircraftDegrees(imuPose.quaternion);
  return {
    altitudeM: navigationPose.position.y,
    verticalSpeedMps: navigationPose.velocity.y,
    attitude,
    angularRateRadS: {
      roll: imuBody.angularVelocity.z,
      pitch: imuBody.angularVelocity.x,
      yaw: imuBody.angularVelocity.y,
    },
  };
}

async function flightMission() {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    machineMaterial = new CANNON.Material("electric-multirotor-machine"),
    groundMaterial = new CANNON.Material("electric-multirotor-ground"),
    ground = new CANNON.Body({ mass: 0, material: groundMaterial }),
    worldAdapter = new CannonWorldAdapter(world),
    multibodyRuntime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: machineMaterial,
      catalog: TYPES,
      fixedDt: DT,
      surfaceHeightAt: () => 0,
      terrainHeightAt: () => 0,
    });
  ground.addShape(new CANNON.Plane());
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  world.addContactMaterial(
    new CANNON.ContactMaterial(machineMaterial, groundMaterial, {
      friction: 0.72,
      restitution: 0.02,
    }),
  );
  world.solver.iterations = 30;
  world.solver.tolerance = 0.0002;
  multibodyRuntime.start(snapshot);
  const physicalAssemblyIndex = new PhysicalAssemblyIndex(
      multibodyRuntime.compiled,
    ),
    flightServices = createPhysicalFlightServices({
      multibodyRuntime,
      physicalAssemblyIndex,
      windAt,
    }),
    program = controllerProgram.instantiate(),
    controllerSystem = {
      phase: "controllers",
      step(context) {
        context.commandBus.clearTick();
        const command = commandAtTick(context.clock.tick - 1),
          physical = primaryState(multibodyRuntime),
          values = {
            "pilot.collective": command.collective,
            "pilot.altitude_hold": command.altitudeHold,
            "pilot.yaw": command.yaw,
            "pilot.pitch": command.pitch,
            "pilot.roll": command.roll,
            "nav.altitude": physical.altitudeM,
            "imu.roll": physical.attitude.roll,
            "imu.pitch": physical.attitude.pitch,
            "imu.yaw": physical.attitude.yaw,
            "imu.rate_x": physical.angularRateRadS.pitch,
            "imu.rate_y": physical.angularRateRadS.yaw,
            "imu.rate_z": physical.angularRateRadS.roll,
          };
        for (const [bindingId, value] of program.tick(DT, values)) {
          const binding = outputBindings.find(
            (candidate) => candidate.id === bindingId,
          );
          assert.ok(binding, `controller wrote unknown binding ${bindingId}`);
          assert.equal(
            context.commandBus.writeScript(
              controller.id,
              binding.id,
              binding.endpointPartId,
              binding.channel,
              value,
            ),
            true,
          );
        }
      },
    },
    session = new SimulationSession({
      fixedDt: DT,
      systems: [
        controllerSystem,
        new PowerSystem(),
        new MechanismSystem(),
        new RotorPropulsionSystem(),
        new AerodynamicSystem(),
        new RigidBodySystem(),
        new MotorEnergySettlementSystem(),
        new StructureSystem(),
        new ThermalSystem(),
        new PhysicalAssemblySystem(),
        new PhysicalFlightTelemetrySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime,
      physicalAssemblyIndex,
      ...flightServices,
    });
  const batteryStartJ = session.context.runGraph.part(battery.id).energyJ,
    samples = [],
    mission = qualification.mission;
  let sawGround = false,
    clearanceTicks = 0,
    liftoffTick = null,
    airborneTicks = 0,
    batteryReserveAtAirborneLimit = null,
    firstLandingTick = null;
  try {
    for (let tick = 1; tick <= mission.totalTicks; tick++) {
      session.stepFixed();
      const onGround = groundContact(world, ground),
        state = primaryState(multibodyRuntime),
        propulsion = session.telemetry().systems.propulsion?.engines || [];
      if (process.env.SIM_ENDURANCE_TRACE && tick % 120 === 0)
        console.error(
          JSON.stringify({
            tick,
            onGround,
            state,
            commands: session.context.commandBus.entries().script,
            thrusts: propulsion.map((record) => record.thrustN),
          }),
        );
      sawGround ||= onGround;
      clearanceTicks =
        sawGround &&
        !onGround &&
        state.altitudeM >= mission.airborneAltitudeM.minimum
          ? clearanceTicks + 1
          : 0;
      if (
        liftoffTick == null &&
        clearanceTicks >= 30 &&
        state.verticalSpeedMps > 0
      )
        liftoffTick = tick;
      if (
        liftoffTick != null &&
        airborneTicks < mission.continuousAirborneTicks
      ) {
        assert.equal(
          onGround,
          false,
          `ground contact interrupted airborne qualification at tick ${tick}`,
        );
        inBand(
          state.altitudeM,
          mission.airborneAltitudeM,
          `airborne altitude at tick ${tick}`,
        );
        inBand(
          Math.abs(state.attitude.roll),
          mission.absoluteRollDeg,
          `absolute roll at tick ${tick}`,
        );
        inBand(
          Math.abs(state.attitude.pitch),
          mission.absolutePitchDeg,
          `absolute pitch at tick ${tick}`,
        );
        for (const rate of Object.values(state.angularRateRadS))
          inBand(
            Math.abs(rate),
            mission.absoluteAngularRateRadS,
            `absolute angular rate at tick ${tick}`,
          );
        airborneTicks++;
        if (airborneTicks === mission.continuousAirborneTicks)
          batteryReserveAtAirborneLimit = session.context.runGraph.part(
            battery.id,
          ).stateOfCharge;
      } else if (
        liftoffTick != null &&
        airborneTicks >= mission.continuousAirborneTicks &&
        onGround &&
        firstLandingTick == null
      )
        firstLandingTick = tick;
      assert.ok(
        propulsion.every((record) => record.valid !== false),
        `rotor operating envelope failed at tick ${tick}`,
      );
      assert.equal(
        session.context.runGraph.parts().some((part) => part.detached),
        false,
        `structural detachment at tick ${tick}: ${JSON.stringify({
          events: session.context.runGraph.events(),
          failedConnections: session.context.runGraph
            .connections()
            .filter((connection) => connection.failed),
          state,
        })}`,
      );
      assert.ok(
        Object.values({
          altitudeM: state.altitudeM,
          verticalSpeedMps: state.verticalSpeedMps,
          ...state.attitude,
          ...state.angularRateRadS,
        }).every(Number.isFinite),
        `non-finite flight state at tick ${tick}`,
      );
      if (tick % qualification.samplingCadenceTicks === 0)
        samples.push({
          tick,
          altitudeM: state.altitudeM,
          verticalSpeedMps: state.verticalSpeedMps,
          attitude: state.attitude,
          stateOfCharge: session.context.runGraph.part(battery.id)
            .stateOfCharge,
          thrustN: propulsion.reduce(
            (sum, record) => sum + Number(record.thrustN || 0),
            0,
          ),
        });
    }
    assert.ok(sawGround, "mission never established the initial ground state");
    assert.ok(liftoffTick != null, "mission never lifted from the ground");
    assert.ok(
      liftoffTick <= mission.takeoffDeadlineTick,
      `takeoff tick ${liftoffTick} exceeded ${mission.takeoffDeadlineTick}`,
    );
    assert.equal(airborneTicks, mission.continuousAirborneTicks);
    assert.ok(
      batteryReserveAtAirborneLimit >=
        mission.minimumBatteryReserveRatioAtAirborneLimit,
      `battery reserve ${batteryReserveAtAirborneLimit} is below the limit`,
    );
    assert.ok(
      firstLandingTick != null &&
        firstLandingTick <= mission.landingDeadlineTick,
      `landing did not complete by tick ${mission.landingDeadlineTick}`,
    );
    const batteryEndJ = session.context.runGraph.part(battery.id).energyJ,
      sourceEfficiency = battery.config.dischargeEfficiency,
      deliveredBusEnergyJ = (batteryStartJ - batteryEndJ) * sourceEfficiency,
      motorEnergyJ = session
        .telemetry()
        .systems.motorEnergy.totals.reduce(
          (sum, record) => sum + record.electricalEnergyJ,
          0,
        ),
      baselinePowerW = snapshot.parts.reduce((sum, part) => {
        if (part.type === "computer") return sum + 8;
        if (part.type === "imu" || part.type === "navsensor") return sum + 2;
        if (part.type === "receiver") return sum + 1;
        return sum;
      }, 0),
      expectedBusEnergyJ =
        motorEnergyJ + baselinePowerW * mission.totalTicks * DT,
      energyClosureJ = deliveredBusEnergyJ - expectedBusEnergyJ;
    assert.ok(
      Math.abs(energyClosureJ) <= qualification.tolerances.energyClosureJ,
      `electrical energy closure error ${energyClosureJ} J`,
    );
    return {
      liftoffTick,
      airborneTicks,
      firstLandingTick,
      batteryReserveAtAirborneLimit,
      batteryEndWh: session.context.runGraph.part(battery.id).energyWh,
      energyClosureJ,
      samples,
    };
  } finally {
    session.dispose();
    flightServices.physicalFlightModel.dispose();
    multibodyRuntime.dispose();
  }
}

const dynamometer = maximumPowerDynamometer(),
  mission = await flightMission();
console.log(
  JSON.stringify(
    {
      fixedStepS: DT,
      dynamometer,
      mission: {
        liftoffTick: mission.liftoffTick,
        continuousAirborneS: mission.airborneTicks * DT,
        firstLandingTick: mission.firstLandingTick,
        batteryReserveAtAirborneLimit: mission.batteryReserveAtAirborneLimit,
        batteryEndWh: mission.batteryEndWh,
        energyClosureJ: mission.energyClosureJ,
        sampleCount: mission.samples.length,
        peakAltitudeM: Math.max(
          ...mission.samples.map((sample) => sample.altitudeM),
        ),
        maximumAbsoluteRollDeg: Math.max(
          ...mission.samples.map((sample) => Math.abs(sample.attitude.roll)),
        ),
        maximumAbsolutePitchDeg: Math.max(
          ...mission.samples.map((sample) => Math.abs(sample.attitude.pitch)),
        ),
      },
    },
    null,
    2,
  ),
);
