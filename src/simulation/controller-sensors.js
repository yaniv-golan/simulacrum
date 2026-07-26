import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import { primaryGeometryAxisPart } from "../model/component-geometry-contract.js";
import { portDefinition } from "../model/ports.js";
import { sensorDefinitionsForPart } from "../model/sensor-contracts.js";
import { componentHasControlContract } from "../model/component-contracts.js";
import { canonicalControllerBindings } from "../model/controller-bindings.js";
import { finiteOr as finite } from "../model/finite-or.js";
import { standardAtmosphere } from "./environment/atmosphere.js";
import { quaternionToAircraftDegrees } from "./attitude-math.js";
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
  return {
    bound: Boolean(host),
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
    contact_force_n: contacts.reduce(
      (sum, contact) => sum + finite(contact.forceN),
      0,
    ),
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
    load_n: peakLoad,
    load_ratio: Number.isFinite(ratedLoad) ? peakLoad / ratedLoad : 0,
    command: receiverState?.valid ? finite(receiverState.value) : 0,
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
      compiledByPart = new Map(
        compiledBodies.map((body) => [body.partId, body.capabilities?.sensor]),
      ),
      routedSensors = sensorRoutesByController(signals);
    for (const controller of parts.filter((part) =>
      componentHasControlContract(part, "controller-target-v1"),
    )) {
      const readings = {},
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
            environmentBodies,
            compiledSensor: compiledByPart.get(sensor.id),
            previousVelocity: this.previousVelocity.get(sensor.id) || {},
          });
          valuesBySensor.set(sensor.id, values);
          nextVelocity.set(sensor.id, values.velocity);
        }
        const valid = Boolean(
            routeOnline && readingSupported && values?.bound === true,
          ),
          value = valid ? finite(values[reading]) : 0;
        readings[binding.id] = value;
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
      controllers[controller.id] = readings;
    }
    this.previousVelocity = nextVelocity;
    return controllers;
  }

  reset() {
    this.previousVelocity.clear();
  }

  exportState() {
    return [...this.previousVelocity]
      .sort(([left], [right]) =>
        String(left).localeCompare(String(right), "en"),
      )
      .map(([sensorId, velocity]) => ({
        sensorId,
        velocity: structuredClone(velocity),
      }));
  }

  importState(state) {
    if (!Array.isArray(state))
      throw new TypeError("sensor checkpoint must be an array");
    this.previousVelocity = new Map(
      state.map((record) => [record.sensorId, vector(record.velocity)]),
    );
  }
}
