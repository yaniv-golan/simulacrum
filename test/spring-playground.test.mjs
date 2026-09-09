import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpringPlayground } from '../src/model/fixtures/spring-playground.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
test('ordinary spring playground compresses with truthful completed energy and restores', async () => {
  const b = createSpringPlayground();
  const c = compileAssembly(b);
  assert.equal(c.configuration.joints.filter((j) => j.kind === 'spring').length, 1);
  const w = await createWorkshop(b);
  try {
    await w.act({ type: 'run' });
    w.step(120);
    const f = w.observe().frames.at(-1);
    assert.ok(f.springs[0].length < 0.3);
    assert.ok(f.energy.springPotentialJ > 0);
    assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-5);
  } finally {
    w.dispose();
  }
});

import { createEmptyBlueprint, loadSave } from '../src/model/blueprint.mjs';
import { createSpringStrut } from '../src/model/fixtures/spring-playground.mjs';
import { insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { assertRejectedEditUnchanged, assertEditRoundTrip } from './contracts/editing.mjs';
import { assertCopiedGraph } from './contracts/copied-graph.mjs';
test('spring authoring rejects invalid pairs, travel and misalignment atomically', async () => {
  const b = createSpringPlayground(),
    bad = structuredClone(b);
  bad.parts.find((p) => p.id === 'carriage').position[0] += 0.01;
  assert.throws(() => compileAssembly(bad), /MISALIGNED/);
  const wrong = structuredClone(b);
  wrong.parts.find((p) => p.id === 'carriage').type = 'springGuide';
  wrong.parts.find((p) => p.id === 'carriage').parameters = structuredClone(
    b.parts.find((p) => p.id === 'guide').parameters,
  );
  assert.equal(loadSave(wrong).ok, false);
  const w = await createWorkshop(createEmptyBlueprint('empty', 'Empty'));
  try {
    await w.act({ type: 'load', save: b });
    assert.equal(w.observe().frames[0].springs.length, 1);
    await assertRejectedEditUnchanged(w, {
      type: 'parameter',
      id: 'guide',
      key: 'minLength',
      value: 0.39,
    });
    await assertEditRoundTrip(w, { type: 'parameter', id: 'guide', key: 'damping', value: 30 });
    await assertEditRoundTrip(w, {
      type: 'disconnect',
      id: b.connections.find((c) => c.kind === 'spring').id,
    });
    assert.equal(w.observe().frames[0].springs.length, 0);
  } finally {
    w.dispose();
  }
});
test('spring assembly insertion preserves material, settings and endpoint identities', () => {
  const b = createSpringStrut(),
    result = insertAssembly(b, b, [1, 0.02, 0], [0, 0, 0, 1]);
  assertCopiedGraph({
    source: b,
    copied: result.blueprint,
    partIds: b.parts.map((p) => p.id),
    idMap: result.idMap,
    connectionIdMap: result.connectionIdMap,
  });
  assert.equal(
    compileAssembly(result.blueprint).configuration.joints.filter((j) => j.kind === 'spring')
      .length,
    2,
  );
});

import { createPart } from '../src/model/blueprint.mjs';
import { proposeMirroredAssembly } from '../src/model/mirror-assembly.mjs';
test('mirrored spring machine preserves ordinary guided connectivity and settings', () => {
  const b = createSpringPlayground();
  b.parts.push(createPart('chassis', 'reference', [-1, 0.02, 0]));
  const ids = b.parts.filter((p) => p.id !== 'reference').map((p) => p.id);
  const result = proposeMirroredAssembly(b, { ids, referenceId: 'reference', axis: 'x' });
  assert.equal(
    compileAssembly(result.blueprint).configuration.joints.filter((j) => j.kind === 'spring')
      .length,
    2,
  );
  for (const id of ids) {
    const before = b.parts.find((p) => p.id === id),
      after = result.blueprint.parts.find((p) => p.id === result.idMap[id]);
    assert.deepEqual(after.parameters, before.parameters);
    assert.deepEqual(after.authoredMaterial, before.authoredMaterial);
    assert.ok(Math.abs(after.position[0] - (-2 - before.position[0])) < 1e-10);
    assert.ok(Math.abs(after.position[1] - before.position[1]) < 1e-10);
    assert.ok(Math.abs(after.position[2] - before.position[2]) < 1e-10);
  }
  for (const edge of b.connections) {
    const copy = result.blueprint.connections.find((c) => c.id === result.connectionIdMap[edge.id]);
    assert.equal(copy.kind, edge.kind);
    for (const side of ['a', 'b']) assert.equal(copy[side].part, result.idMap[edge[side].part]);
  }
  const springEdge = b.connections.find((c) => c.kind === 'spring'),
    copy = result.blueprint.connections.find((c) => c.id === result.connectionIdMap[springEdge.id]);
  assert.equal(copy.a.port, springEdge.a.port);
  assert.equal(copy.b.port, springEdge.b.port);
});

test('compressed session restore binds spring energy and removes stale state on replacement', async () => {
  const w = await createWorkshop(createSpringPlayground());
  try {
    await w.act({ type: 'run' });
    w.step(90);
    const cp = w.checkpoint();
    w.step(1);
    const expected = w.observe().frames[0];
    w.restore(cp);
    w.step(1);
    const actual = w.observe().frames[0];
    assert.deepEqual(actual.physics, expected.physics);
    assert.deepEqual(actual.springs, expected.springs);
    assert.deepEqual(actual.energy, expected.energy);
    const corrupt = structuredClone(cp);
    corrupt.energy.springPotentialJ += 1;
    assert.throws(() => w.restore(corrupt));
    assert.deepEqual(w.observe().frames[0].physics, actual.physics);
    await w.act({ type: 'build' });
    await w.act({ type: 'load', save: createEmptyBlueprint('empty', 'Empty') });
    assert.deepEqual(w.observe().frames[0].springs, []);
    assert.equal(w.observe().frames[0].energy.springPotentialJ, undefined);
  } finally {
    w.dispose();
  }
});

test('derived spring speed rejects overflow before any checkpoint owner changes', async () => {
  const w = await createWorkshop(createSpringPlayground());
  try {
    await w.act({ type: 'run' });
    w.step(5);
    const before = w.checkpoint(),
      bad = structuredClone(before),
      index = bad.metadata.blueprint.parts.findIndex((p) => p.id === 'carriage');
    bad.sensors.bodies[index].position[1] = Number.MAX_VALUE;
    assert.throws(() => w.restore(bad));
    assert.deepEqual(w.checkpoint(), before);
  } finally {
    w.dispose();
  }
});
