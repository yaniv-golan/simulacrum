import { TYPES } from "./component-catalog.js";
import { geometryDescriptorForPart } from "./geometry-descriptors.js";
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
  const frames = geometryDescriptorForPart(part, catalog).portFrames,
    entries = Object.entries(frames),
    mappings = [];
  for (const [sourcePort, sourceFrame] of entries) {
    const sourceDefinition = portDefinition(part, sourcePort, catalog),
      desiredPosition = reflected(sourceFrame.position, axis),
      desiredNormal = reflected(sourceFrame.normal || sourceFrame.axis, axis),
      desiredAxis = reflected(sourceFrame.axis || sourceFrame.normal, axis),
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
            distance(desiredPosition, targetFrame.position) +
            1 -
            Math.abs(
              normalizedDot(
                desiredNormal,
                targetFrame.normal || targetFrame.axis,
              ),
            ) +
            1 -
            Math.abs(
              normalizedDot(
                desiredAxis,
                targetFrame.axis || targetFrame.normal,
              ),
            ),
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
          normalizedDot(
            desiredAxis,
            target.targetFrame.axis || target.targetFrame.normal,
          ) < 0
            ? -1
            : 1,
        normalSign:
          normalizedDot(
            desiredNormal,
            target.targetFrame.normal || target.targetFrame.axis,
          ) < 0
            ? -1
            : 1,
      }),
    );
  }
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
