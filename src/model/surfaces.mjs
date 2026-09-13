import { partPrimitives, CYLINDER_SEGMENTS, shaftSegments } from './geometry.mjs';
import { CATALOG } from './catalog.mjs';
import { sceneObjectDescriptors } from './environment.mjs';
import { normalizeQuaternion, multiplyQuaternion, rotateVector } from './transforms.mjs';
export { multiplyQuaternion, rotateVector } from './transforms.mjs';
// M3b planar mounting. Frames use X outward, Y along u, Z along v; SI metres/radians.
export const SURFACE_REASON_CODES = Object.freeze([
  'UNKNOWN_SURFACE',
  'SURFACE_OUT_OF_BOUNDS',
  'SURFACE_OVERLAP',
  'MOUNT_HELD_BY_ANOTHER_CONNECTION',
  'STALE_PROPOSAL',
]);
function reject(reasonCode) {
  throw Object.assign(Error(reasonCode), { reasonCode, path: 'surface' });
}
export function surfaceRegions(partOrType) {
  const type = typeof partOrType === 'string' ? partOrType : partOrType.type,
    definition = CATALOG[type];
  if (!definition) return [];
  const [x, y, z] = (
      typeof partOrType === 'string' ? definition.primitives : partPrimitives(partOrType)
    )[0].halfExtents,
    s = Math.SQRT1_2;
  const faces = [
    ['right', [x, 0, 0], [0, 0, 0, 1], [y, z]],
    ['left', [-x, 0, 0], [0, 1, 0, 0], [y, z]],
    ['top', [0, y, 0], [0, 0, s, s], [x, z]],
    ['bottom', [0, -y, 0], [0, 0, -s, s], [x, z]],
    ['front', [0, 0, z], [0, -s, 0, s], [y, x]],
    ['back', [0, 0, -z], [0, s, 0, s], [y, x]],
  ];
  const allowed = faces.filter((f) => definition.mountingFaces?.includes(f[0]));
  return allowed.map(([id, position, rotation, halfSize]) => ({
    id,
    label:
      type === 'loadCellSensor'
        ? id === 'left'
          ? 'A — support'
          : 'B — measured'
        : definition.releaseFace === id
          ? 'Latch · Right'
          : id[0].toUpperCase() + id.slice(1),
    position,
    rotation,
    halfSize,
    padHalfSize: definition.mountingPads?.[id] ?? halfSize,
  }));
}
export function resolveSurfaceEndpoint(part, binding) {
  const data = binding.surface,
    region = surfaceRegions(part).find((r) => r.id === data?.region);
  if (!region) reject('UNKNOWN_SURFACE');
  const { u, v, twist } = data;
  if (
    ![u, v, twist].every(Number.isFinite) ||
    Math.abs(u) > region.halfSize[0] + 1e-9 ||
    Math.abs(v) > region.halfSize[1] + 1e-9
  )
    reject('SURFACE_OUT_OF_BOUNDS');
  const offset = rotateVector(region.rotation, [0, u, v]);
  return {
    id: region.id,
    kind: 'fixed',
    position: region.position.map((x, i) => x + offset[i]),
    rotation: multiplyQuaternion(region.rotation, [Math.sin(twist / 2), 0, 0, Math.cos(twist / 2)]),
    multiplicity: CATALOG[part.type].releaseFace === region.id ? 'one' : 'many',
  };
}
/** Shared mounting footprint geometry. Callers own admission versus display tolerances. */
export function projectedPadHalfSize([u, v], twist) {
  const c = Math.abs(Math.cos(twist)),
    s = Math.abs(Math.sin(twist));
  return [c * u + s * v, s * u + c * v];
}
/** Surface connection a is the receiving face; b is the centered mounting pad. */
export function validateSurfacePair(target, a, source, b) {
  resolveSurfaceEndpoint(target, a);
  resolveSurfaceEndpoint(source, b);
  if (b.surface.u !== 0 || b.surface.v !== 0 || b.surface.twist !== 0)
    reject('SURFACE_OUT_OF_BOUNDS');
  const receiver = surfaceRegions(target).find((r) => r.id === a.surface.region),
    pad = surfaceRegions(source).find((r) => r.id === b.surface.region),
    { u, v, twist } = a.surface;
  const [width, height] = projectedPadHalfSize(pad.padHalfSize, twist);
  if (
    Math.abs(u) + width > receiver.halfSize[0] + 1e-9 ||
    Math.abs(v) + height > receiver.halfSize[1] + 1e-9
  )
    reject('SURFACE_OUT_OF_BOUNDS');
}

