// @ts-check
import { CATALOG } from './catalog.mjs';
import { mechanicalGroup } from './connection-graph.mjs';
import { surfaceRegions } from './surfaces.mjs';
import { rotateVector } from './transforms.mjs';

/** Authoring tolerance for a mesh's centre distance, owned here with the radii it is compared
 * against. The runtime tolerates 5 mm of drift before it raises GEAR_MOTION_LIMIT, and the
 * finest control that can place a gear steps in millimetres, so a millimetre is both inside the
 * band the physics already accepts and reachable by hand. The compiler diagnoses beyond it and a
 * repair must not offer to move a pair already inside it, so both read this one number. */
export const SPACING_TOLERANCE = 1e-3;

/** The one place a gear's authored tooth count and module become lengths.
 *
 * Nothing stores a pitch or collider radius: a stored radius would be a second writer of the
 * same quantity and could disagree with teeth x module / 2. Absent parameters fall back to the
 * definition's own defaults, which is the same rule the canonical primitive follows, so a gear
 * authored without parameters resolves to exactly the shipped disc.
 *
 * The collider is the root cylinder one module inside the pitch circle: a correctly spaced pair
 * therefore leaves a gap of two modules and the hulls never touch, which is why the mesh joint,
 * not contact, is what transmits.
 *
 * @param {import('./generated/blueprint-types.js').Part} part
 * @returns {{ teeth: number, module: number, pitchRadius: number, colliderRadius: number, stiffness: number, damping: number } | undefined}
 */
export function gearFacts(part) {
  const definition = CATALOG[part.type],
    gear = definition?.gear;
  if (!gear) return undefined;
  const definitions = definition.parameterDefinitions;
  const authored = part.parameters ?? {};
  const teeth = ('teeth' in authored ? authored.teeth : undefined) ?? definitions.teeth.default,
    module = ('module' in authored ? authored.module : undefined) ?? definitions.module.default;
  const pitchRadius = (module * teeth) / 2;
  return {
    teeth,
    module,
    pitchRadius,
    // m(z-2)/2 rather than mz/2 - m: the same number, but it lands on the canonical primitive
    // exactly at the default count instead of one unit in the last place below it.
    colliderRadius: (module * (teeth - 2)) / 2,
    stiffness: gear.stiffness,
    damping: gear.damping,
  };
}

/** @param {number[]} a @param {number[]} b */
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

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
