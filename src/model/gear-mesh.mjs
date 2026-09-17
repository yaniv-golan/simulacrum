import { gearFacts, SPACING_TOLERANCE } from './gear-geometry.mjs';
import { mechanicalGroup } from './connection-graph.mjs';
import { surfaceRegions } from './surfaces.mjs';
import { rotateVector } from './transforms.mjs';

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const fail = (reasonCode, path) => {
  throw Object.assign(Error(reasonCode), { reasonCode, path });
};

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

/** The one mount whose offset restores a mis-spaced mesh, and the offset it needs.
 *
 * A mesh is admitted only when both rotors turn on bearings carried by one rigid support, so
 * both gears always belong to one mechanical group and no pose edit of either gear can change
 * the distance between them: the group moves whole. The distance a player actually authored is
 * the surface-mount offset that separates the two shafts, so that is what a repair edits, as an
 * ordinary `surface-mount` command replacing the same connection.
 *
 * The gear that moves is the one on the side of that mount which drives nothing: a motored
 * shaft is the datum the machine was built around. With a motor on both sides or neither, the
 * later-placed gear moves, because the earlier one is what the rest was built against. Neither
 * rule reads a part name, a blueprint id or a role: the motor is found by catalog type and the
 * order is the authored part order.
 *
 * Returns undefined when there is nothing to repair, when the two gears cannot mesh at any
 * distance, or when no single mount can express the correction -- never a command that would
 * leave the same diagnosis.
 *
 * @param {import('./generated/blueprint-types.js').Blueprint} blueprint
 * @param {string} connectionId
 */
export function meshSpacingRepair(blueprint, connectionId) {
  const edge = blueprint.connections.find((c) => c.id === connectionId && c.kind === 'gear');
  if (!edge) return undefined;
  /** @param {string} id */
  const part = (id) => blueprint.parts.find((p) => p.id === id);
  const a = part(edge.a.part),
    b = part(edge.b.part);
  const ga = a && gearFacts(a),
    gb = b && gearFacts(b);
  // Different tooth sizes are a different diagnosis: no centre distance makes that pair mesh.
  if (!ga || !gb || ga.module !== gb.module) return undefined;
  const centreDistance = ga.pitchRadius + gb.pitchRadius;
  const delta = b.position.map((x, i) => x - a.position[i]),
    distance = Math.hypot(...delta);
  if (!(distance > 1e-9) || Math.abs(distance - centreDistance) <= SPACING_TOLERANCE)
    return undefined;
  /** @param {string[]} ids */
  const motored = (ids) => ids.some((id) => part(id)?.type === 'poweredMotor');
  const later = blueprint.parts.indexOf(a) > blueprint.parts.indexOf(b) ? a : b;
  let chosen;
  for (const mount of blueprint.connections) {
    const target = mount.a,
      mounted = mount.b;
    if (!target.surface || !mounted.surface) continue;
    // Bind the two authored placements once: the endpoints are read again well below, past
    // calls after which a property narrowing on the connection no longer holds.
    const targetSurface = target.surface,
      mountedSurface = mounted.surface;
    const side = mechanicalGroup(blueprint, mounted.part, { omitConnectionIds: [mount.id] });
    const holdsA = side.includes(a.id),
      holdsB = side.includes(b.id);
    // The mount must separate the two gears, and the moving side is the mounted part's side.
    if (holdsA === holdsB) continue;
    const moving = holdsA ? a : b,
      anchor = holdsA ? b : a;
    const receiver = part(target.part);
    if (!receiver) continue;
    const region = surfaceRegions(receiver).find((r) => r.id === targetSurface.region);
    if (!region) continue;
    // The offset moves the mounted side within the receiving face; a correction with any
    // component out of that plane is not something this mount can author.
    /** @type {[number, number, number][]} */
    const faceAxes = [
      [0, 1, 0],
      [0, 0, 1],
    ];
    const axes = faceAxes.map((axis) =>
      rotateVector(receiver.rotation, rotateVector(region.rotation, axis)),
    );
    const towards = moving.position.map((x, i) => (x - anchor.position[i]) / distance);
    const correction = towards.map((x) => x * (centreDistance - distance));
    const [du, dv] = axes.map((axis) => dot(correction, axis));
    const residual = correction.map((x, i) => x - du * axes[0][i] - dv * axes[1][i]);
    if (Math.hypot(...residual) > 1e-9) continue;
    const candidate = {
      connection: mount.id,
      moving: moving.id,
      part: mounted.part,
      sourceRegion: mountedSurface.region,
      targetPart: target.part,
      targetRegion: targetSurface.region,
      u: targetSurface.u + du,
      v: targetSurface.v + dv,
      twist: targetSurface.twist,
      centreDistance,
      driven: motored(side),
    };
    // Prefer a side that drives nothing, then the later-placed gear, then authored order.
    if (
      !chosen ||
      (chosen.driven && !candidate.driven) ||
      (chosen.driven === candidate.driven &&
        chosen.moving !== later.id &&
        candidate.moving === later.id)
    )
      chosen = candidate;
  }
  if (!chosen) return undefined;
  const { driven, ...repair } = chosen;
  return repair;
}
