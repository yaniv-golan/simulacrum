import { environmentBodyDescriptor } from "../../model/environment-body-contracts.js";
import {
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  finiteVector3,
} from "../../model/primitives.js";

const identityQuaternion = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
/** @type {Readonly<{x:number,y:number,z:number}>} */
const zeroVector = Object.freeze({ x: 0, y: 0, z: 0 });
const vector = (value, path) => {
  const [x, y, z] = finiteVector3(
    Array.isArray(value) ? value : [value?.x, value?.y, value?.z],
    { path },
  );
  return { x, y, z };
};
const dot = (left, right) =>
  left.x * right.x + left.y * right.y + left.z * right.z;
const subtract = (left, right) => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
});
const normalize = (value) => {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 1e-12
    ? { x: value.x / length, y: value.y / length, z: value.z / length }
    : { x: 0, y: 0, z: 0 };
};

function canonicalSampledQuaternion(value, path) {
  const quaternion = {
      x: finiteNumber(value?.x ?? identityQuaternion.x, {
        path: [...path, "x"],
      }),
      y: finiteNumber(value?.y ?? identityQuaternion.y, {
        path: [...path, "y"],
      }),
      z: finiteNumber(value?.z ?? identityQuaternion.z, {
        path: [...path, "z"],
      }),
      w: finiteNumber(value?.w ?? identityQuaternion.w, {
        path: [...path, "w"],
      }),
    },
    magnitude = Math.hypot(
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    );
  if (Math.abs(magnitude - 1) > 1e-9)
    throw new DomainValidationError(
      "INVALID_ENVIRONMENT_BODY_ORIENTATION",
      "Environment body provider must return a unit quaternion",
      { path },
    );
  return quaternion;
}

function sampledState(descriptor, provider, time) {
  const provided = provider
      ? provider({ time, descriptor })
      : {
          pose: descriptor.pose,
          velocityMps: descriptor.velocityMps,
        },
    pose = provided?.pose || descriptor.pose;
  return {
    pose: {
      positionM: vector(pose.positionM, [
        "environmentBody",
        descriptor.id,
        "positionM",
      ]),
      orientation: canonicalSampledQuaternion(
        pose.orientation || descriptor.pose.orientation,
        ["environmentBody", descriptor.id, "orientation"],
      ),
    },
    velocityMps: vector(provided?.velocityMps || descriptor.velocityMps, [
      "environmentBody",
      descriptor.id,
      "velocityMps",
    ]),
  };
}

/**
 * Stable registry for queryable environment bodies. Providers own motion;
 * snapshots expose only strict, engine-neutral completed poses.
 */
export class EnvironmentBodyRegistry {
  #entries = new Map();

  constructor(entries = []) {
    for (const entry of entries)
      this.register(entry.descriptor || entry, entry.provider || null);
  }

