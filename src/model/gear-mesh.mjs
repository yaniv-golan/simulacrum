import { gearFacts } from './gear-geometry.mjs';
import { rotateVector } from './transforms.mjs';

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const fail = (reasonCode, path) => {
  throw Object.assign(Error(reasonCode), { reasonCode, path });
};

// Authoring tolerance for the centre distance. The runtime tolerates 5 mm of drift before it
// raises GEAR_MOTION_LIMIT, and the finest control that can place a gear steps in millimetres,
// so a millimetre is both inside the band the physics already accepts and reachable by hand.
const SPACING_TOLERANCE = 1e-3;

/** Admit a forest of separately supported rotors; meshes never supply bearings.
 *
 * Returns the compiled joints and one diagnostic per authored gear edge. The two checks that
 * depend on authored numbers -- equal tooth size and centre distance -- are per-edge diagnostics,
 * not refusals: a player editing a tooth count must not have their edit rejected by a mesh they
 * can still see and repair. A diagnosed edge emits no joint, so nothing transmits through it.
 * Topology failures stay refusals; no parameter edit can produce one.
 */
export function compileGearMeshes(blueprint, joints) {
  const edges = blueprint.connections.filter((c) => c.kind === 'gear');
  if (!edges.length) return { joints: [], diagnostics: [] };
  if (edges.length > 8) fail('UNSUPPORTED_GEAR_TOPOLOGY', 'connections');
  const parent = blueprint.parts.map((_, i) => i);
  const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const j of joints) if (j.kind === 'fixed') parent[root(j.a)] = root(j.b);
  const forest = new Map();
  const meshRoot = (i) => (forest.has(i) ? (forest.get(i) === i ? i : meshRoot(forest.get(i))) : i);
  const compiled = [],
    diagnostics = [];
  for (const edge of edges) {
    const path = `connections[${blueprint.connections.indexOf(edge)}]`;
    const a = blueprint.parts.findIndex((p) => p.id === edge.a.part),
      b = blueprint.parts.findIndex((p) => p.id === edge.b.part);
    const A = blueprint.parts[a],
      B = blueprint.parts[b],
      ga = gearFacts(A),
      gb = gearFacts(B);
    const u = rotateVector(A.rotation, [1, 0, 0]),
      v = rotateVector(B.rotation, [1, 0, 0]),
      delta = sub(B.position, A.position);
    // A gear edge between parts that are not gears is invalid authoring, not a mismatch.
    if (!ga || !gb) fail('UNSUPPORTED_GEAR_TOPOLOGY', path);
    // Axis parallelism and axial offset cannot be produced by a parameter edit; they stay
    // refusals. Only the centre distance moves with the authored teeth.
    if (1 - Math.abs(dot(u, v)) > 1e-10 || Math.abs(dot(u, delta)) > 1e-6)
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
    // Whether the mesh is admitted is settled entirely above, by the authored topology; the two
    // checks below are about numbers a player can change, so they diagnose the edge rather than
    // refuse the edit. The forest already holds this edge either way, so admitting a second mesh
    // never depends on whether the first one's numbers happen to line up.
    forest.set(fa, fb);
    if (ga.module !== gb.module) {
      diagnostics.push({ id: edge.id, reasonCode: 'GEAR_TOOTH_SIZE_MISMATCH' });
      continue;
    }
    if (Math.abs(Math.hypot(...delta) - ga.pitchRadius - gb.pitchRadius) > SPACING_TOLERANCE) {
      diagnostics.push({ id: edge.id, reasonCode: 'GEAR_MISALIGNED' });
      continue;
    }
    diagnostics.push({ id: edge.id, reasonCode: 'OK' });
    compiled.push({
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
    });
  }
  return { joints: compiled, diagnostics };
}
