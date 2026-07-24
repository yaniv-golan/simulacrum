const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const EPSILON = 1e-9;

/** Converts a world x/z point into a shape's local coordinate frame. */
export function testSiteShapeLocalPoint(shape, x, z) {
  const dx = x - shape.centerM[0],
    dz = z - shape.centerM[1],
    cosine = Math.cos(shape.rotationRad),
    sine = Math.sin(shape.rotationRad);
  return {
    x: dx * cosine + dz * sine,
    z: -dx * sine + dz * cosine,
  };
}

/** Converts a shape-local x/z point into world coordinates. */
export function testSiteShapeWorldPoint(shape, point) {
  const cosine = Math.cos(shape.rotationRad),
    sine = Math.sin(shape.rotationRad);
  return {
    x: shape.centerM[0] + point[0] * cosine - point[1] * sine,
    z: shape.centerM[1] + point[0] * sine + point[1] * cosine,
  };
}

function segmentDistance(point, start, end) {
  const dx = end[0] - start[0],
    dz = end[1] - start[1],
    lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= EPSILON)
    return Math.hypot(point.x - start[0], point.z - start[1]);
  const amount = clamp(
    ((point.x - start[0]) * dx + (point.z - start[1]) * dz) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (start[0] + dx * amount),
    point.z - (start[1] + dz * amount),
  );
}

function ringContains(ring, point) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const start = ring[previous],
      end = ring[index],
      distance = segmentDistance(point, start, end);
    if (distance <= EPSILON) return true;
    if (
      start[1] > point.z !== end[1] > point.z &&
      point.x <
        ((end[0] - start[0]) * (point.z - start[1])) / (end[1] - start[1]) +
          start[0]
    )
      inside = !inside;
  }
  return inside;
}

function ringArea(ring) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index],
      next = ring[(index + 1) % ring.length];
    twiceArea += current[0] * next[1] - next[0] * current[1];
  }
  return twiceArea / 2;
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point, start, end) {
  return (
    Math.abs(orientation(start, end, point)) <= EPSILON &&
    point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON
  );
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c),
    abD = orientation(a, b, d),
    cdA = orientation(c, d, a),
    cdB = orientation(c, d, b);
  if (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  )
    return true;
  return (
    (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d))
  );
}

function ringSelfIntersects(ring) {
  for (let first = 0; first < ring.length; first++)
    for (let second = first + 1; second < ring.length; second++) {
      const adjacent =
        first === second ||
        (first + 1) % ring.length === second ||
        first === (second + 1) % ring.length;
      if (
        !adjacent &&
        segmentsIntersect(
          ring[first],
          ring[(first + 1) % ring.length],
          ring[second],
          ring[(second + 1) % ring.length],
        )
      )
        return true;
    }
  return false;
}

function ringsIntersect(left, right) {
  return left.some((start, leftIndex) =>
    right.some((otherStart, rightIndex) =>
      segmentsIntersect(
        start,
        left[(leftIndex + 1) % left.length],
        otherStart,
        right[(rightIndex + 1) % right.length],
      ),
    ),
  );
}

/** Returns the first strict polygon-ring contract violation, or null. */
export function testSitePolygonRingsIssue(rings) {
  if (!rings.length) return "missing-outer-ring";
  if (
    rings.some(
      (ring) => Math.abs(ringArea(ring)) < 0.01 || ringSelfIntersects(ring),
    )
  )
    return "invalid-ring";
  if (ringArea(rings[0]) <= 0) return "outer-winding";
  for (let index = 1; index < rings.length; index++)
    if (
      ringArea(rings[index]) >= 0 ||
      !ringContains(rings[0], {
        x: rings[index][0][0],
        z: rings[index][0][1],
      }) ||
      ringsIntersect(rings[0], rings[index]) ||
      rings.slice(1, index).some(
        (ring) =>
          ringsIntersect(ring, rings[index]) ||
          ringContains(ring, {
            x: rings[index][0][0],
            z: rings[index][0][1],
          }) ||
          ringContains(rings[index], { x: ring[0][0], z: ring[0][1] }),
      )
    )
      return "invalid-hole";
  return null;
}

function polygonContains(shape, point) {
  return (
    ringContains(shape.ringsM[0], point) &&
    !shape.ringsM.slice(1).some((ring) => ringContains(ring, point))
  );
}

function polygonEdgeDistance(shape, point) {
  let distance = Infinity;
  for (const ring of shape.ringsM)
    for (let index = 0; index < ring.length; index++)
      distance = Math.min(
        distance,
        segmentDistance(point, ring[index], ring[(index + 1) % ring.length]),
      );
  return distance;
}

