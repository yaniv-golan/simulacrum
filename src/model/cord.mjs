import { DT } from './tick.mjs';
import { resolveSurfaceEndpoint } from './surfaces.mjs';
import { rotateVector } from './transforms.mjs';
/** Nominal elastic-cord engineering model, not a calibrated product rating.
 * Packing applies equally to density and axial area. A cord pulls and never
 * pushes: its rows are the same unilateral Kelvin element the rope law solves,
 * so the connection authors stiffness and damping while material and diameter
 * author only the distributed mass. */
export const CORD_REASON_CODES = Object.freeze([
  'CORD_DOMAIN_LIMIT',
  'CORD_ELASTIC_BUDGET',
  'CORD_MOTION_LIMIT',
]);
export const CORD_MATERIALS = Object.freeze({
  rubber: Object.freeze({ name: 'Natural rubber', density: 1100, packing: 1 }),
  bungee: Object.freeze({ name: 'Sheathed bungee', density: 1050, packing: 0.85 }),
});
export const CORD_LIMITS = Object.freeze({
  // The frozen 0.08-0.40 m elastic domain and the measured 0-300 N/m, 0-100 N s/m
  // ranges the guided spring's frequency and energy controls were taken on.
  minLength: 0.08,
  maxLength: 0.4,
  minStiffness: 1,
  maxStiffness: 300,
  minDamping: 0,
  maxDamping: 100,
  minSegments: 2,
  maxSegments: 8,
  maxCords: 2,
  minDiameter: 0.004,
  maxDiameter: 0.02,
  // A linear elastic model past double its rest length is no longer the model
  // that was measured; the run stops and explains instead of continuing.
  maxStrain: 1,
  elasticBudget: 0.09,
});
const reject = (path) => {
  throw Object.assign(Error('CORD_DOMAIN_LIMIT'), { reasonCode: 'CORD_DOMAIN_LIMIT', path });
};
export const CORD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['restLength', 'stiffness', 'damping', 'diameter', 'segments', 'material'],
  properties: {
    restLength: { type: 'number', minimum: CORD_LIMITS.minLength, maximum: CORD_LIMITS.maxLength },
    stiffness: {
      type: 'number',
      minimum: CORD_LIMITS.minStiffness,
      maximum: CORD_LIMITS.maxStiffness,
    },
    damping: { type: 'number', minimum: CORD_LIMITS.minDamping, maximum: CORD_LIMITS.maxDamping },
    diameter: {
      type: 'number',
      minimum: CORD_LIMITS.minDiameter,
      maximum: CORD_LIMITS.maxDiameter,
    },
    segments: {
      type: 'integer',
      minimum: CORD_LIMITS.minSegments,
      maximum: CORD_LIMITS.maxSegments,
    },
    material: { enum: Object.keys(CORD_MATERIALS) },
  },
};
/** Authored initial polyline, not live pose correction. An elastic cord starts
 * straight between its authored anchors; gravity subsequently creates sag
 * through ordinary integration when the cord is slack. */
export function cordInitialPoints(a, b, length, count) {
  const d = b.map((v, i) => v - a[i]),
    span = Math.hypot(...d);
  if (span > length * (1 + CORD_LIMITS.maxStrain)) reject('cord.restLength');
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / count;
    return a.map((v, k) => v + t * d[k]);
  });
}
/** Shared measured-domain elastic budget. Numeric SI only; no identities.
 * Same discrete form as the guided-spring island gate: dt^2 trace(K W). */
