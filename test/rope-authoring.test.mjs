import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBlueprint,
  createPart,
  validateBlueprint,
  loadSave,
} from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
const fixture = () => {
  const bp = createEmptyBlueprint('rope-test', 'Rope test');
  bp.parts = [createPart('beam', 'a', [0, 2, 0]), createPart('plate', 'b', [1, 2, 0])];
  bp.connections = [
    {
      id: 'line',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 1.5, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  return bp;
};
test('ordinary rope descriptor saves and compiles distributed constant mass and series compliance', () => {
  const bp = fixture();
  assert.equal(validateBlueprint(bp).ok, true);
  assert.deepEqual(loadSave(JSON.stringify(bp)).blueprint, bp);
  for (const n of [4, 8, 16]) {
    bp.connections[0].rope.segments = n;
    const c = compileAssembly(bp, { ground: null });
    const nodes = c.connections[0].rope.nodes;
    assert.equal(nodes.length, n + 1);
    assert.equal(c.configuration.joints.filter((j) => j.kind === 'spherical').length, 2);
    const mass = nodes.reduce((s, i) => s + c.configuration.bodies[i].mass, 0);
    assert.ok(Math.abs(mass - ((1140 * 0.62 * Math.PI * 0.02 ** 2) / 4) * 1.5) < 1e-12);
    const edges = c.configuration.joints.filter((j) => j.kind === 'rope');
    assert.equal(edges.length, n);
    assert.ok(
      Math.abs(
        edges.reduce((s, j) => s + 1 / j.stiffness, 0) -
          1.5 / ((1e8 * 0.62 * Math.PI * 0.02 ** 2) / 4),
      ) < 1e-14,
    );
  }
});
test('capacity and invalid material reject while ordinary positive control admits', () => {
  assert.equal(validateBlueprint(fixture()).ok, true);
  for (const [key, value] of [
    ['restLength', 0],
    ['restLength', 5],
    ['segments', 17],
    ['material', 'steel'],
  ]) {
    const bp = fixture();
    bp.connections[0].rope[key] = value;
    assert.equal(validateBlueprint(bp).ok, false);
  }
  const bp = fixture();
  bp.connections = Array.from({ length: 5 }, (_, i) => ({
    ...structuredClone(bp.connections[0]),
    id: 'rope-' + i,
  }));
  assert.throws(() => compileAssembly(bp));
  bp.connections.length = 4;
  assert.doesNotThrow(() => compileAssembly(bp));
  bp.connections.forEach((c) => (c.rope.segments = 9));
  assert.throws(() => compileAssembly(bp));
});

test('rope identity and copied reusable graphs preserve authored material and numeric plant', async () => {
  const { captureAssembly, insertAssembly } = await import('../src/model/reusable-assemblies.mjs');
  const bp = fixture(),
    renamed = structuredClone(bp);
  renamed.id = 'different';
  renamed.name = 'different';
  renamed.parts.forEach((p, i) => (p.id = 'renamed-' + i));
  renamed.connections[0].id = 'another';
  renamed.connections[0].a.part = 'renamed-0';
  renamed.connections[0].b.part = 'renamed-1';
  assert.deepEqual(compileAssembly(renamed).configuration, compileAssembly(bp).configuration);
  const { definition } = captureAssembly(bp, { name: 'Rope rig', ids: ['a', 'b'], ports: [] });
  const result = insertAssembly(bp, definition, [3, 2, 0], [0, 0, 0, 1]),
    copy = result.blueprint.connections.find((c) => c.id !== bp.connections[0].id);
  assert.deepEqual(copy.rope, bp.connections[0].rope);
  assert.equal(copy.a.part, result.idMap.a);
  assert.equal(copy.b.part, result.idMap.b);
  assert.equal(loadSave(result.blueprint).ok, true);
  const plant = compileAssembly(result.blueprint);
  assert.equal(plant.configuration.joints.filter((j) => j.kind === 'rope').length, 16);
});
test('rope joins mechanical authoring and mirrored reference attachments remain explicit', async () => {
  const { mechanicalGroup } = await import('../src/model/connection-graph.mjs'),
    { proposeMirroredAssembly } = await import('../src/model/mirror-assembly.mjs');
  const bp = fixture();
  assert.deepEqual(mechanicalGroup(bp, 'a'), ['a', 'b']);
  const result = proposeMirroredAssembly(bp, { ids: ['b'], referenceId: 'a', axis: 'x' });
  assert.equal(result.copiedConnectionIds.length, 1);
  const edge = result.blueprint.connections.find((c) => c.id === result.copiedConnectionIds[0]);
  assert.deepEqual(edge.rope, bp.connections[0].rope);
  assert.equal(edge.a.part, 'a');
  assert.equal(edge.b.part, result.idMap.b);
  assert.doesNotThrow(() => compileAssembly(result.blueprint));
});
