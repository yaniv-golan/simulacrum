import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import {
  captureAssembly,
  insertAssembly,
  groupAssembly,
  transformAssembly,
} from '../src/model/reusable-assemblies.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { assertCopiedGraph } from './contracts/copied-graph.mjs';
import { assertEditRoundTrip, assertRejectedEditUnchanged } from './contracts/editing.mjs';
import { controlBindingPreset } from '../src/model/control-bindings.mjs';

function fixture() {
  const bp = createEmptyBlueprint('test', 'Test');
  bp.parts.push(
    createPart('poweredMotor', 'motor', [0, 2, 0]),
    createPart('commandReceiver', 'receiver', [1, 2, 0]),
    createPart('powerCell', 'cell', [2, 2, 0]),
  );
  bp.parts[0].authoredMaterial.body = 'steel';
  bp.parts[1].controlBinding = controlBindingPreset('custom');
  bp.connections.push(
    {
      id: 'signal',
      kind: 'signal',
      a: { part: 'receiver', port: 'signal' },
      b: { part: 'motor', port: 'signal' },
    },
    {
      id: 'power',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'motor', port: 'power' },
    },
  );
  return bp;
}
const spec = () => ({
  name: 'Drive module',
  ids: ['motor', 'receiver'],
  ports: [
    { name: 'Power', endpoint: { part: 'motor', port: 'power' } },
    { name: 'Throttle', endpoint: { part: 'motor', port: 'signal' } },
    { name: 'Keys', endpoint: { part: 'receiver', port: 'signal' } },
  ],
});

