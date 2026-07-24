import { compileAssembly } from "./assembly-compiler.js";
import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { canonicalQuaternion, rotateVectorByQuaternion } from "./primitives.js";
import { pressureNozzlePerformance } from "./pressure-nozzle-contracts.js";
import { componentDefinition } from "./component-contracts.js";

const add = (a, b) => a.map((value, axis) => value + b[axis]);
const scale = (vector, scalar) => vector.map((value) => value * scalar);
const length = (vector) => Math.hypot(...vector);
const normalize = (vector) => {
  const magnitude = length(vector);
  return magnitude > 1e-9 ? scale(vector, 1 / magnitude) : [0, 1, 0];
};

/** @param {number[]} quaternion */
function quaternionMatrix(quaternion) {
  const [x, y, z, w] = quaternion;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function orientationMatrix(part) {
  return quaternionMatrix(canonicalQuaternion(part.orientation));
}

function transformDirection(matrix, vector) {
  return matrix.map((row) =>
    row.reduce((sum, value, i) => sum + value * vector[i], 0),
  );
}

function worldPoint(part, localPoint) {
  const offset = rotateVectorByQuaternion(
    localPoint,
    canonicalQuaternion(part.orientation),
  );
  return part.pos.map((value, axis) => value + offset[axis]);
}

function obbFor(part, geometry) {
  const matrix = orientationMatrix(part);
  return {
    id: part.id,
    center: worldPoint(part, geometry.renderDetailAnchors.center),
    half: geometry.dimensions.map((value) => Math.max(0.01, value / 2)),
    axes: [0, 1, 2].map((column) => matrix.map((row) => row[column])),
  };
}

function projectionRadius(box, axis) {
  return box.axes.reduce(
    (sum, basis, index) =>
      sum +
      box.half[index] *
        Math.abs(basis.reduce((dot, value, i) => dot + value * axis[i], 0)),
    0,
  );
}

function overlaps(a, b, tolerance = 0.025) {
  const delta = b.center.map((value, axis) => value - a.center[axis]),
    axes = [...a.axes, ...b.axes];
  for (const left of a.axes)
    for (const right of b.axes) {
      const cross = [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
      ];
      if (length(cross) > 1e-7) axes.push(normalize(cross));
    }
  return axes.every((axis) => {
    const distance = Math.abs(
      delta.reduce((dot, value, i) => dot + value * axis[i], 0),
    );
    return (
      distance + tolerance <
      projectionRadius(a, axis) + projectionRadius(b, axis)
    );
  });
}

export function displacedVolumeForPart(part, catalog) {
  if (componentDefinition(part, catalog)?.flexibleLine) {
    const config = part.config || {},
      radiusM = Number(config.diameterM) / 2;
    return Math.PI * radiusM * radiusM * Number(config.lengthM);
  }
  return geometryDescriptorForPart(part, catalog).displacementM3;
}

export function analyzeAssembly(snapshot, catalog) {
  const parts = snapshot?.parts || [],
    connections = snapshot?.connections || [],
    partById = new Map(parts.map((part) => [part.id, part])),
    compiled = compileAssembly(snapshot, catalog),
    flexibleMassPoints = (compiled.flexibleLines || []).flatMap((line) =>
      line.entities.map((entity) => ({
        mass: entity.massKg,
        center: entity.positionWorldM,
      })),
    ),
    rigidMassPoints = compiled.bodies.map((body) => {
      const part = partById.get(body.partId);
      return {
        mass: body.mass,
        center: worldPoint(part, body.massProperties.comPositionPartM),
      };
    }),
    massPoints = [...rigidMassPoints, ...flexibleMassPoints],
    totalMass = massPoints.reduce((sum, point) => sum + point.mass, 0),
    centerOfMass = massPoints
      .reduce(
        (sum, point) => add(sum, scale(point.center, point.mass)),
        [0, 0, 0],
      )
      .map((value) => value / Math.max(0.001, totalMass)),
    flexibleVolumes = (compiled.flexibleLines || []).map((line) => ({
      volume: Math.PI * (line.diameterM / 2) ** 2 * line.lengthM,
      center: line.entities
        .reduce((sum, entity) => add(sum, entity.positionWorldM), [0, 0, 0])
        .map((value) => value / line.entities.length),
    })),
    rigidVolumes = compiled.bodies.map((body) => {
      const part = partById.get(body.partId);
      return {
        volume: body.geometry.displacementM3,
        center: worldPoint(part, body.geometry.renderDetailAnchors.center),
      };
    }),
    volumePoints = [...rigidVolumes, ...flexibleVolumes],
    displacedVolumeM3 = volumePoints.reduce(
      (sum, point) => sum + point.volume,
      0,
    ),
    centerOfBuoyancy = volumePoints
      .reduce(
        (sum, point) => add(sum, scale(point.center, point.volume)),
        [0, 0, 0],
      )
      .map((value) => value / Math.max(0.000001, displacedVolumeM3)),
    engines = compiled.bodies
      .filter(
        (body) => body.capabilities.propulsion?.kind === "pressure-nozzle-v1",
      )
      .map((body) => {
        const part = partById.get(body.partId),
          propulsion = body.capabilities.propulsion,
          forceN = pressureNozzlePerformance(
            propulsion,
            propulsion.maximumMassFlowKgS,
            101_325,
          ).thrustN,
          direction = normalize(
            transformDirection(orientationMatrix(part), propulsion.localAxis),
          );
        return { partId: part.id, origin: [...part.pos], direction, forceN };
      }),
    thrustVector = engines.reduce(
      (sum, engine) => add(sum, scale(engine.direction, engine.forceN)),
      [0, 0, 0],
    ),
    thrustForceN = length(thrustVector),
    thrustOrigin = engines.length
      ? engines
          .reduce(
            (sum, engine) => add(sum, scale(engine.origin, engine.forceN)),
            [0, 0, 0],
          )
          .map(
            (value) =>
              value /
              Math.max(
                0.001,
                engines.reduce((sum, engine) => sum + engine.forceN, 0),
              ),
          )
      : [0, 0, 0],
    connectedPairs = new Set(
      connections
        .filter(
          (connection) =>
            !connection.failed &&
            ["mechanical", "mesh"].includes(connection.kind),
        )
        .map((connection) => [connection.a, connection.b].sort().join(":")),
    ),
    boxes = compiled.bodies.map((body) =>
      obbFor(partById.get(body.partId), body.geometry),
    ),
    interferences = [];
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++) {
      if (connectedPairs.has([boxes[a].id, boxes[b].id].sort().join(":")))
        continue;
      if (overlaps(boxes[a], boxes[b]))
        interferences.push({ a: boxes[a].id, b: boxes[b].id });
    }
  return {
    totalMass,
    centerOfMass,
    displacedVolumeM3,
    centerOfBuoyancy,
    thrust: {
      engines,
      origin: thrustOrigin,
      direction: thrustForceN > 0 ? normalize(thrustVector) : [0, 1, 0],
      forceN: thrustForceN,
    },
    interferences,
  };
}