// Exact point distance to the canonical solid, in its authored local frame.
// The cylinder cross-section is the same regular polygon used by native contacts.
function sphereOverlap(sphere, other) {
  const radius = partPrimitives(sphere)[0].halfExtents[0];
  const primitive = other.envelopeHalf ? null : partPrimitives(other)[0];
  const kind = other.envelopeKind ?? primitive?.kind ?? 'box';
  const half = other.envelopeHalf ?? primitive.halfExtents;
  const delta = sphere.position.map((v, i) => v - other.position[i]);
  if (kind === 'sphere') return Math.hypot(...delta) < radius + half[0] - 1e-7;
  const local = rotateVector(
    other.rotation.map((v, i) => (i < 3 ? -v : v)),
    delta,
  );
  let distance;
  if (kind === 'box')
    distance = Math.hypot(...local.map((v, i) => Math.max(0, Math.abs(v) - half[i])));
  else {
    const [x, y, z] = local;
    let inside = true,
      radial = Infinity;
    for (let i = 0; i < CYLINDER_SEGMENTS; i++) {
      const angle = (2 * Math.PI * i) / CYLINDER_SEGMENTS,
        next = (2 * Math.PI * (i + 1)) / CYLINDER_SEGMENTS;
      const ay = half[1] * Math.cos(angle),
        az = half[1] * Math.sin(angle);
      const dy = half[1] * Math.cos(next) - ay,
        dz = half[1] * Math.sin(next) - az;
      if (dy * (z - az) - dz * (y - ay) < 0) inside = false;
      const t = Math.max(0, Math.min(1, ((y - ay) * dy + (z - az) * dz) / (dy * dy + dz * dz)));
      radial = Math.min(radial, Math.hypot(y - ay - t * dy, z - az - t * dz));
    }
    distance = Math.hypot(Math.max(0, Math.abs(x) - half[0]), inside ? 0 : radial);
  }
  return distance < radius - 1e-7;
}
export function solidsOverlap(a, b) {
  if (!a.envelopeHalf && partPrimitives(a)[0].kind === 'sphere') return sphereOverlap(a, b);
  if (!b.envelopeHalf && partPrimitives(b)[0].kind === 'sphere') return sphereOverlap(b, a);
  const box = (part) => {
    const h = part.envelopeHalf ?? partPrimitives(part)[0].halfExtents;
    return {
      center: part.position,
      half: h,
      axes: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ].map((v) => rotateVector(part.rotation, v)),
    };
  };
  const A = box(a),
    B = box(b),
    dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
    cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  const axes = [...A.axes, ...B.axes, ...A.axes.flatMap((a) => B.axes.map((b) => cross(a, b)))],
    delta = A.center.map((v, i) => v - B.center[i]);
  for (const axis of axes) {
    const length = Math.hypot(...axis);
    if (length < 1e-10) continue;
    const n = axis.map((v) => v / length),
      r = (box) => box.half.reduce((s, h, i) => s + h * Math.abs(dot(box.axes[i], n)), 0);
    if (Math.abs(dot(delta, n)) >= r(A) + r(B) - 1e-7) return false;
  }
  // Bounds are only a broad phase: a wheel's empty corners are not solid.
  const hull = (part, bounds) => {
    const cylinder =
      part.envelopeKind === 'cylinder' ||
      (!part.envelopeHalf && partPrimitives(part)[0].kind === 'cylinder');
    const local = cylinder
      ? Array.from({ length: CYLINDER_SEGMENTS * 2 }, (_, i) => [
          i < CYLINDER_SEGMENTS ? -bounds.half[0] : bounds.half[0],
          bounds.half[1] * Math.cos((2 * Math.PI * i) / CYLINDER_SEGMENTS),
          bounds.half[2] * Math.sin((2 * Math.PI * i) / CYLINDER_SEGMENTS),
        ])
      : Array.from({ length: 8 }, (_, i) => bounds.half.map((h, j) => (i & (1 << j) ? h : -h)));
    const radial = cylinder
      ? Array.from({ length: CYLINDER_SEGMENTS }, (_, i) => {
          const angle = (2 * Math.PI * (i + 0.5)) / CYLINDER_SEGMENTS;
          return rotateVector(part.rotation, [0, Math.cos(angle), Math.sin(angle)]);
        })
      : [];
    return {
      vertices: local.map((v) =>
        rotateVector(part.rotation, v).map((x, i) => x + part.position[i]),
      ),
      normals: cylinder ? [bounds.axes[0], ...radial] : bounds.axes,
      edges: cylinder
        ? [bounds.axes[0], ...radial.map((n) => cross(bounds.axes[0], n))]
        : bounds.axes,
      cylinder,
    };
  };
  const H = hull(a, A),
    K = hull(b, B);
  if (!H.cylinder && !K.cylinder) return true;
  for (const axis of [
    ...H.normals,
    ...K.normals,
    ...H.edges.flatMap((x) => K.edges.map((y) => cross(x, y))),
  ]) {
    const length = Math.hypot(...axis);
    if (length < 1e-10) continue;
    const n = axis.map((x) => x / length);
    const p = H.vertices.map((v) => dot(v, n)),
      q = K.vertices.map((v) => dot(v, n));
    if (Math.max(...p) <= Math.min(...q) + 1e-7 || Math.max(...q) <= Math.min(...p) + 1e-7)
      return false;
  }
  return true;
}
export function placementEnvelopes(part) {
  return [
    part,
    ...shaftSegments(part).map((shaft) => ({
      ...part,
      position: part.position.map((v, i) => v + rotateVector(part.rotation, shaft.position)[i]),
      rotation: multiplyQuaternion(part.rotation, shaft.rotation),
      envelopeHalf: [shaft.length / 2, 0.012, 0.012],
    })),
  ];
}