function rectangleSignedDistance(point, halfX, halfZ) {
  const dx = Math.abs(point.x) - halfX,
    dz = Math.abs(point.z) - halfZ;
  return (
    Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
  );
}

function segmentRectangleSignedDistance(point, start, end, halfWidth) {
  const dx = end[0] - start[0],
    dz = end[1] - start[1],
    length = Math.hypot(dx, dz),
    centerX = (start[0] + end[0]) / 2,
    centerZ = (start[1] + end[1]) / 2,
    along = ((point.x - centerX) * dx + (point.z - centerZ) * dz) / length,
    across = ((point.x - centerX) * -dz + (point.z - centerZ) * dx) / length;
  return rectangleSignedDistance(
    { x: along, z: across },
    length / 2 + halfWidth,
    halfWidth,
  );
}

function corridorSignedDistance(shape, point) {
  const halfWidth = shape.widthM / 2;
  let distance = Infinity;
  for (const path of shape.pathsM)
    for (let index = 0; index < path.length - 1; index++) {
      const segment =
        shape.cap === "square"
          ? segmentRectangleSignedDistance(
              point,
              path[index],
              path[index + 1],
              halfWidth,
            )
          : segmentDistance(point, path[index], path[index + 1]) - halfWidth;
      distance = Math.min(distance, segment);
    }
  return distance;
}

/**
 * Signed distance in metres: negative inside, zero at the boundary, positive
 * outside. This is the shared authority for clearances, shores and shoulders.
 */
export function testSiteShapeSignedDistance(shape, x, z) {
  const point = testSiteShapeLocalPoint(shape, x, z);
  if (shape.kind === "rectangle")
    return rectangleSignedDistance(
      point,
      shape.sizeM[0] / 2,
      shape.sizeM[1] / 2,
    );
  if (shape.kind === "ellipse") {
    const radiusX = shape.sizeM[0] / 2,
      radiusZ = shape.sizeM[1] / 2,
      normalizedRadius = Math.hypot(point.x / radiusX, point.z / radiusZ);
    return (normalizedRadius - 1) * Math.min(radiusX, radiusZ);
  }
  if (shape.kind === "polygon") {
    const distance = polygonEdgeDistance(shape, point);
    return polygonContains(shape, point) ? -distance : distance;
  }
  if (shape.kind === "corridor-network")
    return corridorSignedDistance(shape, point);
  return Infinity;
}

/** Deterministic containment shared by site compilers and evaluators. */
export function testSiteShapeContains(shape, x, z, marginM = 0) {
  return testSiteShapeSignedDistance(shape, x, z) <= marginM + EPSILON;
}

/**
 * Terrain-profile weight retained as a distinct query from containment.
 * Ellipses keep the released smooth mound profile; other shapes are binary.
 */
export function testSiteShapeWeight(shape, x, z) {
  if (shape.kind !== "ellipse")
    return testSiteShapeContains(shape, x, z) ? 1 : 0;
  const point = testSiteShapeLocalPoint(shape, x, z),
    halfX = shape.sizeM[0] / 2,
    halfZ = shape.sizeM[1] / 2,
    radius = Math.hypot(point.x / halfX, point.z / halfZ);
  if (radius >= 1) return 0;
  const edge = 1 - clamp(radius, 0, 1) ** 2;
  return edge * edge;
}

/** World-space bounds used by validators, maps and spatial indexing. */
export function testSiteShapeBounds(shape) {
  let localPoints;
  if (shape.kind === "rectangle" || shape.kind === "ellipse") {
    const halfX = shape.sizeM[0] / 2,
      halfZ = shape.sizeM[1] / 2;
    localPoints = [
      [-halfX, -halfZ],
      [halfX, -halfZ],
      [halfX, halfZ],
      [-halfX, halfZ],
    ];
  } else if (shape.kind === "polygon") localPoints = shape.ringsM.flat();
  else {
    const halfWidth = shape.widthM / 2;
    localPoints = shape.pathsM.flat().flatMap(([x, z]) => [
      [x - halfWidth, z - halfWidth],
      [x + halfWidth, z + halfWidth],
    ]);
  }
  const points = localPoints.map((point) =>
    testSiteShapeWorldPoint(shape, point),
  );
  return Object.freeze({
    minX: Math.min(...points.map(({ x }) => x)),
    maxX: Math.max(...points.map(({ x }) => x)),
    minZ: Math.min(...points.map(({ z }) => z)),
    maxZ: Math.max(...points.map(({ z }) => z)),
  });
}
