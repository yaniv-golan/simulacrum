import { TYPES } from "./component-catalog.js";
import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { portAxisPart } from "./component-geometry-contract.js";
import { portDefinition } from "./ports.js";

const EPSILON = 1e-8;

function reflected(vector, axis) {
  return vector.map((value, index) => (index === axis ? -value : value));
}

function distance(left, right) {
  return Math.hypot(...left.map((value, index) => value - right[index]));
}

function normalizedDot(left, right) {
  const leftLength = Math.hypot(...left),
    rightLength = Math.hypot(...right);
  if (leftLength <= EPSILON || rightLength <= EPSILON) return 1;
  return (
    left.reduce((sum, value, index) => sum + value * right[index], 0) /
    (leftLength * rightLength)
  );
}

/**
 * Derives a mirror mapping from declared local frames and port contracts.
 * Port names never imply symmetry. Coordinate signs are reported explicitly.
 */
function deriveForAxis(part, axis, catalog) {
  const geometry = geometryDescriptorForPart(part, catalog),
    frames = geometry.portFrames,
    entries = Object.entries(frames),
    mappings = [];
  for (const [sourcePort, sourceFrame] of entries) {
    const sourceDefinition = portDefinition(part, sourcePort, catalog),
      sourceAxis = portAxisPart(sourceFrame),
      desiredPosition = reflected(sourceFrame.framePart.positionM, axis),
      desiredAxis = reflected(sourceAxis, axis),
      candidates = entries
        .filter(([targetPort]) => {
          const targetDefinition = portDefinition(part, targetPort, catalog);
          return (
            targetDefinition.kind === sourceDefinition.kind &&
            targetDefinition.behavior === sourceDefinition.behavior &&
            targetDefinition.direction === sourceDefinition.direction &&
            targetDefinition.multiplicity === sourceDefinition.multiplicity
          );
        })
        .map(([targetPort, targetFrame]) => ({
          targetPort,
          targetFrame,
          score:
            distance(desiredPosition, targetFrame.framePart.positionM) +
            1 -
            Math.abs(normalizedDot(desiredAxis, portAxisPart(targetFrame))),
        }))
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.targetPort.localeCompare(right.targetPort),
        );
    if (!candidates.length || candidates[0].score > EPSILON)
      throw new Error(
        `Part ${part.id} port ${sourcePort} has no declared reflection-symmetric endpoint`,
      );
    if (
      candidates[1] &&
      Math.abs(candidates[1].score - candidates[0].score) <= EPSILON
    )
      throw new Error(
        `Part ${part.id} port ${sourcePort} has ambiguous reflection symmetry`,
      );
    const target = candidates[0];
    mappings.push(
      Object.freeze({
        sourcePort,
        targetPort: target.targetPort,
        coordinateSign:
          normalizedDot(desiredAxis, portAxisPart(target.targetFrame)) < 0
            ? -1
            : 1,
      }),
    );
  }
  for (const [portId, classification] of Object.entries(geometry.portClasses))
    if (classification === "network-only")
      mappings.push(
        Object.freeze({
          sourcePort: portId,
          targetPort: portId,
          coordinateSign: 1,
        }),
      );
  return Object.freeze({
    localReflectionPlane: axis === 0 ? "YZ" : axis === 1 ? "XZ" : "XY",
    localReflectionAxis: axis,
    handedness: "reflection-restored-to-right-handed-frame",
    ports: Object.freeze(mappings),
    portMap: Object.freeze(
      Object.fromEntries(
        mappings.map((mapping) => [mapping.sourcePort, mapping]),
      ),
    ),
  });
}

/** @param {any} part @param {{axis?: number|null, catalog?: Record<string, any>}} [options] */
export function derivePortReflectionMap(
  part,
  { axis = null, catalog = TYPES } = {},
) {
  if (axis !== null && ![0, 1, 2].includes(axis))
    throw new Error("Reflection axis must be 0, 1 or 2");
  const axes = axis === null ? [0, 1, 2] : [axis],
    errors = [];
  for (const candidateAxis of axes)
    try {
      return deriveForAxis(part, candidateAxis, catalog);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  throw new Error(
    `Part ${part.id} has no declared reflection symmetry (${errors.join("; ")})`,
  );
}
