import { CATALOG } from './catalog.mjs';
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
  const [x, y, z] = definition.primitives[0].halfExtents,
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
    label: id[0].toUpperCase() + id.slice(1),
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
    multiplicity: 'many',
  };
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
  const width =
      Math.abs(Math.cos(twist)) * pad.padHalfSize[0] +
      Math.abs(Math.sin(twist)) * pad.padHalfSize[1],
    height =
      Math.abs(Math.sin(twist)) * pad.padHalfSize[0] +
      Math.abs(Math.cos(twist)) * pad.padHalfSize[1];
  if (
    Math.abs(u) + width > receiver.halfSize[0] + 1e-9 ||
    Math.abs(v) + height > receiver.halfSize[1] + 1e-9
  )
    reject('SURFACE_OUT_OF_BOUNDS');
}

export function solidsOverlap(a, b) {
  const box = (part) => {
    const h = part.envelopeHalf ?? CATALOG[part.type].primitives[0].halfExtents;
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
  return true;
}
export function placementEnvelopes(part) {
  const half = CATALOG[part.type].primitives[0].halfExtents;
  const shafts = CATALOG[part.type].ports.filter(
    (p) => p.kind === 'shaft' && Math.abs(p.position[0]) > half[0],
  );
  return [
    part,
    ...shafts.map((p) => {
      const face = Math.sign(p.position[0]) * half[0],
        center = [(face + p.position[0]) / 2, p.position[1], p.position[2]];
      return {
        ...part,
        position: part.position.map((v, i) => v + rotateVector(part.rotation, center)[i]),
        envelopeHalf: [Math.abs(p.position[0] - face) / 2, 0.012, 0.012],
      };
    }),
  ];
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
/** Recheck authored surface assemblies at load and compilation, using proposal geometry. */
export function validateSurfaceGeometry(blueprint) {
  for (const edge of blueprint.connections.filter(
    (c) => c.a.surface && c.b.surface && surfaceConnectionAligned(blueprint, c),
  )) {
    const group = new Set([edge.b.part]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of blueprint.connections)
        if (
          c.id !== edge.id &&
          surfaceConnectionAligned(blueprint, c) &&
          ['fixed', 'shaft'].includes(c.kind) &&
          (group.has(c.a.part) || group.has(c.b.part))
        )
          for (const id of [c.a.part, c.b.part])
            if (!group.has(id)) {
              group.add(id);
              changed = true;
            }
    }
    if (group.has(edge.a.part)) reject('MOUNT_HELD_BY_ANOTHER_CONNECTION');
    for (const source of blueprint.parts.filter((p) => group.has(p.id)))
      for (const target of blueprint.parts.filter((p) => !group.has(p.id)))
        if (
          placementEnvelopes(source).some((a) =>
            placementEnvelopes(target).some((b) => solidsOverlap(a, b)),
          )
        )
          reject('SURFACE_OVERLAP');
  }
}
