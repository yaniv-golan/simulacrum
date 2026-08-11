import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import { primaryGeometryAxisPart } from "../model/component-geometry-contract.js";
import { portDefinition } from "../model/ports.js";
import { sensorDefinitionsForPart } from "../model/sensor-contracts.js";
import { componentHasControlContract } from "../model/component-contracts.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import { canonicalControllerBindings } from "../model/controller-bindings.js";
import { setControllerSensorFrame } from "../model/controller-sensor-frame-evidence.js";
import { finiteOr as finite } from "../model/finite-or.js";
import { standardAtmosphere } from "./environment/atmosphere.js";
import { quaternionToAircraftDegrees } from "./attitude-math.js";
import { observeContactNormalWrench } from "./contact-normal-wrench-observation.js";
import { measureEnvironmentProximity } from "./environment/environment-body-registry.js";

const vector = (value = {}) => ({
  x: finite(value.x),
  y: finite(value.y),
  z: finite(value.z),
});

function rotateVector(value, quaternion = {}) {
  const v = vector({ x: value[0], y: value[1], z: value[2] }),
    q = {
      x: finite(quaternion.x),
      y: finite(quaternion.y),
      z: finite(quaternion.z),
      w: finite(quaternion.w, 1),
    },
    tx = 2 * (q.y * v.z - q.z * v.y),
    ty = 2 * (q.z * v.x - q.x * v.z),
    tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function bodyIndexes(snapshot = {}) {
  return {
    byId: new Map((snapshot.bodies || []).map((body) => [body.bodyId, body])),
    byPart: new Map(
      (snapshot.bodyByPart || []).map((entry) => [entry.partId, entry.bodyId]),
    ),
  };
}

function bodySnapshotTick(snapshot = {}) {
  const tick = /** @type {any} */ (snapshot).tick;
  return Number.isSafeInteger(tick) && tick >= 0 ? tick : null;
}

function bodyForPart(partId, indexes) {
  const body = indexes.byId.get(indexes.byPart.get(partId));
  return body && body.bound && !body.detached ? body : null;
}

function endpointPort(connection, partId) {
  return connection.a === partId ? connection.portA : connection.portB;
}

function otherPartId(connection, partId) {
  return connection.a === partId ? connection.b : connection.a;
}

function fixedHostBody(sensor, partsById, connections, indexes) {
  const direct = bodyForPart(sensor.id, indexes);
  if (direct) return direct;
  const visited = new Set([sensor.id]),
    queue = [sensor.id];
  while (queue.length) {
    const currentId = queue.shift();
    for (const connection of connections) {
      if (
        connection.failed ||
        connection.kind !== "mechanical" ||
        (connection.a !== currentId && connection.b !== currentId)
      )
        continue;
      const current = partsById.get(currentId),
        neighborId = otherPartId(connection, currentId),
        neighbor = partsById.get(neighborId),
        currentPort = endpointPort(connection, currentId),
        neighborPort = endpointPort(connection, neighborId);
      if (!current || !neighbor || !currentPort || !neighborPort) continue;
      if (
        portDefinition(current, currentPort).behavior !== "fixed" ||
        portDefinition(neighbor, neighborPort).behavior !== "fixed"
      )
        continue;
      const body = bodyForPart(neighborId, indexes);
      if (body) return body;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }
  return null;
}

function shaftBody(sensor, partsById, connections, indexes) {
  const connection = connections.find(
    (candidate) =>
      !candidate.failed &&
      candidate.kind === "mechanical" &&
      (candidate.a === sensor.id || candidate.b === sensor.id) &&
      endpointPort(candidate, sensor.id) === "SHAFT",
  );
  if (!connection) return null;
  const partId = otherPartId(connection, sensor.id);
  return { body: bodyForPart(partId, indexes), part: partsById.get(partId) };
}

function sensorRoutesByController(signals = {}) {
  return new Map(
    (signals.controllerSensors || []).map((entry) => [
      entry.controllerId,
      new Map(
        (entry.endpoints || []).map((endpoint) => [
          endpoint.partId,
          new Set(endpoint.portIds || []),
        ]),
      ),
    ]),
  );
}

function valuesForSensor(sensor, context) {
  const {
      partsById,
      connections,
      indexes,
      fixedDt,
      previousVelocity,
      sampleWind,
      environmentBodies,
      compiledSensor,
      pneumatics,
      bodyTick,
    } = context,
    host = fixedHostBody(sensor, partsById, connections, indexes),
    pose = host?.pose || {},
    velocity = vector(host?.velocity),
    angularVelocity = vector(host?.angularVelocity),
    acceleration = host?.acceleration
      ? vector(host.acceleration)
      : {
          x:
            (velocity.x - finite(previousVelocity.x)) / Math.max(1e-9, fixedDt),
          y:
            (velocity.y - finite(previousVelocity.y)) / Math.max(1e-9, fixedDt),
          z:
            (velocity.z - finite(previousVelocity.z)) / Math.max(1e-9, fixedDt),
        },
    altitude = finite(pose.position?.y),
    atmosphere = standardAtmosphere(Math.max(0, altitude)),
    wind = vector(sampleWind?.(pose.position || {}, context.time) || {}),
    relativeAir = {
      x: velocity.x - wind.x,
      y: velocity.y - wind.y,
      z: velocity.z - wind.z,
    },
    airspeed = Math.hypot(relativeAir.x, relativeAir.y, relativeAir.z),
    attitude = quaternionToAircraftDegrees(pose.quaternion),
    contacts = host?.contacts || [],
    normalContactWrench = observeContactNormalWrench({
      contacts,
      pose,
      expectedTick: bodyTick,
    }),
    loads = host?.loads || [],
    peakLoad = loads.reduce(
      (maximum, load) => Math.max(maximum, finite(load.forceN)),
      0,
    ),
    ratedLoad = connections
      .filter(
        (connection) =>
          connection.a === sensor.id || connection.b === sensor.id,
      )
      .reduce(
        (minimum, connection) =>
          Math.min(
            minimum,
            Math.max(1, finite(connection.capacity?.ultimateForceN, Infinity)),
          ),
        Infinity,
      ),
    shaft = sensorDefinitionsForPart(sensor)?.some(
      (definition) => definition.key === "rotation_rpm",
    )
      ? shaftBody(sensor, partsById, connections, indexes)
      : null,
    shaftAxis = shaft?.part
      ? primaryGeometryAxisPart(geometryDescriptorForPart(shaft.part))
      : [0, 0, 1],
    worldAxis = rotateVector(
      shaftAxis,
      shaft?.body?.pose?.quaternion || { w: 1 },
    ),
    shaftAngular = vector(shaft?.body?.angularVelocity),
    rotationRpm =
      ((shaftAngular.x * worldAxis.x +
        shaftAngular.y * worldAxis.y +
        shaftAngular.z * worldAxis.z) *
        60) /
      (Math.PI * 2),
    temperatureK = finite(host?.thermal?.temperatureK, 293.15),
    heatFlux = finite(host?.thermal?.heatFluxWm2 ?? host?.thermal?.heatFlux),
    receiverState = (context.commandReceivers?.states || []).find(
      (state) => state.partId === sensor.id,
    ),
    commandFresh =
      receiverState?.valid === true &&
      Number.isSafeInteger(context.bodyTick) &&
      receiverState.tick === context.bodyTick,
    rangeContract = compiledSensor?.measurement,
    sensorAxis = rangeContract
      ? rotateVector(rangeContract.localAxisPart, pose.quaternion)
      : null,
    emitterOffset = rangeContract
      ? rotateVector(rangeContract.emitterOffsetPartM, pose.quaternion)
      : null,
    proximity = rangeContract
      ? measureEnvironmentProximity({
          sensorPose: {
            position: {
              x: finite(pose.position?.x) + emitterOffset.x,
              y: finite(pose.position?.y) + emitterOffset.y,
              z: finite(pose.position?.z) + emitterOffset.z,
            },
          },
          sensorVelocity: velocity,
          axis: sensorAxis,
          fieldOfViewDeg: rangeContract.fieldOfViewDeg,
          maximumRangeM: rangeContract.maximumRangeM,
          rangeResolutionM: rangeContract.rangeResolutionM,
          environmentBodies,
        })
      : null;
  const tirePressure = (pneumatics?.sensors || []).find(
      (measurement) =>
        measurement.partId === sensor.id && measurement.valid === true,
    ),
    requiresPneumaticBinding = compiledSensor?.readings?.includes(
      "tire_pressure_absolute_pa",
    );
  return {
    readingValidity: {
      command: commandFresh,
      contact_force_n: normalContactWrench.wrenchValid,
      contact_normal_force_part_x_n: normalContactWrench.wrenchValid,
      contact_normal_force_part_y_n: normalContactWrench.wrenchValid,
      contact_normal_force_part_z_n: normalContactWrench.wrenchValid,
      contact_normal_moment_part_x_nm: normalContactWrench.wrenchValid,
      contact_normal_moment_part_y_nm: normalContactWrench.wrenchValid,
      contact_normal_moment_part_z_nm: normalContactWrench.wrenchValid,
      contact_min_friction_coefficient: normalContactWrench.frictionValid,
      contact_resultant_point_world_x_m: normalContactWrench.pointContactValid,
      contact_resultant_point_world_y_m: normalContactWrench.pointContactValid,
      contact_resultant_point_world_z_m: normalContactWrench.pointContactValid,
      contact_resultant_normal_world_x: normalContactWrench.pointContactValid,
      contact_resultant_normal_world_y: normalContactWrench.pointContactValid,
      contact_resultant_normal_world_z: normalContactWrench.pointContactValid,
      contact_resultant_normal_force_n: normalContactWrench.pointContactValid,
    },
    bound:
      Boolean(host) && (!requiresPneumaticBinding || Boolean(tirePressure)),
    bodyId: host?.bodyId || null,
    rotation_rpm: rotationRpm,
    imu_roll_deg: attitude.roll,
    imu_pitch_deg: attitude.pitch,
    imu_yaw_deg: attitude.yaw,
    imu_rate_x: angularVelocity.x,
    imu_rate_y: angularVelocity.y,
    imu_rate_z: angularVelocity.z,
    imu_accel_x: acceleration.x,
    imu_accel_y: acceleration.y,
    imu_accel_z: acceleration.z,
    contact: contacts.length ? 1 : 0,
    contact_force_n: normalContactWrench.normalForceSumN,
    contact_normal_force_part_x_n: normalContactWrench.forcePartN.x,
    contact_normal_force_part_y_n: normalContactWrench.forcePartN.y,
    contact_normal_force_part_z_n: normalContactWrench.forcePartN.z,
    contact_normal_moment_part_x_nm: normalContactWrench.momentPartNm.x,
    contact_normal_moment_part_y_nm: normalContactWrench.momentPartNm.y,
    contact_normal_moment_part_z_nm: normalContactWrench.momentPartNm.z,
    contact_min_friction_coefficient:
      normalContactWrench.minimumFrictionCoefficient,
    contact_resultant_point_world_x_m: normalContactWrench.pointWorldM.x,
    contact_resultant_point_world_y_m: normalContactWrench.pointWorldM.y,
    contact_resultant_point_world_z_m: normalContactWrench.pointWorldM.z,
    contact_resultant_normal_world_x: normalContactWrench.normalWorld.x,
    contact_resultant_normal_world_y: normalContactWrench.normalWorld.y,
    contact_resultant_normal_world_z: normalContactWrench.normalWorld.z,
    contact_resultant_normal_force_n: normalContactWrench.normalForceSumN,
    water_contact: contacts.some((contact) =>
      String(contact.surface || "")
        .toLowerCase()
        .includes("water"),
    )
      ? 1
      : 0,
    temperature_c: temperatureK - 273.15,
    heat_flux_kw_m2: heatFlux / 1000,
    static_pressure_pa: atmosphere.pressure,
    dynamic_pressure_pa: 0.5 * atmosphere.density * airspeed ** 2,
    air_density: atmosphere.density,
    tire_pressure_absolute_pa: finite(tirePressure?.absolutePressurePa),
    tire_pressure_gauge_pa: finite(tirePressure?.gaugePressurePa),
    tire_gas_temperature_k: finite(tirePressure?.temperatureK),
    load_n: peakLoad,
    load_ratio: Number.isFinite(ratedLoad) ? peakLoad / ratedLoad : 0,
    command: commandFresh ? finite(receiverState.value) : 0,
    proximity_detected: proximity?.hit ? 1 : 0,
    proximity_range_m: finite(proximity?.rangeM),
    proximity_range_rate_mps: finite(proximity?.rangeRateMps),
    proximity_relative_velocity_x: finite(proximity?.relativeVelocityMps?.x),
    proximity_relative_velocity_y: finite(proximity?.relativeVelocityMps?.y),
    proximity_relative_velocity_z: finite(proximity?.relativeVelocityMps?.z),
    proximity,
    altitude,
    speed: Math.hypot(velocity.x, velocity.y, velocity.z),
    position_x: finite(pose.position?.x),
    position_z: finite(pose.position?.z),
    velocity_x: velocity.x,
    velocity_z: velocity.z,
    wind_x: wind.x,
    wind_z: wind.z,
    velocity,
  };
}

/** Reads only directed, component-bound sensors from completed telemetry. */
export class ControllerSensorBank {
  constructor() {
    this.previousVelocity = new Map();
  }

  capture({
    parts = [],
    connections = [],
    bodies = {},
    signals = {},
    commandReceivers = {},
    pneumatics = {},
    environmentBodies = null,
    compiledBodies = [],
    fixedDt = 1 / 120,
    time = 0,
    sampleWind = null,
  }) {
    const controllers = {},
      nextVelocity = new Map(),
      partsById = new Map(parts.map((part) => [part.id, part])),
      indexes = bodyIndexes(bodies),
      snapshotTick = bodySnapshotTick(bodies),
      compiledByPart = new Map(
        compiledBodies.map((body) => [body.partId, body.capabilities?.sensor]),
      ),
      routedSensors = sensorRoutesByController(signals);
    for (const controller of parts.filter((part) =>
      componentHasControlContract(part, "controller-target-v1"),
    )) {
      const readings = {},
        validity = {},
        provenance = [],
        routed = routedSensors.get(controller.id) || new Map(),
        valuesBySensor = new Map();
      for (const binding of canonicalControllerBindings(
        controller.controllerBindings,
      ).filter((candidate) => candidate.direction === "input")) {
        const reading = "reading" in binding ? binding.reading : "",
          sensor = partsById.get(binding.endpointPartId),
          routeOnline = Boolean(
            routed.get(binding.endpointPartId)?.has(binding.endpointPortId),
          ),
          definitions = sensorDefinitionsForPart(sensor),
          readingSupported = Boolean(
            definitions?.some((definition) => definition.key === reading),
          );
        let values = valuesBySensor.get(sensor?.id);
        if (sensor && routeOnline && readingSupported && !values) {
          values = valuesForSensor(sensor, {
            partsById,
            connections,
            indexes,
            fixedDt,
            time,
            sampleWind,
            commandReceivers,
            pneumatics,
            environmentBodies,
            compiledSensor: compiledByPart.get(sensor.id),
            bodyTick: snapshotTick,
            previousVelocity: this.previousVelocity.get(sensor.id) || {},
          });
          valuesBySensor.set(sensor.id, values);
          nextVelocity.set(sensor.id, values.velocity);
        }
        const readingEvidenceValid =
            values?.readingValidity?.[reading] !== false,
          valid = Boolean(
            routeOnline &&
            readingSupported &&
            values?.bound === true &&
            readingEvidenceValid,
          ),
          value = valid ? finite(values[reading]) : 0;
        readings[binding.id] = value;
        validity[binding.id] = valid ? 1 : 0;
        provenance.push({
          bindingId: binding.id,
          endpointPartId: binding.endpointPartId,
          endpointPortId: binding.endpointPortId,
          reading,
          bodyId: values?.bodyId || null,
          bound: Boolean(values?.bound),
          routeOnline,
          valid,
          value,
          hitBodyId: valid ? values?.proximity?.hitBodyId || null : null,
          rangeM: valid ? (values?.proximity?.rangeM ?? null) : null,
          rangeRateMps: valid
            ? (values?.proximity?.rangeRateMps ?? null)
            : null,
          relativeVelocityMps: valid
            ? values?.proximity?.relativeVelocityMps || null
            : null,
        });
      }
      readings.__bindings = provenance;
      readings.__validity = Object.freeze(validity);
      if (snapshotTick !== null) readings.__snapshotTick = snapshotTick;
      setControllerSensorFrame(controllers, controller.id, readings);
    }
    this.previousVelocity = nextVelocity;
    return controllers;
  }

  reset() {
    this.previousVelocity.clear();
  }

  exportState() {
    return issueInertPlainData(
      [...this.previousVelocity]
        .sort(([left], [right]) =>
          String(left).localeCompare(String(right), "en"),
        )
        .map(([sensorId, velocity]) => ({
          sensorId,
          velocity: structuredClone(velocity),
        })),
    );
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_SENSOR_CHECKPOINT_INPUT",
      message:
        "Sensor checkpoint must be serialized JSON or an exported immutable state",
    });
    if (!Array.isArray(state))
      throw new TypeError("sensor checkpoint must be an array");
    const velocities = new Map();
    for (const record of state) {
      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        Object.keys(record).sort().join("\0") !== "sensorId\0velocity" ||
        record.sensorId == null ||
        velocities.has(record.sensorId) ||
        !record.velocity ||
        typeof record.velocity !== "object" ||
        Array.isArray(record.velocity) ||
        Object.keys(record.velocity).sort().join("\0") !== "x\0y\0z" ||
        ["x", "y", "z"].some(
          (axis) =>
            typeof record.velocity[axis] !== "number" ||
            !Number.isFinite(record.velocity[axis]),
        )
      )
        throw new TypeError(
          "sensor checkpoint contains invalid velocity state",
        );
      velocities.set(record.sensorId, structuredClone(record.velocity));
    }
    return velocities;
  }

  importState(state) {
    this.previousVelocity = new Map(
      [...this.validateState(state)].map(([sensorId, velocity]) => [
        sensorId,
        vector(velocity),
      ]),
    );
  }
}
