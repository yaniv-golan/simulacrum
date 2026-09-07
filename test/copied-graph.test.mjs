import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCopiedGraph } from './contracts/copied-graph.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { snapConnection } from '../src/model/assembly.mjs';
import { proposeMirroredAssembly } from '../src/model/mirror-assembly.mjs';
import { controlBindingPreset } from '../src/model/control-bindings.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';

function fixture() {
  const source = {
    parts: [
      {
        id: 'a',
        name: 'Motor',
        type: 'motor',
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        authoredMaterial: { body: 'steel' },
        parameters: { duty: 0.5 },
        futureAuthoredField: { calibration: [1, 2] },
      },
      {
        id: 'b',
        name: 'Receiver',
        type: 'receiver',
        position: [4, 2, 3],
        rotation: [0, 0, 0, 1],
        authoredMaterial: {},
        parameters: {},
        controlBinding: { mode: 'toggle', drive: { positiveKeys: ['KeyI'] } },
      },
      {
        id: 'outside',
        name: 'Cell',
        type: 'cell',
        position: [8, 2, 3],
        rotation: [0, 0, 0, 1],
        parameters: {},
        authoredMaterial: {},
      },
    ],
    connections: [
      {
        id: 'internal',
        kind: 'signal',
        a: { part: 'b', port: 'signal' },
        b: { part: 'a', port: 'signal' },
      },
      {
        id: 'external',
        kind: 'power',
        a: { part: 'outside', port: 'power' },
        b: { part: 'a', port: 'power' },
      },
    ],
  };
  const idMap = { a: 'copy-a', b: 'copy-b' },
    connectionIdMap = { internal: 'copy-internal' };
  const copied = structuredClone(source);
  copied.parts.push(
    ...source.parts.slice(0, 2).map((part) => ({
      ...structuredClone(part),
      id: idMap[part.id],
      name: part.name + ' copy',
      position: [9, 9, 9],
    })),
  );
  const edge = structuredClone(source.connections[0]);
  edge.id = 'copy-internal';
  edge.a.part = 'copy-b';
  edge.b.part = 'copy-a';
  copied.connections.push(edge);
  return { source, copied, partIds: ['a', 'b'], idMap, connectionIdMap };
}
test('copied graph oracle accepts explicit remapping without requiring copied pose or name equality', () => {
  assertCopiedGraph(fixture());
});
test('copied graph oracle rejects lost authored fields, topology corruption, aliases and external leakage', () => {
  const cases = [
    [
      'non-injective map',
      (f) => {
        f.idMap.b = f.idMap.a;
      },
    ],
    [
      'input ID reused',
      (f) => {
        f.idMap.a = 'a';
      },
    ],
    [
      'dropped material',
      (f) => {
        f.copied.parts[3].authoredMaterial = {};
      },
    ],
    [
      'changed setting',
      (f) => {
        f.copied.parts[3].parameters.duty = 0;
      },
    ],
    [
      'binding omitted',
      (f) => {
        delete f.copied.parts[4].controlBinding;
      },
    ],
    [
      'future authored field lost',
      (f) => {
        delete f.copied.parts[3].futureAuthoredField;
      },
    ],
    [
      'wrong endpoint',
      (f) => {
        f.copied.connections[2].b.port = 'power';
      },
    ],
    [
      'omitted internal edge',
      (f) => {
        delete f.connectionIdMap.internal;
        f.copied.connections.pop();
      },
    ],
    [
      'unmapped external edge',
      (f) => {
        f.copied.connections.push({
          id: 'leak',
          kind: 'power',
          a: { part: 'copy-a', port: 'power' },
          b: { part: 'outside', port: 'power' },
        });
      },
    ],
    [
      'nested input alias',
      (f) => {
        f.copied.parts[4].controlBinding.drive.positiveKeys =
          f.source.parts[1].controlBinding.drive.positiveKeys;
      },
    ],
    [
      'nested retained-part alias',
      (f) => {
        f.copied.parts[4].controlBinding.drive.positiveKeys =
          f.copied.parts[1].controlBinding.drive.positiveKeys;
      },
    ],
    [
      'copied endpoint alias',
      (f) => {
        f.copied.connections[2].a = f.source.connections[0].a;
      },
    ],
  ];
  for (const [label, corrupt] of cases) {
    const f = fixture();
    corrupt(f);
    assert.throws(() => assertCopiedGraph(f), assert.AssertionError, label);
  }
});

