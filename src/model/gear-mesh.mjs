import { CATALOG } from './catalog.mjs';
import { rotateVector } from './transforms.mjs';

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const fail = (reasonCode, path) => {
  throw Object.assign(Error(reasonCode), { reasonCode, path });
};

/** Admit a forest of separately supported rotors; meshes never supply bearings. */
export function compileGearMeshes(blueprint, joints) {
  const edges = blueprint.connections.filter((c) => c.kind === 'gear');
  if (!edges.length) return [];
  if (edges.length > 8) fail('UNSUPPORTED_GEAR_TOPOLOGY', 'connections');
  const parent = blueprint.parts.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const j of joints) if (j.kind === 'fixed') parent[root(j.a)] = root(j.b);
  const forest = new Map();
  const meshRoot = (i) => (forest.has(i) ? (forest.get(i) === i ? i : meshRoot(forest.get(i))) : i);
  return edges.map((edge) => {
    const path = `connections[${blueprint.connections.indexOf(edge)}]`;
    const a = blueprint.parts.findIndex((p) => p.id === edge.a.part),
      b = blueprint.parts.findIndex((p) => p.id === edge.b.part);
    const A = blueprint.parts[a],
      B = blueprint.parts[b],
      ga = CATALOG[A.type].gear,
      gb = CATALOG[B.type].gear;
    const u = rotateVector(A.rotation, [1, 0, 0]),
      v = rotateVector(B.rotation, [1, 0, 0]),
      delta = sub(B.position, A.position);
    if (!ga || !gb || ga.module !== gb.module) fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
    if (
      1 - Math.abs(dot(u, v)) > 1e-10 ||
      Math.abs(dot(u, delta)) > 1e-6 ||
      Math.abs(Math.hypot(...delta) - ga.pitchRadius - gb.pitchRadius) > 1e-6
    )
      fail('GEAR_MISALIGNED', path);
    const ra = root(a),
      rb = root(b);
    if (ra === rb) fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
    const support = (rotor, part, axis) => {
      const candidates = [];
      const supports = joints.filter(
        (j) => root(j.a) !== root(j.b) && (root(j.a) === rotor || root(j.b) === rotor),
      );
      if (supports.some((j) => j.kind !== 'revolute' || j.limits))
        fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
      for (const j of joints)
        if (j.kind === 'revolute' && (root(j.a) === rotor || root(j.b) === rotor)) {
          const rotorIsA = root(j.a) === rotor,
            other = root(rotorIsA ? j.b : j.a);
          const node = rotorIsA ? j.a : j.b,
            anchor = rotorIsA ? j.anchorA : j.anchorB,
            localAxis = rotorIsA ? j.axisA : j.axisB;
          const p = blueprint.parts[node],
            worldAxis = rotateVector(p.rotation, localAxis),
            offset = sub(add(p.position, rotateVector(p.rotation, anchor)), part.position);
          if (
            other === rotor ||
            1 - Math.abs(dot(axis, worldAxis)) > 1e-10 ||
            Math.hypot(...offset.map((x, i) => x - dot(offset, axis) * axis[i])) > 1e-6
          )
            fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
          candidates.push(other);
        }
      // Multiple coaxial bearings on the same carrier are physically unambiguous.
      if (!candidates.length || new Set(candidates).size !== 1)
        fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
      return candidates[0];
    };
    const ca = support(ra, A, u),
      cb = support(rb, B, v);
    if (ca !== cb || ca === ra || ca === rb) fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
    const fa = meshRoot(ra),
      fb = meshRoot(rb);
    if (fa === fb) fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
    forest.set(fa, fb);
    return {
      kind: 'gear',
      a,
      b,
      anchorA: [0, 0, 0],
      anchorB: [0, 0, 0],
      axisA: [1, 0, 0],
      axisB: [1, 0, 0],
      radiusA: ga.pitchRadius,
      radiusB: gb.pitchRadius,
      stiffness: ga.stiffness,
      damping: ga.damping,
    };
  });
}
