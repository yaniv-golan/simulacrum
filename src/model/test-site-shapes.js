const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function localPoint(shape, x, z) {
  const dx = x - shape.centerM[0],
    dz = z - shape.centerM[1],
    cosine = Math.cos(shape.rotationRad),
    sine = Math.sin(shape.rotationRad);
  return {
    x: dx * cosine + dz * sine,
    z: -dx * sine + dz * cosine,
  };
}

/** Deterministic containment/edge weight shared by site compilers and evaluators. */
export function testSiteShapeWeight(shape, x, z) {
  const point = localPoint(shape, x, z),
    halfX = shape.sizeM[0] / 2,
    halfZ = shape.sizeM[1] / 2;
  if (shape.kind === "rectangle")
    return Math.abs(point.x) <= halfX && Math.abs(point.z) <= halfZ ? 1 : 0;
  const radius = Math.hypot(point.x / halfX, point.z / halfZ);
  if (radius >= 1) return 0;
  const edge = 1 - clamp(radius, 0, 1) ** 2;
  return edge * edge;
}
