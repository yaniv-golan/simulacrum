function rotateEuler(point, rotation) {
  const [x, y, z] = point,
    [rx, ry, rz] = rotation;
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz),
    x1 = x,
    y1 = y * cx - z * sx,
    z1 = y * sx + z * cx,
    x2 = x1 * cy + z1 * sy,
    y2 = y1,
    z2 = -x1 * sy + z1 * cy;
  return [x2 * cz - y2 * sz, x2 * sz + y2 * cz, z2];
}

function primitiveHalfSize(geometry) {
  if (geometry.kind === "box") return geometry.sizeM.map((size) => size / 2);
  if (geometry.kind === "cylinder") {
    const halfHeight = geometry.heightM / 2,
      radius = geometry.radiusM;
    if (geometry.axis === "x") return [halfHeight, radius, radius];
    if (geometry.axis === "z") return [radius, radius, halfHeight];
    return [radius, halfHeight, radius];
  }
  return [0, 0, 0];
}

function includeBounds(
  target,
  bounds,
  offsetM = [0, 0, 0],
  rotation = [0, 0, 0],
) {
  for (const x of [bounds.min[0], bounds.max[0]])
    for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = rotateEuler([x, y, z], rotation);
        for (let axis = 0; axis < 3; axis++) {
          const value = point[axis] + offsetM[axis];
          target.min[axis] = Math.min(target.min[axis], value);
          target.max[axis] = Math.max(target.max[axis], value);
        }
      }
}

/** Returns conservative local AABB bounds for explicit fixture collision geometry. */
export function testSiteCollisionGeometryBounds(geometry) {
  if (geometry.kind === "none")
    return Object.freeze({
      min: Object.freeze([0, 0, 0]),
      max: Object.freeze([0, 0, 0]),
    });
  if (geometry.kind !== "compound") {
    const half = primitiveHalfSize(geometry);
    return Object.freeze({
      min: Object.freeze(half.map((value) => -value)),
      max: Object.freeze([...half]),
    });
  }
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const child of geometry.children)
    includeBounds(
      bounds,
      testSiteCollisionGeometryBounds(child.geometry),
      child.offsetM,
      child.rotationEulerRad,
    );
  return Object.freeze({
    min: Object.freeze(bounds.min),
    max: Object.freeze(bounds.max),
  });
}

/** Derived visual/culling envelope; collision remains owned by the geometry union. */
export function testSiteFixtureEnvelopeSize(fixture) {
  const bounds = testSiteCollisionGeometryBounds(fixture.collisionGeometry);
  return Object.freeze(
    bounds.max.map((maximum, index) => maximum - bounds.min[index]),
  );
}

/** Conservative planar radius for strict clear-volume validation. */
export function testSiteFixturePlanarRadius(fixture) {
  const bounds = testSiteCollisionGeometryBounds(fixture.collisionGeometry);
  return Math.max(
    ...[bounds.min[0], bounds.max[0]].flatMap((x) =>
      [bounds.min[2], bounds.max[2]].map((z) => Math.hypot(x, z)),
    ),
  );
}

function fixtureWorldPoint(fixture, localX, localZ) {
  const heading = fixture.pose.headingRad,
    cosine = Math.cos(heading),
    sine = Math.sin(heading);
  return Object.freeze({
    x: fixture.pose.positionM[0] + localX * cosine - localZ * sine,
    z: fixture.pose.positionM[2] + localX * sine + localZ * cosine,
  });
}

/** Deterministic boundary samples for strict fixture/clear-volume validation. */
export function testSiteFixtureFootprintPoints(fixture, maximumStepM = 0.25) {
  const bounds = testSiteCollisionGeometryBounds(fixture.collisionGeometry),
    minX = bounds.min[0],
    maxX = bounds.max[0],
    minZ = bounds.min[2],
    maxZ = bounds.max[2],
    points = [];
  for (const [start, end] of [
    [
      [minX, minZ],
      [maxX, minZ],
    ],
    [
      [maxX, minZ],
      [maxX, maxZ],
    ],
    [
      [maxX, maxZ],
      [minX, maxZ],
    ],
    [
      [minX, maxZ],
      [minX, minZ],
    ],
  ]) {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]),
      steps = Math.max(1, Math.ceil(length / maximumStepM));
    for (let index = 0; index < steps; index++) {
      const amount = index / steps;
      points.push(
        fixtureWorldPoint(
          fixture,
          start[0] + (end[0] - start[0]) * amount,
          start[1] + (end[1] - start[1]) * amount,
        ),
      );
    }
  }
  points.push(fixtureWorldPoint(fixture, (minX + maxX) / 2, (minZ + maxZ) / 2));
  return Object.freeze(points);
}

/** True when a world x/z point lies in the fixture collision envelope. */
export function testSiteFixtureContainsPoint(fixture, x, z) {
  const dx = x - fixture.pose.positionM[0],
    dz = z - fixture.pose.positionM[2],
    cosine = Math.cos(fixture.pose.headingRad),
    sine = Math.sin(fixture.pose.headingRad),
    localX = dx * cosine + dz * sine,
    localZ = -dx * sine + dz * cosine,
    bounds = testSiteCollisionGeometryBounds(fixture.collisionGeometry);
  return (
    localX >= bounds.min[0] - 1e-9 &&
    localX <= bounds.max[0] + 1e-9 &&
    localZ >= bounds.min[2] - 1e-9 &&
    localZ <= bounds.max[2] + 1e-9
  );
}
