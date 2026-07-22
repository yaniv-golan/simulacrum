import * as THREE from "three";

/**
 * @typedef {{ type:string, phase?:number }} DebugMachinePart
 * @typedef {{
 *   signedSpeed:number, pose:{position:{x:number,y:number,z:number}},
 *   velocity:{y:number}, edgeDistance:number, grounded:boolean,
 *   onPlatform:boolean, onField:boolean, inWater:boolean,
 *   bottomContact:boolean, wheelContacts:number, wheelStates?:Array<{normalLoadN:number}>,
 *   submergedFraction:number, displacedVolumeM3:number, buoyancyN:number,
 *   weightN:number, hydrodynamicDragN:number, waterDepth:number,
 *   surface:string, fallen:boolean,
 * }} DebugMobilityTelemetry
 * @typedef {{
 *   pose:{position:{x:number,y:number,z:number}},
 *   velocity:{x:number,y:number,z:number}, windVelocity:{x:number,y:number,z:number},
 *   relativeAirSpeed:number, rcsForceN?:number,
 *   materialResources?:{stores?:Array<{remainingMassKg:number}>},
 *   linearAcceleration:{x:number}, mach:number, airDensity:number,
 *   airPressurePa:number, dynamicPressure:number, dragN:number, cd:number,
 *   angleOfAttack:number, skinTempC:number, heatFlux:number, heatLoadMJ:number,
 *   thermalHealth:number, overheated:boolean,
 *   mass:number,
 *   angularVelocity:{z:number}, aerodynamicMomentNm:number, gimbalAngle:number,
 *   maxAttachmentLoadN:number, failedAttachments:unknown[], detachedParts:unknown[],
 *   propulsionActive:boolean,
 *   lastImpact?:{speedMps:number,impulseNs:number,peakSpeedMps:number,peakImpulseNs:number}|null,
 * }} DebugFlightTelemetry
 * @typedef {{
 *   kind:string|null, position:{x:number,y:number,z:number}, rotationY:number,
 *   parts:DebugMachinePart[],
 *   wheelCapable:boolean, mobility:{assemblies:DebugMobilityTelemetry[]}|null,
 *   flight:DebugFlightTelemetry|null, directControl:Record<string,unknown>,
 *   systems?:Record<string,unknown>,
 *   proximityMeasurements?:Array<object>, environmentBodies?:Array<object>,
 * }} MachineDebugInput
 */

const roundedRecord = (record = {}, precision = 2) =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      Number.isFinite(Number(value)) ? +Number(value).toFixed(precision) : null,
    ]),
  );

function distributedPropulsionDiagnostics(flight, systems = {}) {
  if (!flight) return null;
  const engines = systems.propulsion?.engines || [],
    points = engines
      .map((engine) => engine.applicationPointWorldM)
      .filter(
        (point) =>
          Number.isFinite(point?.x) &&
          Number.isFinite(point?.y) &&
          Number.isFinite(point?.z),
      ),
    span = (axis) =>
      points.length
        ? Math.max(...points.map((point) => point[axis])) -
          Math.min(...points.map((point) => point[axis]))
        : 0,
    distributed = engines.length >= 3 && Math.max(span("x"), span("z")) > 0.1,
    runtimes = systems.controllers?.runtimes || [],
    sensors = systems.sensors?.controllers || {};
  if (!distributed) return null;

  let controller = null,
    readings = null;
  for (const [controllerId, candidate] of Object.entries(sensors)) {
    const provenance = candidate?.__bindings || [],
      validReadings = new Map(
        provenance
          .filter((binding) => binding.valid)
          .map((binding) => [binding.reading, Number(binding.value)]),
      );
    if (
      ["imu_roll_deg", "imu_pitch_deg", "imu_yaw_deg"].every((reading) =>
        Number.isFinite(validReadings.get(reading)),
      )
    ) {
      controller = runtimes.find(
        (runtime) => String(runtime.controllerId) === String(controllerId),
      );
      readings = validReadings;
      break;
    }
  }
  const controllerReady = Boolean(controller?.powered && controller?.ready),
    scriptRouted = engines.every(
      (engine) => engine.commandSource === "script" || engine.detached,
    ),
    ready = controllerReady && scriptRouted;
  return {
    altitude: +flight.pose.position.y.toFixed(2),
    verticalSpeed: +flight.velocity.y.toFixed(2),
    horizontalVelocity: {
      x: +flight.velocity.x.toFixed(2),
      z: +flight.velocity.z.toFixed(2),
    },
    stabilizerReady: ready,
    status: !readings
      ? "valid routed IMU readings required"
      : !controllerReady
        ? "powered running controller required"
        : !scriptRouted
          ? "engine commands are not controller-routed"
          : "closed-loop attitude control online",
    commands: {
      collective:
        engines.reduce((sum, engine) => sum + Number(engine.throttle || 0), 0) /
        engines.length,
    },
    attitudeDeg: roundedRecord(
      {
        roll: readings?.get("imu_roll_deg"),
        pitch: readings?.get("imu_pitch_deg"),
        yaw: readings?.get("imu_yaw_deg"),
      },
      2,
    ),
    angularRateRadS: roundedRecord(
      {
        roll: readings?.get("imu_rate_z"),
        pitch: readings?.get("imu_rate_x"),
        yaw: readings?.get("imu_rate_y"),
      },
      3,
    ),
    motorThrustsN: engines.map(
      (engine) => +Number(engine.thrustN || 0).toFixed(1),
    ),
  };
}

