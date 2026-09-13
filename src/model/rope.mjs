import { resolveSurfaceEndpoint } from './surfaces.mjs';
import { rotateVector } from './transforms.mjs';
/** Nominal braided-nylon engineering model, not a calibrated product rating.
 * Packing applies equally to density, axial area and ultimate tensile area. */
export const ROPE_REASON_CODES = Object.freeze(['ROPE_DOMAIN_LIMIT', 'ROPE_MOTION_LIMIT']);
export const ROPE_MATERIALS = Object.freeze({
  nylon: Object.freeze({
    name: 'Braided nylon',
    density: 1140,
    packing: 0.62,
    youngModulus: 1e8,
    viscosity: 1e5,
    ultimateStress: 48e6,
  }),
});
export const ROPE_LIMITS = Object.freeze({
  minLength: 0.25,
  maxLength: 4,
  minSegments: 4,
  maxSegments: 16,
  maxRopes: 4,
  maxTotalSegments: 32,
  minDiameter: 0.01,
  maxDiameter: 0.04,
  maxStrain: 0.1,
});
const reject = (path) => {
  throw Object.assign(Error('ROPE_DOMAIN_LIMIT'), { reasonCode: 'ROPE_DOMAIN_LIMIT', path });
};
export const ROPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['restLength', 'diameter', 'segments', 'material'],
  properties: {
    restLength: { type: 'number', minimum: ROPE_LIMITS.minLength, maximum: ROPE_LIMITS.maxLength },
    diameter: {
      type: 'number',
      minimum: ROPE_LIMITS.minDiameter,
      maximum: ROPE_LIMITS.maxDiameter,
    },
    segments: {
      type: 'integer',
      minimum: ROPE_LIMITS.minSegments,
      maximum: ROPE_LIMITS.maxSegments,
    },
    material: { enum: Object.keys(ROPE_MATERIALS) },
  },
};
/** Authored initial polyline, not live pose correction. A planar V has exact
 * segment lengths for even subdivision. Odd counts use the straight initial
 * placement; gravity subsequently creates sag through ordinary integration. */
export function ropeInitialPoints(a, b, length, count) {
  const d = b.map((v, i) => v - a[i]),
    span = Math.hypot(...d);
  if (span > length * (1 + ROPE_LIMITS.maxStrain)) reject('rope.restLength');
  const axis = span > 1e-12 ? d.map((v) => v / span) : [1, 0, 0];
  let down = [0, -1, 0].map((v, i) => v + axis[i] * axis[1]);
  if (Math.hypot(...down) < 1e-8) down = [1, 0, 0].map((v, i) => v - axis[i] * axis[0]);
  const norm = Math.hypot(...down);
  down = down.map((v) => v / norm);
  const sag = count % 2 === 0 ? Math.sqrt(Math.max(0, length * length - span * span)) / 2 : 0;
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return a.map((v, k) => v + t * d[k] + down[k] * sag * (1 - Math.abs(2 * t - 1)));
  });
}
/** Append numeric nodes after ordinary bodies. Identity remains in connection metadata. */
export function compileRopes(blueprint, bodies, joints, connections) {
  const ropes = blueprint.connections.filter((c) => c.kind === 'rope');
  if (
    ropes.length > ROPE_LIMITS.maxRopes ||
    ropes.reduce((s, c) => s + c.rope.segments, 0) > ROPE_LIMITS.maxTotalSegments
  )
    reject('connections');
  for (const connection of ropes) {
    const r = connection.rope,
      m = ROPE_MATERIALS[r.material],
      n = r.segments,
      l = r.restLength / n,
      area = (m.packing * Math.PI * r.diameter ** 2) / 4;
    const ends = [connection.a, connection.b].map((e) => {
      const index = blueprint.parts.findIndex((p) => p.id === e.part),
        part = blueprint.parts[index];
      const anchor = resolveSurfaceEndpoint(part, e).position;
      return {
        index,
        anchor,
        position: rotateVector(part.rotation, anchor).map((v, i) => v + part.position[i]),
      };
    });
    const points = ropeInitialPoints(ends[0].position, ends[1].position, r.restLength, n),
      nodes = [];
    for (let i = 0; i <= n; i++) {
      nodes.push(bodies.length);
      bodies.push({
        shape: 'sphere',
        position: points[i],
        rotation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        mass: m.density * area * l * (i === 0 || i === n ? 0.5 : 1),
        halfExtents: Array(3).fill(r.diameter / 2),
        fixed: false,
        friction: 0,
        restitution: 0,
        collision: false,
      });
    }
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(joints.length);
      joints.push({
        kind: 'rope',
        a: nodes[i],
        b: nodes[i + 1],
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
        restLength: l,
        stiffness: (m.youngModulus * area) / l,
        damping: (m.viscosity * area) / l,
        strength: m.ultimateStress * area,
        maxStrain: ROPE_LIMITS.maxStrain,
      });
    }
    ends.forEach((e, i) =>
      joints.push({
        kind: 'spherical',
        a: e.index,
        b: nodes[i === 0 ? 0 : n],
        anchorA: [...e.anchor],
        anchorB: [0, 0, 0],
      }),
    );
    connections.find((c) => c.id === connection.id).rope = { nodes, joints: rows };
  }
}