export function elasticBudgetTrace(rows, dt = DT) {
  if (!Array.isArray(rows) || !Number.isFinite(dt) || dt <= 0)
    throw TypeError('invalid elastic budget inputs');
  let trace = 0;
  for (const { stiffness, mobility } of rows) {
    if (!Number.isFinite(stiffness) || stiffness < 0 || !Number.isFinite(mobility) || mobility < 0)
      throw TypeError('invalid elastic budget row');
    trace += dt * dt * stiffness * mobility;
  }
  if (!Number.isFinite(trace)) throw RangeError('invalid elastic budget accounting');
  return trace;
}
/** Disjoint-set union over indices, used for rigid sets and budget groups. */
function sets(size) {
  const parent = Array.from({ length: size }, (_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  return {
    root,
    join(a, b) {
      a = root(a);
      b = root(b);
      if (a !== b) parent[b] = a;
    },
  };
}
const BILATERAL = ['fixed', 'revolute', 'spring', 'spherical'];
/** Authored-mass mobility of one elastic element, from the rigidly bolted sets
 * its ends belong to. An immobile pair has no relative mobility. */
function elementMobility(bodies, rigid, a, b) {
  const totals = new Map();
  const grounded = new Set();
  for (const [index, body] of bodies.entries()) {
    const key = rigid.root(index);
    totals.set(key, (totals.get(key) ?? 0) + body.mass);
    if (body.fixed) grounded.add(key);
  }
  const rootA = rigid.root(a),
    rootB = rigid.root(b);
  if (rootA === rootB || (grounded.has(rootA) && grounded.has(rootB))) return 0;
  const inverse = (key) => (grounded.has(key) ? 0 : 1 / totals.get(key));
  return inverse(rootA) + inverse(rootB);
}
/** Guided springs and elastic cords physically share one machine's elastic
 * response, so they share one budget. Enforced here, at authoring time, from
 * authored masses; the physics door keeps its own live guided-spring gate. */
export function admitCordBudget(bodies, joints, cords) {
  const rigid = sets(bodies.length),
    groups = sets(bodies.length);
  for (const j of joints) {
    if (j.kind === 'fixed') rigid.join(j.a, j.b);
    if (BILATERAL.includes(j.kind)) groups.join(j.a, j.b);
  }
  for (const { a, b } of cords) groups.join(a, b);
  const rows = [
    ...joints.flatMap((j) =>
      j.kind === 'spring' && j.stiffness > 0
        ? [
            {
              group: groups.root(j.a),
              stiffness: j.stiffness,
              mobility: elementMobility(bodies, rigid, j.a, j.b),
            },
          ]
        : [],
    ),
    ...cords.map(({ a, b, stiffness }) => ({
      group: groups.root(a),
      stiffness,
      mobility: elementMobility(bodies, rigid, a, b),
    })),
  ];
  for (const group of new Set(rows.map((r) => r.group)))
    if (elasticBudgetTrace(rows.filter((r) => r.group === group)) > CORD_LIMITS.elasticBudget)
      throw Object.assign(Error('CORD_ELASTIC_BUDGET'), {
        reasonCode: 'CORD_ELASTIC_BUDGET',
        path: 'connections',
      });
}
/** Append numeric nodes after ordinary bodies. Identity remains in connection
 * metadata. Per-row stiffness and damping are the authored end-to-end values
 * scaled by the subdivision, so n rows in series restore the authored pair. */
export function compileCords(blueprint, bodies, joints, connections) {
  const cords = blueprint.connections.filter((c) => c.kind === 'cord');
  if (!cords.length) return;
  if (cords.length > CORD_LIMITS.maxCords) reject('connections');
  const resolved = cords.map((connection) => {
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
    return { connection, ends };
  });
  admitCordBudget(
    bodies,
    joints,
    resolved.map(({ connection, ends }) => ({
      a: ends[0].index,
      b: ends[1].index,
      stiffness: connection.cord.stiffness,
    })),
  );
  for (const { connection, ends } of resolved) {
    const c = connection.cord,
      m = CORD_MATERIALS[c.material],
      n = c.segments,
      l = c.restLength / n,
      area = (m.packing * Math.PI * c.diameter ** 2) / 4;
    const points = cordInitialPoints(ends[0].position, ends[1].position, c.restLength, n),
      nodes = [];
    for (let i = 0; i <= n; i++) {
      nodes.push(bodies.length);
      bodies.push({
        shape: 'sphere',
        position: points[i],
        rotation: [0, 0, 0, 1],
        velocity: [0, 0, 0],
        mass: m.density * area * l * (i === 0 || i === n ? 0.5 : 1),
        halfExtents: Array(3).fill(c.diameter / 2),
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
        kind: 'cord',
        a: nodes[i],
        b: nodes[i + 1],
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
        restLength: l,
        stiffness: n * c.stiffness,
        damping: n * c.damping,
        maxStrain: CORD_LIMITS.maxStrain,
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
    connections.find((c) => c.id === connection.id).cord = { nodes, joints: rows };
  }
}