  register(input, provider = null) {
    const descriptor = environmentBodyDescriptor(input);
    if (this.#entries.has(descriptor.id))
      throw new DomainValidationError(
        "DUPLICATE_ENVIRONMENT_BODY",
        `Environment body ${String(descriptor.id)} is already registered`,
      );
    if (provider !== null && typeof provider !== "function")
      throw new TypeError("Environment body provider must be a function");
    this.#entries.set(descriptor.id, { descriptor, provider });
    return descriptor;
  }

  descriptor(id) {
    return this.#entries.get(id)?.descriptor || null;
  }

  snapshot({ time = 0, origin = zeroVector } = {}) {
    const completedTime = finiteNumber(time, {
        min: 0,
        path: ["environmentBodies", "time"],
      }),
      localOrigin = vector(origin, ["environmentBodies", "origin"]),
      bodies = [...this.#entries.values()]
        .map(({ descriptor, provider }) => {
          const state = sampledState(descriptor, provider, completedTime),
            global = state.pose.positionM,
            position =
              descriptor.frame === "earth-tangent-global-v1"
                ? {
                    x: global.x - localOrigin.x,
                    y: global.y,
                    z: global.z - localOrigin.z,
                  }
                : global;
          return {
            id: descriptor.id,
            frame: descriptor.frame,
            geometry: descriptor.geometry,
            queryKinds: descriptor.queryKinds,
            pose: {
              position,
              orientation: state.pose.orientation,
            },
            velocityMps: state.velocityMps,
          };
        })
        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return deepFreeze({ schemaVersion: 1, time: completedTime, bodies });
  }
}

function quantize(value, resolution) {
  return Math.round(value / resolution) * resolution;
}

/**
 * Measures the nearest sphere surface intersecting a finite conical beam.
 * A body's edge may enter the beam even when its center lies outside it.
 */
export function measureEnvironmentProximity({
  sensorPose,
  sensorVelocity = zeroVector,
  axis,
  fieldOfViewDeg,
  maximumRangeM,
  rangeResolutionM,
  environmentBodies,
}) {
  const origin = vector(sensorPose?.position, ["proximity", "position"]),
    direction = normalize(vector(axis, ["proximity", "axis"])),
    velocity = vector(sensorVelocity, ["proximity", "velocity"]),
    halfAngle =
      (finiteNumber(fieldOfViewDeg, {
        min: Number.EPSILON,
        max: 179.999,
        path: ["proximity", "fieldOfViewDeg"],
      }) *
        Math.PI) /
      360,
    maximumRange = finiteNumber(maximumRangeM, {
      min: Number.EPSILON,
      path: ["proximity", "maximumRangeM"],
    }),
    resolution = finiteNumber(rangeResolutionM, {
      min: Number.EPSILON,
      path: ["proximity", "rangeResolutionM"],
    });
  if (Math.hypot(direction.x, direction.y, direction.z) < 0.5)
    throw new DomainValidationError(
      "INVALID_PROXIMITY_AXIS",
      "Proximity sensor axis must be nonzero",
    );
  let nearest = null;
  for (const body of environmentBodies?.bodies || []) {
    if (
      !body.queryKinds?.includes("sensing") ||
      body.geometry?.kind !== "sphere-v1"
    )
      continue;
    const relative = subtract(body.pose.position, origin),
      centerDistance = Math.hypot(relative.x, relative.y, relative.z),
      radius = finiteNumber(body.geometry.radiusM, {
        min: Number.EPSILON,
        path: ["environmentBodies", body.id, "radiusM"],
      });
    if (centerDistance - radius > maximumRange || centerDistance < 1e-12)
      continue;
    const centerDirection = normalize(relative),
      centerAngle = Math.acos(
        Math.max(-1, Math.min(1, dot(direction, centerDirection))),
      ),
      angularRadius = Math.asin(Math.min(1, radius / centerDistance)),
      rayOffset = Math.max(0, centerAngle - halfAngle);
    if (rayOffset > angularRadius) continue;
    const perpendicular = centerDistance * Math.sin(rayOffset),
      along = centerDistance * Math.cos(rayOffset),
      surfaceRange = Math.max(
        0,
        along - Math.sqrt(Math.max(0, radius ** 2 - perpendicular ** 2)),
      );
    if (surfaceRange > maximumRange) continue;
    const bodyVelocity = vector(body.velocityMps, [
        "environmentBodies",
        body.id,
        "velocityMps",
      ]),
      relativeVelocity = subtract(bodyVelocity, velocity),
      measurement = {
        hit: true,
        hitBodyId: body.id,
        rawRangeM: surfaceRange,
        rangeRateMps: dot(relativeVelocity, centerDirection),
        relativeVelocityMps: relativeVelocity,
      };
    if (
      !nearest ||
      measurement.rawRangeM < nearest.rawRangeM ||
      (measurement.rawRangeM === nearest.rawRangeM &&
        String(measurement.hitBodyId) < String(nearest.hitBodyId))
    )
      nearest = measurement;
  }
  return deepFreeze(
    nearest
      ? {
          hit: true,
          hitBodyId: nearest.hitBodyId,
          rangeM: Math.min(
            maximumRange,
            quantize(nearest.rawRangeM, resolution),
          ),
          rangeRateMps: nearest.rangeRateMps,
          relativeVelocityMps: nearest.relativeVelocityMps,
        }
      : {
          hit: false,
          hitBodyId: null,
          rangeM: maximumRange,
          rangeRateMps: 0,
          relativeVelocityMps: { x: 0, y: 0, z: 0 },
        },
  );
}