/** Projects only valid environment-body fixes from completed sensor telemetry. */
export function projectProximityMeasurements(frame = {}) {
  return Object.values(frame.systems?.sensors?.controllers || {})
    .flatMap((controller) => controller.__bindings || [])
    .filter(
      (measurement) => measurement.valid && measurement.hitBodyId !== null,
    )
    .map((measurement) => ({
      sensorPartId: measurement.endpointPartId,
      hitBodyId: measurement.hitBodyId,
      rangeM: measurement.rangeM,
      rangeRateMps: measurement.rangeRateMps,
    }));
}

/** @param {MachineDebugInput} input */
export function buildMachineDebugReadModel(input) {
  const mobilityAssembly = input.mobility?.assemblies?.[0] || null,
    flight = input.flight,
    motor = input.parts.find((part) => part.type === "motor"),
    pinion = input.parts.find((part) => part.type === "gear12"),
    output = input.parts.find((part) => part.type === "gear24");
  return {
    kind: input.kind,
    position: {
      x: +input.position.x.toFixed(2),
      y: +input.position.y.toFixed(2),
      z: +input.position.z.toFixed(2),
    },
    rotationY: +input.rotationY.toFixed(2),
    velocity: +(
      mobilityAssembly?.signedSpeed ??
      flight?.velocity?.y ??
      0
    ).toFixed(2),
    environmentBodies: structuredClone(input.environmentBodies || []),
    proximityMeasurements: structuredClone(input.proximityMeasurements || []),
    seriesStage:
      { gearbox: 1, cart: 2, drone: 3, humanoid: 4, mission: 5 }[
        input.kind || ""
      ] || null,
    gearbox:
      input.kind === "gearbox"
        ? {
            motorPhase: +(motor?.phase || 0).toFixed(3),
            inputPhase: +(pinion?.phase || 0).toFixed(3),
            outputPhase: +(output?.phase || 0).toFixed(3),
            measuredRatio:
              Math.abs(output?.phase || 0) > 0.0001
                ? +Math.abs(
                    (pinion?.phase || 0) / (output?.phase || 1),
                  ).toFixed(3)
                : 0,
            oppositeRotation:
              Math.sign(pinion?.phase || 0) === -Math.sign(output?.phase || 0),
          }
        : undefined,
    mobility: input.wheelCapable
      ? {
          speed: +Math.abs(mobilityAssembly?.signedSpeed || 0).toFixed(2),
          signedSpeed: +(mobilityAssembly?.signedSpeed || 0).toFixed(2),
          direction:
            (mobilityAssembly?.signedSpeed || 0) < -0.08
              ? "reverse"
              : (mobilityAssembly?.signedSpeed || 0) > 0.08
                ? "forward"
                : "stopped",
          ...input.directControl,
          physics: mobilityAssembly
            ? {
                bodyY: +mobilityAssembly.pose.position.y.toFixed(2),
                verticalSpeed: +mobilityAssembly.velocity.y.toFixed(2),
                radius: +Math.hypot(
                  mobilityAssembly.pose.position.x,
                  mobilityAssembly.pose.position.z,
                ).toFixed(2),
                edgeDistance: +mobilityAssembly.edgeDistance.toFixed(2),
                grounded: mobilityAssembly.grounded,
                onPlatform: mobilityAssembly.onPlatform,
                onField: mobilityAssembly.onField,
                inWater: mobilityAssembly.inWater,
                bottomContact: mobilityAssembly.bottomContact,
                wheelContacts: mobilityAssembly.wheelContacts,
                normalLoadN: +(
                  mobilityAssembly.wheelStates?.reduce(
                    (sum, wheel) => sum + wheel.normalLoadN,
                    0,
                  ) || 0
                ).toFixed(1),
                submergedFraction:
                  +mobilityAssembly.submergedFraction.toFixed(3),
                displacedVolumeM3:
                  +mobilityAssembly.displacedVolumeM3.toFixed(4),
                buoyancyN: +mobilityAssembly.buoyancyN.toFixed(1),
                weightN: +mobilityAssembly.weightN.toFixed(1),
                hydrodynamicDragN:
                  +mobilityAssembly.hydrodynamicDragN.toFixed(1),
                waterDepth: +mobilityAssembly.waterDepth.toFixed(2),
                surface: mobilityAssembly.surface,
                fallen: mobilityAssembly.fallen,
              }
            : null,
        }
      : undefined,
    drone: distributedPropulsionDiagnostics(flight, input.systems),
    missile: flight
      ? {
          altitude: +flight.pose.position.y.toFixed(2),
          verticalSpeed: +flight.velocity.y.toFixed(2),
          horizontalSpeedX: +flight.velocity.x.toFixed(2),
          horizontalSpeedZ: +flight.velocity.z.toFixed(2),
          positionZ: +flight.pose.position.z.toFixed(2),
          windVelocity: {
            x: +flight.windVelocity.x.toFixed(2),
            y: +flight.windVelocity.y.toFixed(2),
            z: +flight.windVelocity.z.toFixed(2),
          },
          relativeAirSpeed: +flight.relativeAirSpeed.toFixed(2),
          rcsForceN: +(flight.rcsForceN || 0).toFixed(1),
          propellantRemainingKg: +(
            flight.materialResources?.stores?.reduce(
              (sum, store) => sum + Number(store.remainingMassKg || 0),
              0,
            ) || 0
          ).toFixed(3),
          lateralAcceleration: +flight.linearAcceleration.x.toFixed(2),
          mach: +flight.mach.toFixed(3),
          airDensity: +flight.airDensity.toFixed(4),
          airPressureKPa: +(flight.airPressurePa / 1000).toFixed(3),
          dynamicPressureKPa: +(flight.dynamicPressure / 1000).toFixed(3),
          dragN: +flight.dragN.toFixed(1),
          cd: +flight.cd.toFixed(3),
          angleOfAttackDeg: +THREE.MathUtils.radToDeg(
            flight.angleOfAttack,
          ).toFixed(2),
          skinTempC: +flight.skinTempC.toFixed(1),
          heatFluxKWm2: +(flight.heatFlux / 1000).toFixed(2),
          heatLoadMJ: +flight.heatLoadMJ.toFixed(3),
          thermalHealth: +flight.thermalHealth.toFixed(3),
          overheated: flight.overheated,
          massKg: +flight.mass.toFixed(2),
          angularVelocityZ: +flight.angularVelocity.z.toFixed(4),
          aerodynamicMomentNm: +flight.aerodynamicMomentNm.toFixed(1),
          gimbalAngleDeg: +THREE.MathUtils.radToDeg(flight.gimbalAngle).toFixed(
            2,
          ),
          maxAttachmentLoadN: +flight.maxAttachmentLoadN.toFixed(1),
          failedAttachments: structuredClone(flight.failedAttachments),
          detachedParts: structuredClone(flight.detachedParts),
          lastImpact: flight.lastImpact
            ? {
                speedMps: +flight.lastImpact.speedMps.toFixed(2),
                impulseNs: +flight.lastImpact.impulseNs.toFixed(1),
                peakSpeedMps: +flight.lastImpact.peakSpeedMps.toFixed(2),
                peakImpulseNs: +flight.lastImpact.peakImpulseNs.toFixed(1),
              }
            : null,
        }
      : undefined,
  };
}
