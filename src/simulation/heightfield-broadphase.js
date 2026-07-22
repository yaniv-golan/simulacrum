import { DomainValidationError, finiteNumber } from "../model/primitives.js";

/**
 * Builds a conservative AABB test for the workshop's Y-up heightfield frame.
 * Height samples advance along world +X and -Z from the supplied origin. The
 * test rejects only bodies whose complete world AABB is outside the sampled
 * footprint or strictly above/below every terrain vertex under that AABB.
 */
export function createYUpHeightfieldCandidateFilter({
  heights,
  elementSize,
  originX,
  originZ,
}) {
  if (
    !Array.isArray(heights) ||
    heights.length < 2 ||
    !Array.isArray(heights[0]) ||
    heights[0].length < 2 ||
    heights.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== heights[0].length ||
        row.some((height) => !Number.isFinite(height)),
    )
  )
    throw new DomainValidationError(
      "INVALID_HEIGHTFIELD_BROADPHASE_DATA",
      "Heightfield broadphase data must be a rectangular finite grid",
    );
  const spacing = finiteNumber(elementSize, {
      min: Number.EPSILON,
      path: ["elementSize"],
    }),
    worldOriginX = finiteNumber(originX, { path: ["originX"] }),
    worldOriginZ = finiteNumber(originZ, { path: ["originZ"] }),
    maximumX = heights.length - 1,
    maximumZ = heights[0].length - 1;

  return function heightfieldCandidate(otherBody) {
    if (!otherBody?.aabb)
      throw new DomainValidationError(
        "INVALID_HEIGHTFIELD_BROADPHASE_BODY",
        "Heightfield broadphase requires a body with a world AABB",
      );
    if (otherBody.aabbNeedsUpdate) otherBody.updateAABB();
    const { lowerBound, upperBound } = otherBody.aabb;
    if (
      upperBound.x < worldOriginX ||
      lowerBound.x > worldOriginX + maximumX * spacing ||
      upperBound.z < worldOriginZ - maximumZ * spacing ||
      lowerBound.z > worldOriginZ
    )
      return false;
    let minimumX = Math.floor((lowerBound.x - worldOriginX) / spacing) - 1,
      maximumBodyX = Math.ceil((upperBound.x - worldOriginX) / spacing) + 1,
      minimumZ = Math.floor((worldOriginZ - upperBound.z) / spacing) - 1,
      maximumBodyZ = Math.ceil((worldOriginZ - lowerBound.z) / spacing) + 1;
    if (
      maximumBodyX < 0 ||
      maximumBodyZ < 0 ||
      minimumX > maximumX ||
      minimumZ > maximumZ
    )
      return false;
    minimumX = Math.max(0, minimumX);
    maximumBodyX = Math.min(maximumX, maximumBodyX);
    minimumZ = Math.max(0, minimumZ);
    maximumBodyZ = Math.min(maximumZ, maximumBodyZ);
    let minimumHeight = Infinity,
      maximumHeight = -Infinity;
    for (let x = minimumX; x <= maximumBodyX; x++)
      for (let z = minimumZ; z <= maximumBodyZ; z++) {
        const height = heights[x][z];
        minimumHeight = Math.min(minimumHeight, height);
        maximumHeight = Math.max(maximumHeight, height);
      }
    return lowerBound.y <= maximumHeight && upperBound.y >= minimumHeight;
  };
}
