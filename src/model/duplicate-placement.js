import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { componentDefinition } from "./component-contracts.js";
import {
  AUTHORING_TRANSLATION_SNAP_M,
  AUTHORING_WORKSPACE_BOUNDS_WORLD_M,
} from "./authoring-space-policy.js";
import {
  orientedBoundsFor,
  orientedBoundsOverlap,
  orientedBoundsProjection,
  translateOrientedBounds,
} from "./oriented-bounds.js";

export const DUPLICATE_PLACEMENT_CLEARANCE_M = 0.025;
export const DUPLICATE_PLACEMENT_MAX_STEPS = 256;
const MAX_RECORDED_REJECTIONS = 16;

const finiteVector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry) => Number.isFinite(entry));

function quantizedPlanarDirection(vector) {
  if (!finiteVector(vector)) return null;
  const x = Number(vector[0]),
    z = Number(vector[2]);
  if (Math.hypot(x, z) <= 1e-7) return null;
  if (Math.abs(x) >= Math.abs(z)) return [Math.sign(x) || 1, 0, 0];
  return [0, 0, Math.sign(z) || 1];
}

function aggregateCenter(bounds) {
  return [0, 1, 2].map((axis) => {
    const direction = [0, 0, 0];
    direction[axis] = 1;
    const projections = bounds.map((entry) =>
      orientedBoundsProjection(entry, direction),
    );
    return (
      (Math.min(...projections.map((entry) => entry.minimum)) +
        Math.max(...projections.map((entry) => entry.maximum))) /
      2
    );
  });
}

function resolveDirection({ selectedIds, selectedBounds, intent }) {
  const hoveredFace = intent?.hoveredFace;
  if (
    hoveredFace &&
    selectedIds.has(hoveredFace.partId) &&
    finiteVector(hoveredFace.normalWorld)
  ) {
    const direction = quantizedPlanarDirection(hoveredFace.normalWorld);
    if (direction) return { strategy: "hover-face", direction };
  }

  const center = aggregateCenter(selectedBounds),
    cameraPosition = intent?.camera?.positionWorldM;
  if (finiteVector(cameraPosition)) {
    const towardCamera = cameraPosition.map(
        (value, axis) => value - center[axis],
      ),
      direction = quantizedPlanarDirection(towardCamera);
    if (direction) return { strategy: "toward-camera", direction };
  }

  const cameraRight = quantizedPlanarDirection(intent?.camera?.rightWorld);
  if (cameraRight)
    return { strategy: "camera-right-fallback", direction: cameraRight };
  return { strategy: "positive-x-fallback", direction: [1, 0, 0] };
}

function snappedOutward(value, snapM) {
  return Math.ceil((value - 1e-9) / snapM) * snapM;
}

function insideBounds(bounds, limit) {
  if (!limit) return true;
  return [0, 1, 2].every((axis) => {
    const minimum = limit.minimumM?.[axis],
      maximum = limit.maximumM?.[axis];
    if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) return true;
    const direction = [0, 0, 0];
    direction[axis] = 1;
    const projection = orientedBoundsProjection(bounds, direction);
    return (
      (!Number.isFinite(minimum) || projection.minimum >= minimum - 1e-9) &&
      (!Number.isFinite(maximum) || projection.maximum <= maximum + 1e-9)
    );
  });
}

function placementGeometryForPart(part, catalog) {
  const definition = componentDefinition(part, catalog),
    flexibleLine = definition?.flexibleLine;
  if (!flexibleLine) return geometryDescriptorForPart(part, catalog);
  const lengthM = Number(part.config?.lengthM ?? definition.lengthM),
    diameterM = Number(part.config?.diameterM ?? definition.diameterM),
    axis = flexibleLine.initialAxisPart;
  if (
    !(lengthM > 0) ||
    !(diameterM > 0) ||
    !finiteVector(axis) ||
    Math.hypot(...axis) <= 1e-7
  )
    throw new Error(`Flexible-line component ${part.id} has invalid geometry`);
  const magnitude = Math.hypot(...axis),
    dimensions = axis.map(
      (value) => (Math.abs(value) / magnitude) * lengthM + diameterM,
    );
  return { dimensions };
}

