import { compileAssembly } from "./assembly-compiler.js";
import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { canonicalQuaternion, rotateVectorByQuaternion } from "./primitives.js";
import { pressureNozzlePerformance } from "./pressure-nozzle-contracts.js";
import { orientedBoundsFor, orientedBoundsOverlap } from "./oriented-bounds.js";

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

export function displacedVolumeForPart(part, catalog) {
  return geometryDescriptorForPart(part, catalog).displacementM3;
}

export function analyzeAssembly(snapshot, catalog) {
  const parts = snapshot?.parts || [],
    connections = snapshot?.connections || [],
    partById = new Map(parts.map((part) => [part.id, part])),
    compiled = compileAssembly(snapshot, catalog),
    totalMass = compiled.bodies.reduce((sum, body) => sum + body.mass, 0),
    centerOfMass = compiled.bodies
      .reduce(
        (sum, body) => {
          const part = partById.get(body.partId),
            center = worldPoint(part, body.massProperties.comPositionPartM);
          return add(sum, scale(center, body.mass));
        },
        [0, 0, 0],
      )
      .map((value) => value / Math.max(0.001, totalMass)),
    displacedVolumeM3 = compiled.bodies.reduce(
      (sum, body) => sum + body.geometry.displacementM3,
      0,
    ),
    centerOfBuoyancy = compiled.bodies
      .reduce(
        (sum, body) => {
          const part = partById.get(body.partId),
            volume = body.geometry.displacementM3,
            center = worldPoint(part, body.geometry.renderDetailAnchors.center);
          return add(sum, scale(center, volume));
        },
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
      orientedBoundsFor(partById.get(body.partId), body.geometry),
    ),
    interferences = [];
  for (let a = 0; a < boxes.length; a++)
    for (let b = a + 1; b < boxes.length; b++) {
      if (connectedPairs.has([boxes[a].id, boxes[b].id].sort().join(":")))
        continue;
      if (orientedBoundsOverlap(boxes[a], boxes[b]))
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
