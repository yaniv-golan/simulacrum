import { createEmptyBlueprint, createPart } from '../blueprint.mjs';
import { snapConnection } from '../assembly.mjs';
/** Ordinary gravity-loaded parts: no anchors, initial impulses or powered components. */
export function createSpringPlayground({ damping = 8 } = {}) {
  let b = createEmptyBlueprint('spring-playground', 'Spring playground');
  b.parts = [
    createPart('chassis', 'base', [0, 0.02, 0]),
    createPart('springGuide', 'guide', [0, 1, 0]),
    createPart('springCarriage', 'carriage', [0, 2, 0]),
    createPart('plate', 'platform', [0, 3, 0]),
    createPart('beam', 'weight', [0, 0.48, 0]),
    createPart('beam', 'rail', [0, 4, 0]),
  ];
  b.parts[1].parameters.damping = damping;
  b.parts[1].parameters.stiffness = 200;
  for (const p of b.parts)
    if (p.type === 'plate' || p.id === 'weight') p.authoredMaterial.body = 'rubber';
  b.parts[0].authoredMaterial.body = 'steel';
  b.parts.find((p) => p.id === 'carriage').authoredMaterial.body = 'aluminium';
  const face = (part, region, v = 0) => ({ part, surface: { region, u: 0, v, twist: 0 } });
  const connect = (a, c, kind) => {
    b = snapConnection(b, a, c);
    b.connections.push({ id: `spring-${b.connections.length}`, kind, a, b: c });
  };
  connect(face('base', 'top'), face('guide', 'bottom'), 'fixed');
  connect({ part: 'guide', port: 'slide' }, { part: 'carriage', port: 'slide' }, 'spring');
  connect(face('platform', 'bottom', -0.04), face('carriage', 'top'), 'fixed');
  connect(face('base', 'top', -0.101), face('rail', 'left'), 'fixed');
  const shift = 0.02 - b.parts.find((p) => p.id === 'base').position[1];
  for (const p of b.parts) p.position[1] += shift;
  b.parts.find((p) => p.id === 'weight').position = [
    ...b.parts.find((p) => p.id === 'platform').position,
  ].map((x, i) => (i === 1 ? x + 0.1 : x));
  b.parts.find((p) => p.id === 'weight').name = 'Drop weight · 80 mm above platform';
  // Select the adjustable guide on load through ordinary insertion selection.
  b.parts.push(
    b.parts.splice(
      b.parts.findIndex((p) => p.id === 'guide'),
      1,
    )[0],
  );
  return b;
}

/** Self-contained palette convenience. Members and both mounts remain ordinary. */
export function createSpringStrut() {
  const b = createSpringPlayground();
  const ids = ['base', 'guide', 'carriage', 'rail'];
  b.parts = b.parts.filter((p) => ids.includes(p.id));
  b.connections = b.connections.filter((c) => ids.includes(c.a.part) && ids.includes(c.b.part));
  b.name = 'Spring strut';
  b.assemblies = [
    {
      id: 'strut',
      name: b.name,
      ids,
      ports: [
        {
          name: 'Base mount',
          endpoint: { part: 'base', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
        },
        {
          name: 'Moving mount',
          endpoint: { part: 'carriage', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
        },
      ],
    },
  ];
  return b;
}