const selected = ['motor', 'wheel', 'receiver', 'cell'];
function ordinaryFixture() {
  let bp = createEmptyBlueprint('independent', 'Independent');
  bp.parts = [
    createPart('chassis', 'reference', [0, 1, 0]),
    createPart('chassis', 'other-reference', [4, 1, 0]),
    createPart('poweredMotor', 'motor', [1, 1, 0]),
    createPart('gripWheel', 'wheel', [2, 1, 0]),
    createPart('commandReceiver', 'receiver', [1, 1, 1]),
    createPart('powerCell', 'cell', [1, 1, 2]),
    createPart('beam', 'motor-mirror-1', [6, 4, 6]),
    createPart('powerCell', 'unrelated-cell', [6, 4, 8]),
    createPart('distributionBus', 'unrelated-bus', [8, 4, 8]),
  ];
  bp = snapConnection(bp, { part: 'motor', port: 'shaft' }, { part: 'wheel', port: 'axle' });
  bp.parts.find((p) => p.id === 'motor').parameters.defaultDuty = 0.4;
  bp.parts.find((p) => p.id === 'wheel').authoredMaterial.body = 'steel';
  const receiver = bp.parts.find((p) => p.id === 'receiver');
  receiver.controlBinding = controlBindingPreset('custom');
  receiver.controlBinding.mode = 'toggle';
  bp.connections = [
    {
      id: 'axle',
      kind: 'shaft',
      a: { part: 'motor', port: 'shaft' },
      b: { part: 'wheel', port: 'axle' },
    },
    {
      id: 'signal',
      kind: 'signal',
      a: { part: 'receiver', port: 'signal' },
      b: { part: 'motor', port: 'signal' },
    },
    {
      id: 'wire',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'motor', port: 'power' },
    },
    {
      id: 'axle-mirror-1',
      kind: 'power',
      a: { part: 'unrelated-cell', port: 'power' },
      b: { part: 'unrelated-bus', port: 'power' },
    },
  ];
  return bp;
}
function propose(source, referenceId = 'reference') {
  const output = proposeMirroredAssembly(source, { ids: selected, referenceId, axis: 'x' });
  assertCopiedGraph({
    source,
    copied: output.blueprint,
    partIds: selected,
    idMap: output.idMap,
    connectionIdMap: output.connectionIdMap,
  });
  return output;
}
test('real repeated mirror copies resolve ID collisions and isolate nested authored inputs and instances', () => {
  const source = ordinaryFixture(),
    original = structuredClone(source),
    first = propose(source);
  assert.notEqual(first.idMap.motor, 'motor-mirror-1');
  assert.notEqual(first.connectionIdMap.axle, 'axle-mirror-1');
  const firstBefore = structuredClone(first.blueprint),
    second = propose(first.blueprint, 'other-reference');
  assert.ok(Object.values(second.idMap).every((id) => !Object.values(first.idMap).includes(id)));
  const secondBefore = structuredClone(second.blueprint);
  const sourceReceiver = source.parts.find((p) => p.id === 'receiver');
  sourceReceiver.controlBinding.drive.positiveKeys.push('KeyJ');
  source.parts.find((p) => p.id === 'wheel').authoredMaterial.body = 'rubber';
  assert.deepEqual(first.blueprint, firstBefore, 'input edits cannot mutate the first copy output');
  const receiver = first.blueprint.parts.find((p) => p.id === first.idMap.receiver);
  receiver.controlBinding.drive.positiveKeys.push('KeyK');
  first.blueprint.parts.find((p) => p.id === first.idMap.motor).parameters.defaultDuty = -0.8;
  first.blueprint.connections.find((c) => c.id === first.connectionIdMap.signal).a.port =
    'changed-for-alias-probe';
  assert.deepEqual(
    second.blueprint,
    secondBefore,
    'copy input, endpoints and instances have no shared nested records',
  );
  assert.deepEqual(
    second.blueprint.parts.find((p) => p.id === first.idMap.motor).parameters,
    original.parts.find((p) => p.id === 'motor').parameters,
  );
});
test('public mirror transactions isolate instance parameter edits and preserve both graphs through Undo and save/load', async () => {
  const source = ordinaryFixture(),
    first = propose(source),
    second = propose(first.blueprint, 'other-reference');
  const workshop = await createWorkshop(source),
    restored = await createWorkshop();
  try {
    for (const referenceId of ['reference', 'other-reference'])
      assert.equal(
        (await workshop.act({ type: 'mirror-assembly', ids: selected, referenceId, axis: 'x' })).ok,
        true,
      );
    assert.deepEqual(workshop.save(), second.blueprint);
    const before = workshop.save();
    assert.equal(
      (
        await workshop.act({
          type: 'parameter',
          id: first.idMap.motor,
          key: 'defaultDuty',
          value: -0.8,
        })
      ).ok,
      true,
    );
    const edited = workshop.save();
    assert.equal(edited.parts.find((p) => p.id === first.idMap.motor).parameters.defaultDuty, -0.8);
    for (const id of ['motor', second.idMap.motor])
      assert.deepEqual(
        edited.parts.find((p) => p.id === id),
        before.parts.find((p) => p.id === id),
        'editing one copy cannot alter another',
      );
    assert.equal((await workshop.act({ type: 'undo' })).ok, true);
    assert.deepEqual(workshop.save(), before);
    assert.equal((await workshop.act({ type: 'redo' })).ok, true);
    assert.deepEqual(workshop.save(), edited);
    const save = JSON.stringify(workshop.save());
    assert.deepEqual(loadSave(save).blueprint, edited);
    assert.equal((await restored.act({ type: 'load', save })).ok, true);
    assert.deepEqual(restored.save(), edited);
    assert.equal((await workshop.act({ type: 'undo' })).ok, true);
    assert.equal((await workshop.act({ type: 'undo' })).ok, true);
    assert.deepEqual(
      workshop.save(),
      first.blueprint,
      'Undo removes exactly the second copied graph',
    );
    assert.deepEqual(
      restored.save(),
      edited,
      'another session retains its independent loaded graph',
    );
  } finally {
    workshop.dispose();
    restored.dispose();
  }
});