/** Deterministic broad-phase ordering avoids testing distant pairs. Touching is legal. */
export function findPlacementOverlap(parts) {
  const bounds = (part) => {
    const envelopes = placementEnvelopes(part);
    const xBounds = envelopes.map((e) => {
      const half = e.envelopeHalf ?? partPrimitives(e)[0].halfExtents;
      const extent = half.reduce(
        (sum, h, i) =>
          sum +
          h *
            Math.abs(
              rotateVector(e.rotation, [Number(i === 0), Number(i === 1), Number(i === 2)])[0],
            ),
        0,
      );
      return [e.position[0] - extent, e.position[0] + extent];
    });
    return {
      part,
      envelopes,
      min: Math.min(...xBounds.map((b) => b[0])),
      max: Math.max(...xBounds.map((b) => b[1])),
    };
  };
  const sorted = parts
    .map(bounds)
    .sort((a, b) => a.min - b.min || a.part.id.localeCompare(b.part.id));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length && sorted[j].min < sorted[i].max - 1e-7; j++) {
      const a = sorted[i],
        b = sorted[j];
      if (a.envelopes.some((x) => b.envelopes.some((y) => solidsOverlap(x, y))))
        return [a.part, b.part];
    }
  return null;
}

export function surfaceConnectionAligned(blueprint, edge) {
  if (!edge.a.surface || !edge.b.surface) return true;
  const world = (endpoint) => {
    const part = blueprint.parts.find((p) => p.id === endpoint.part),
      frame = resolveSurfaceEndpoint(part, endpoint),
      rotation = normalizeQuaternion(part.rotation),
      offset = rotateVector(rotation, frame.position);
    return {
      position: part.position.map((v, i) => v + offset[i]),
      rotation: normalizeQuaternion(multiplyQuaternion(rotation, frame.rotation)),
    };
  };
  const a = world(edge.a),
    b = world(edge.b),
    expected = multiplyQuaternion(a.rotation, [0, 1, 0, 0]);
  return (
    Math.hypot(...a.position.map((v, i) => v - b.position[i])) <= 1e-6 &&
    1 - Math.min(1, Math.abs(expected.reduce((sum, v, i) => sum + v * b.rotation[i], 0))) <= 1e-10
  );
}
/** Admit solid placement. Aligned closed mechanisms are ordinary authored graphs. */
export function validatePlacementGeometry(blueprint) {
  for (const [index, obstacle] of sceneObjectDescriptors(blueprint.environment).entries()) {
    const bounds = {
      position: obstacle.position,
      rotation: obstacle.rotation,
      envelopeHalf: obstacle.halfExtents,
      envelopeKind: obstacle.shape,
    };
    for (const [partIndex, part] of blueprint.parts.entries())
      if (placementEnvelopes(part).some((envelope) => solidsOverlap(envelope, bounds)))
        throw Object.assign(Error('SURFACE_OVERLAP'), {
          reasonCode: 'SURFACE_OVERLAP',
          path: `/parts/${partIndex}/environment/${index}`,
        });
  }
  const obstacles = sceneObjectDescriptors(blueprint.environment).map((o) => ({
    position: o.position,
    rotation: o.rotation,
    envelopeHalf: o.halfExtents,
    envelopeKind: o.shape,
  }));
  for (let i = 0; i < obstacles.length; i++)
    for (let j = i + 1; j < obstacles.length; j++)
      if (solidsOverlap(obstacles[i], obstacles[j]))
        throw Object.assign(Error('SURFACE_OVERLAP'), {
          reasonCode: 'SURFACE_OVERLAP',
          path: `/environment/objects/${j}`,
        });
  const overlap = findPlacementOverlap(blueprint.parts);
  if (overlap)
    throw Object.assign(Error('SURFACE_OVERLAP'), {
      reasonCode: 'SURFACE_OVERLAP',
      path: `/parts/${blueprint.parts.indexOf(overlap[0])}/overlaps/${blueprint.parts.indexOf(overlap[1])}`,
    });
}
