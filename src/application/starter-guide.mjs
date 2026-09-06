import { createStarterVehicle } from '../model/starter-vehicle.mjs';

/** A player-facing sequence of ordinary edits, never a simulation mode. */
export function starterSteps() {
  const blueprint = createStarterVehicle();
  const partName = (id) => blueprint.parts.find((p) => p.id === id).name;
  return [
    ...blueprint.parts.map((part) => ({
      label: `Place ${part.name}`,
      description: 'The green preview shows its position. You can move or rotate it afterward.',
      part,
      commands: [{ type: 'insert', part: { ...part, id: `guide-${part.id}` } }],
      done: (bp) => bp.parts.some((p) => p.id === `guide-${part.id}`),
    })),
    ...blueprint.connections.map((c) => ({
      label: `${c.kind === 'power' ? 'Wire' : 'Attach'} ${partName(c.a.part)} → ${partName(c.b.part)}`,
      description:
        c.kind === 'power'
          ? 'This cable supplies energy. It does not hold the parts together.'
          : c.kind === 'shaft'
            ? 'Connect the axle so this wheel can turn. The highlighted parts show the connection.'
            : 'Bolt these parts together so they move as one. Green highlights confirm the joint, even when it is hidden.',
      commands: [
        {
          type: 'connect',
          id: `guide-${c.id}`,
          a: { ...c.a, part: `guide-${c.a.part}` },
          b: { ...c.b, part: `guide-${c.b.part}` },
        },
      ],
      done: (bp) =>
        bp.connections.some(
          (e) =>
            e.kind === c.kind &&
            [
              [e.a, e.b],
              [e.b, e.a],
            ].some(
              ([a, b]) =>
                a.part === `guide-${c.a.part}` &&
                a.port === c.a.port &&
                JSON.stringify(a.surface) === JSON.stringify(c.a.surface) &&
                b.part === `guide-${c.b.part}` &&
                b.port === c.b.port &&
                JSON.stringify(b.surface) === JSON.stringify(c.b.surface),
            ),
        ),
    })),
  ];
}