test('assembly capture and repeated insertion preserve ordinary graphs, aliases and independent bindings', () => {
  const source = fixture(),
    before = structuredClone(source);
  const { definition, omittedConnectionIds } = captureAssembly(source, spec());
  assert.deepEqual(omittedConnectionIds, ['power']);
  assert.deepEqual(source, before);
  const first = insertAssembly(source, definition, [5, 2, 0], [0, 0, 0, 1]);
  assertCopiedGraph({
    source,
    copied: first.blueprint,
    partIds: definition.parts.map((p) => p.id),
    idMap: first.idMap,
    connectionIdMap: first.connectionIdMap,
  });
  const second = insertAssembly(
    first.blueprint,
    definition,
    [8, 2, 0],
    [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  );
  assert.equal(second.blueprint.assemblies.length, 2);
  assert.deepEqual(
    second.blueprint.parts.find((p) => p.id === second.idMap.motor).position,
    [8, 2, 0],
  );
  const receiver = second.blueprint.parts.find((p) => p.id === second.idMap.receiver);
  assert.ok(Math.abs(receiver.position[0] - 8) < 1e-10);
  assert.ok(Math.abs(receiver.position[2] + 1) < 1e-10);
  receiver.controlBinding.drive.positiveKeys = ['KeyK'];
  assert.deepEqual(
    first.blueprint.parts.find((p) => p.id === first.idMap.receiver).controlBinding.drive
      .positiveKeys,
    ['KeyI'],
  );
  assert.deepEqual(definition.parts[1].controlBinding.drive.positiveKeys, ['KeyI']);
  assert.deepEqual(second.blueprint.assemblies[1].ports[0].endpoint, {
    part: second.idMap.motor,
    port: 'power',
  });
  assert.equal(loadSave(second.blueprint).ok, true);
});

test('assembly metadata never changes compiled physics and rigid group transforms preserve articulation', () => {
  const source = fixture(),
    grouped = groupAssembly(source, spec());
  assert.deepEqual(compileAssembly(grouped).configuration, compileAssembly(source).configuration);
  const renamed = structuredClone(grouped);
  renamed.assemblies[0].name = 'Anything';
  renamed.assemblies[0].ports[0].name = 'Anything else';
  assert.deepEqual(compileAssembly(grouped).configuration, compileAssembly(renamed).configuration);
  const moved = transformAssembly(grouped, grouped.assemblies[0].id, [4, 2, 0], [0, 0, 0, 1]);
  assert.deepEqual(
    moved.parts.map((p) => p.position),
    [
      [4, 2, 0],
      [5, 2, 0],
      [2, 2, 0],
    ],
  );
  assert.deepEqual(moved.connections, source.connections);
});

test('assembly admission rejects dangling aliases, overlapping groups, malformed definitions and nested capture', () => {
  const source = fixture(),
    grouped = groupAssembly(source, spec());
  for (const corrupt of [
    (bp) => (bp.assemblies[0].ports[0].endpoint.part = 'cell'),
    (bp) => (bp.assemblies[0].ports[0].endpoint.port = 'missing'),
    (bp) => bp.assemblies[0].ports.push(structuredClone(bp.assemblies[0].ports[0])),
    (bp) => bp.assemblies.push({ ...structuredClone(bp.assemblies[0]), id: 'other' }),
    (bp) => bp.assemblies[0].ids.push('missing'),
    (bp) => (bp.assemblies[0].unexpected = true),
  ]) {
    const bad = structuredClone(grouped);
    corrupt(bad);
    assert.equal(loadSave(bad).ok, false);
  }
  assert.throws(() => groupAssembly(grouped, spec()));
  assert.throws(() => captureAssembly(grouped, { ...spec(), ids: ['motor', 'cell'] }));
  assert.throws(() =>
    insertAssembly(source, { ...grouped, unexpected: true }, [4, 2, 0], [0, 0, 0, 1]),
  );
});

test('public assembly transactions preserve history, save data and rejected edit atomicity', async () => {
  const workshop = await createWorkshop(fixture());
  try {
    await assertEditRoundTrip(workshop, { type: 'create-assembly', ...spec() });
    const group = workshop.save().assemblies[0];
    await assertRejectedEditUnchanged(workshop, {
      type: 'transform-assembly',
      id: group.id,
      position: [NaN, 0, 0],
      rotation: [0, 0, 0, 1],
    });
    await assertRejectedEditUnchanged(workshop, {
      type: 'insert-assembly',
      definition: captureAssembly(fixture(), spec()).definition,
      position: [4, 2, 0],
      rotation: [0, 0, 0, 1],
      expectedCursor: {},
    });
    await assertEditRoundTrip(workshop, {
      type: 'insert-assembly',
      definition: captureAssembly(fixture(), spec()).definition,
      position: [4, 2, 0],
      rotation: [0, 0, 0, 1],
    });
    const copy = workshop.save().assemblies[1];
    await assertEditRoundTrip(workshop, {
      type: 'transform-assembly',
      id: copy.id,
      position: [7, 2, 0],
      rotation: [0, 0, 0, 1],
    });
    await assertEditRoundTrip(workshop, {
      type: 'bind-control',
      id: copy.ids[1],
      binding: controlBindingPreset('steer'),
    });
    assert.deepEqual(workshop.save().parts[1].controlBinding, controlBindingPreset('custom'));
    await assertEditRoundTrip(workshop, { type: 'delete', id: copy.ids[0] });
    assert.deepEqual(
      workshop.save().assemblies[1].ports.map((p) => p.name),
      ['Keys'],
    );
  } finally {
    workshop.dispose();
  }
});

test('named power ports connect across an existing mechanical attachment without moving parts', async () => {
  const bp = fixture();
  // Power can be wired between parts already mechanically joined; grouping adds no restriction.
  const { proposeSurfaceMount } = await import('../src/model/assembly.mjs');
  const mounted = proposeSurfaceMount(bp, {
    part: 'motor',
    sourceRegion: 'left',
    targetPart: 'cell',
    targetRegion: 'bottom',
    u: 0,
    v: 0,
    twist: 0,
    id: 'mount',
  }).blueprint;
  mounted.connections = mounted.connections.filter((edge) => edge.id !== 'power');
  const grouped = groupAssembly(mounted, spec()),
    workshop = await createWorkshop(grouped);
  try {
    await assertEditRoundTrip(workshop, {
      type: 'connect-assembly',
      id: grouped.assemblies[0].id,
      portName: 'Power',
      target: { part: 'cell', port: 'power' },
      connectionId: 'external-power',
    });
    assert.deepEqual(workshop.save().parts, grouped.parts);
  } finally {
    workshop.dispose();
  }
});

test('named mount ports use target support frames and move every member without adding internal joints', async () => {
  const bp = fixture();
  bp.parts.push(createPart('chassis', 'chassis', [4, 2, 0]));
  const grouped = groupAssembly(bp, {
    ...spec(),
    ports: [
      {
        name: 'Mount',
        endpoint: { part: 'motor', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
      },
    ],
  });
  const workshop = await createWorkshop(grouped);
  try {
    await assertEditRoundTrip(workshop, {
      type: 'connect-assembly',
      id: grouped.assemblies[0].id,
      portName: 'Mount',
      target: { part: 'chassis', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      connectionId: 'mount',
    });
    const after = workshop.save();
    const edge = after.connections.find((e) => e.id === 'mount');
    assert.equal(edge.a.part, 'chassis');
    assert.equal(edge.b.part, 'motor');
    assert.deepEqual(
      after.parts[1].position.map((v, i) => v - after.parts[0].position[i]),
      [1, 0, 0],
    );
    assert.equal(after.connections.length, bp.connections.length + 1);
    const ungrouped = structuredClone(after);
    delete ungrouped.assemblies;
    assert.deepEqual(
      compileAssembly(after).configuration,
      compileAssembly(ungrouped).configuration,
    );
  } finally {
    workshop.dispose();
  }
});

test('library placement into an empty machine allocates identities fresh from its definition', () => {
  const first = insertAssembly(
    fixture(),
    captureAssembly(fixture(), spec()).definition,
    [4, 2, 0],
    [0, 0, 0, 1],
  ).blueprint;
  const group = first.assemblies[0];
  const definition = captureAssembly(first, {
    name: group.name,
    ids: group.ids,
    ports: group.ports,
  }).definition;
  const inserted = insertAssembly(
    createEmptyBlueprint('empty', 'Empty'),
    definition,
    [0, 2, 0],
    [0, 0, 0, 1],
  );
  assert.equal(
    inserted.blueprint.parts.some((part) =>
      definition.parts.some((source) => source.id === part.id),
    ),
    false,
  );
  assert.equal(
    inserted.blueprint.connections.some((edge) =>
      definition.connections.some((source) => source.id === edge.id),
    ),
    false,
  );
});

test('assembly interface edits preserve parts, connections and identity with atomic undo', async () => {
  const bp = groupAssembly(fixture(), spec());
  const workshop = await createWorkshop(bp);
  try {
    await assertEditRoundTrip(workshop, {
      type: 'edit-assembly',
      id: bp.assemblies[0].id,
      name: 'Revised drive',
      ids: ['motor', 'receiver', 'cell'],
      ports: [{ name: 'Supply', endpoint: { part: 'cell', port: 'power' } }],
    });
    assert.deepEqual(workshop.save().parts, bp.parts);
    assert.deepEqual(workshop.save().connections, bp.connections);
    assert.equal(workshop.save().assemblies[0].id, bp.assemblies[0].id);
    await assertRejectedEditUnchanged(workshop, {
      type: 'edit-assembly',
      id: bp.assemblies[0].id,
      name: 'Bad',
      ids: ['motor'],
      ports: [{ name: 'Supply', endpoint: { part: 'cell', port: 'power' } }],
    });
  } finally {
    workshop.dispose();
  }
});

test('surface placement of a named assembly previews and commits all members at an offset', async () => {
  const { proposeSurfaceMount, inspectSurfaceMount } = await import('../src/model/assembly.mjs');
  const bp = fixture();
  bp.parts.push(createPart('chassis', 'support', [4, 2, 0]));
  const grouped = groupAssembly(bp, spec());
  const command = {
    type: 'surface-mount',
    assemblyId: grouped.assemblies[0].id,
    part: 'motor',
    sourceRegion: 'left',
    targetPart: 'support',
    targetRegion: 'right',
    u: 0,
    v: 0.12,
    twist: 0,
    id: 'mount',
  };
  const preview = inspectSurfaceMount(grouped, command);
  assert.equal(preview.valid, true);
  assert.deepEqual(new Set(preview.proposal.movingPartIds), new Set(['motor', 'receiver']));
  const workshop = await createWorkshop(grouped);
  try {
    await assertEditRoundTrip(workshop, command);
    const next = workshop.save();
    assert.deepEqual(next, proposeSurfaceMount(grouped, command).blueprint);
    assert.deepEqual(
      next.parts[1].position.map((v, i) => v - next.parts[0].position[i]),
      [1, 0, 0],
    );
    assert.deepEqual(next.parts[2], grouped.parts[2]);
    await assertRejectedEditUnchanged(workshop, { ...command, id: 'bad', assemblyId: 'missing' });
  } finally {
    workshop.dispose();
  }
});