/**
 * Finds the first deterministic snapped, non-overlapping duplicate transform.
 * The result contains no meshes, camera objects, or mutable application state.
 */
export function planDuplicatePlacement({
  snapshot,
  catalog,
  selectedPartIds,
  intent = null,
  snapM = AUTHORING_TRANSLATION_SNAP_M,
  clearanceM = DUPLICATE_PLACEMENT_CLEARANCE_M,
  maxSteps = DUPLICATE_PLACEMENT_MAX_STEPS,
  boundsWorldM = AUTHORING_WORKSPACE_BOUNDS_WORLD_M,
}) {
  if (!(snapM > 0) || !(clearanceM >= 0) || !(maxSteps > 0))
    throw new Error("Duplicate placement policy must be finite and positive");
  const parts = snapshot?.parts || [],
    selectedIds = new Set(selectedPartIds || []),
    selectedParts = parts.filter((part) => selectedIds.has(part.id));
  if (!selectedParts.length)
    return {
      status: "rejected",
      reason: "no-selection",
      rejectedCandidates: [],
    };

  let allBounds;
  try {
    allBounds = parts.map((part) =>
      orientedBoundsFor(part, placementGeometryForPart(part, catalog)),
    );
  } catch (error) {
    return {
      status: "rejected",
      reason: "unsupported-geometry",
      message: error instanceof Error ? error.message : String(error),
      rejectedCandidates: [],
    };
  }
  const selectedBounds = allBounds.filter((bounds) =>
      selectedIds.has(bounds.id),
    ),
    // Test Reserve deployment can intentionally place an authored assembly
    // outside the workshop board. Preserve that coordinate space instead of
    // making a valid deployed assembly impossible to edit afterward.
    constrainToAuthoringBoard = selectedBounds.every((bounds) =>
      insideBounds(bounds, boundsWorldM),
    ),
    { strategy, direction } = resolveDirection({
      selectedIds,
      selectedBounds,
      intent,
    }),
    selectionProjection = selectedBounds.map((bounds) =>
      orientedBoundsProjection(bounds, direction),
    ),
    selectionExtent =
      Math.max(...selectionProjection.map((entry) => entry.maximum)) -
      Math.min(...selectionProjection.map((entry) => entry.minimum)),
    firstDistanceM = snappedOutward(selectionExtent + clearanceM, snapM),
    rejectedCandidates = [];
  let boundsBlocked = false;

  for (let stepIndex = 1; stepIndex <= maxSteps; stepIndex++) {
    const distanceM = firstDistanceM + (stepIndex - 1) * snapM,
      offsetWorldM = direction.map((value) => value * distanceM),
      candidateBounds = selectedBounds.map((bounds) =>
        translateOrientedBounds(bounds, offsetWorldM),
      ),
      outOfBounds =
        constrainToAuthoringBoard &&
        candidateBounds.some((bounds) => !insideBounds(bounds, boundsWorldM)),
      blockers = outOfBounds
        ? []
        : [
            ...new Set(
              candidateBounds.flatMap((candidate) =>
                allBounds
                  .filter((existing) =>
                    orientedBoundsOverlap(candidate, existing, {
                      allowedPenetrationM: 0,
                      minimumSeparationM: clearanceM,
                    }),
                  )
                  .map((existing) => existing.id),
              ),
            ),
          ].sort((left, right) => left - right);
    if (!outOfBounds && blockers.length === 0)
      return {
        status: "placed",
        strategy,
        directionWorld: direction,
        stepIndex,
        offsetWorldM,
        snapM,
        clearanceM,
        rejectedCandidates,
      };
    if (rejectedCandidates.length < MAX_RECORDED_REJECTIONS)
      rejectedCandidates.push({
        stepIndex,
        ...(outOfBounds ? { outOfBounds: true } : { blockerPartIds: blockers }),
      });
    if (outOfBounds) {
      boundsBlocked = true;
      break;
    }
  }

  return {
    status: "rejected",
    reason: boundsBlocked ? "no-in-bounds-position" : "no-clear-position",
    strategy,
    directionWorld: direction,
    snapM,
    clearanceM,
    rejectedCandidates,
  };
}
