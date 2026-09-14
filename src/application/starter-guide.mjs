import { createStarterVehicle } from '../model/starter-vehicle.mjs';

/**
 * A player-facing sequence of ordinary edits, never a simulation mode. A step is satisfied by
 * what the player built, not by who placed it: the k-th part of a type, or the k-th connection
 * of a kind between two types, counts wherever it sits. "Do it for me" resolves the step against
 * the current blueprint, so it connects the player's own parts.
 */
export function starterSteps() {
  const blueprint = createStarterVehicle();
  const vehiclePart = (id) => blueprint.parts.find((p) => p.id === id);
  const partName = (id) => vehiclePart(id).name;
  const ofType = (bp, type) => bp.parts.filter((p) => p.type === type);
  // Which of its type this vehicle part is (1-based), so three wheels need three wheels.
  const ordinal = (part) => ofType(blueprint, part.type).indexOf(part) + 1;
  const sameEnds = (edge, bp, typeA, typeB) => {
    const type = (end) => bp.parts.find((p) => p.id === end.part)?.type;
    return (
      (type(edge.a) === typeA && type(edge.b) === typeB) ||
      (type(edge.a) === typeB && type(edge.b) === typeA)
    );
  };
  const matching = (bp, c) =>
    bp.connections.filter(
      (e) =>
        e.kind === c.kind &&
        sameEnds(e, bp, vehiclePart(c.a.part).type, vehiclePart(c.b.part).type),
    );
  // The vehicle's k-th connection of this shape.
  const edgeOrdinal = (c) => matching(blueprint, c).indexOf(c) + 1;
  const freshId = (bp, id) => {
    let candidate = id,
      n = 2;
    while (bp.parts.some((p) => p.id === candidate)) candidate = `${id}-${n++}`;
    return candidate;
  };
  return [
    ...blueprint.parts.map((part) => ({
      label: `Place ${part.name}`,
      description: 'The green preview shows its position. You can move or rotate it afterward.',
      part,
      commands: (bp) => [
        { type: 'insert', part: { ...part, id: freshId(bp, `guide-${part.id}`) } },
      ],
      done: (bp) => ofType(bp, part.type).length >= ordinal(part),
    })),
    ...blueprint.connections.map((c) => ({
      label: `${c.kind === 'power' ? 'Wire' : 'Attach'} ${partName(c.a.part)} → ${partName(c.b.part)}`,
      description:
        c.kind === 'power'
          ? 'This cable supplies energy. It does not hold the parts together.'
          : c.kind === 'shaft'
            ? 'Connect the axle so this wheel can turn. The highlighted parts show the connection.'
            : 'Bolt these parts together so they move as one. Green highlights confirm the joint, even when it is hidden.',
      commands: (bp) => {
        // The player's k-th part of each type stands in for the vehicle's k-th.
        const stand = (id) => ofType(bp, vehiclePart(id).type)[ordinal(vehiclePart(id)) - 1]?.id;
        // Steps run parts-then-connections, so both stand-ins exist; guard a future reorder.
        if (!stand(c.a.part) || !stand(c.b.part)) return [];
        return [
          {
            type: 'connect',
            id: freshConnectionId(bp, `guide-${c.id}`),
            a: { ...c.a, part: stand(c.a.part) },
            b: { ...c.b, part: stand(c.b.part) },
          },
        ];
      },
      done: (bp) => matching(bp, c).length >= edgeOrdinal(c),
    })),
  ];
}
function freshConnectionId(bp, id) {
  let candidate = id,
    n = 2;
  while (bp.connections.some((c) => c.id === candidate)) candidate = `${id}-${n++}`;
  return candidate;
}
