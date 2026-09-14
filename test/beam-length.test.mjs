import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
import { partPrimitives } from '../src/model/geometry.mjs';
import { surfaceRegions } from '../src/model/surfaces.mjs';
import { compileAssembly, proposeSurfaceMount } from '../src/model/assembly.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { explainFailure } from '../src/model/messages.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createPassiveSuspensionCart } from '../src/model/fixtures/guided-suspension.mjs';

const GATE = new URL('./fixtures/spring-reference/powered-gate-counterexample.json', import.meta.url);
const beamAt = (id, position, length) => {
  const part = createPart('beam', id, position);
  if (length !== undefined) part.parameters.length = length;
  return part;
};
const mass = (blueprint, index = 0) => compileAssembly(blueprint).configuration.bodies[index].mass;

test('beam length is an optional authored dimension: absent means the canonical primitive', () => {
  const definition = CATALOG.beam.parameterDefinitions.length;
  assert.ok(definition, 'beam declares a length parameter');
  assert.equal(definition.optional, true, 'existing saves without length remain valid');
  assert.equal(definition.default, 2 * CATALOG.beam.primitives[0].halfExtents[0]);
  assert.deepEqual([definition.minimum, definition.maximum, definition.unit], [0.1, 1, 'm']);
  const implicit = createPart('beam', 'implicit', [0, 1, 0]);
  delete implicit.parameters.length;
  assert.deepEqual(partPrimitives(implicit)[0].halfExtents, CATALOG.beam.primitives[0].halfExtents);
});

test('length scales the beam along its axis: half extent, mass and end faces follow, section does not', () => {
  const short = beamAt('a', [0, 1, 0], 0.25),
    long = beamAt('b', [0, 1, 0], 0.9);
  assert.deepEqual(partPrimitives(short)[0].halfExtents, [0.125, 0.02, 0.02]);
  assert.deepEqual(partPrimitives(long)[0].halfExtents, [0.45, 0.02, 0.02]);
  const density = MATERIALS.aluminium.density,
    bp = (part) => ({ ...createEmptyBlueprint('t', 'T'), parts: [part] });
  assert.ok(Math.abs(mass(bp(short)) - 8 * 0.125 * 0.02 * 0.02 * density) < 1e-9);
  assert.ok(Math.abs(mass(bp(long)) - 8 * 0.45 * 0.02 * 0.02 * density) < 1e-9);
  const faces = (part) => Object.fromEntries(surfaceRegions(part).map((r) => [r.id, r]));
  assert.deepEqual(faces(long).right.position, [0.45, 0, 0]);
  assert.deepEqual(faces(long).left.position, [-0.45, 0, 0]);
  assert.deepEqual(faces(long).top.halfSize, [0.45, 0.02], 'long faces grow with length');
  assert.deepEqual(faces(long).right.halfSize, [0.02, 0.02], 'end faces keep the section');
});

test('beam long faces mount through a section-sized pad; end faces keep their whole face', () => {
  const beam = beamAt('beam', [0, 1, 0], 0.7);
  const pads = Object.fromEntries(surfaceRegions(beam).map((r) => [r.id, r.padHalfSize]));
  for (const face of ['top', 'bottom', 'front', 'back'])
    assert.deepEqual(pads[face], [0.02, 0.02], `${face} pad is the 40 mm section`);
  for (const face of ['left', 'right']) assert.deepEqual(pads[face], [0.02, 0.02]);
  // A beam can now lie flat on a plate (120 mm half-face) and lap across another beam.
  const onPlate = proposeSurfaceMount(
    { ...createEmptyBlueprint('t', 'T'), parts: [createPart('plate', 'plate', [0, 1, 0]), beam] },
    { part: 'beam', sourceRegion: 'bottom', targetPart: 'plate', targetRegion: 'top', u: 0, v: 0, twist: 0, id: 'm1' },
  ).blueprint;
  assert.equal(compileAssembly(onPlate).connections[0].reasonCode, 'OK');
  const crossing = proposeSurfaceMount(
    { ...createEmptyBlueprint('t', 'T'), parts: [beamAt('rail', [0, 1, 0], 0.7), beamAt('cross', [0, 2, 0], 0.5)] },
    { part: 'cross', sourceRegion: 'bottom', targetPart: 'rail', targetRegion: 'top', u: 0.2, v: 0, twist: Math.PI / 2, id: 'm2' },
  ).blueprint;
  assert.equal(compileAssembly(crossing).connections[0].reasonCode, 'OK');
});

test('a committed save without length loads unchanged and compiles to the same configuration', () => {
  const text = readFileSync(GATE, 'utf8');
  const loaded = loadSave(text);
  assert.equal(loaded.ok, true);
  const gate = loaded.blueprint.parts.find((p) => p.id === 'gate');
  assert.equal(gate.type, 'beam');
  assert.equal('length' in gate.parameters, false, 'load copies parameters; it never derives one');
  assert.deepEqual(loaded.blueprint, JSON.parse(text), 'load preserves the saved bytes');
  const index = loaded.blueprint.parts.indexOf(gate);
  const body = compileAssembly(loaded.blueprint).configuration.bodies[index];
  assert.deepEqual(body.halfExtents, [0.2, 0.02, 0.02]);
  assert.ok(Math.abs(body.mass - 8 * 0.2 * 0.02 * 0.02 * MATERIALS.aluminium.density) < 1e-9);
});

test('schema bounds length and names the field in the explanation', () => {
  const save = (length) => {
    const bp = { ...createEmptyBlueprint('t', 'T'), parts: [beamAt('beam', [0, 1, 0])] };
    bp.parts[0].parameters.length = length;
    return loadSave(JSON.stringify(bp));
  };
  for (const bad of [0.05, 1.5, 'x', null]) {
    const rejected = save(bad);
    assert.equal(rejected.ok, false, `rejects ${bad}`);
    assert.equal(rejected.reasonCode, 'INVALID_BLUEPRINT');
    assert.equal(rejected.path, '/parts/0/parameters/length');
    assert.match(explainFailure(rejected, {}), /Length/);
  }
  for (const edge of [0.1, 1]) assert.equal(save(edge).ok, true, `admits ${edge}`);
});

test('renaming and rig placement never change a beam whose length and material are fixed', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1000000 }),
      fc.double({ min: 0.1, max: 1, noNaN: true }),
      fc.constantFrom(...Object.keys(MATERIALS)),
      fc.tuple(
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
        fc.double({ min: -50, max: 50, noNaN: true }),
      ),
      (seed, length, material, position) => {
        const make = (id, name, at) => {
          const part = beamAt(id, at, length);
          part.name = name;
          part.authoredMaterial.body = material;
          return { ...createEmptyBlueprint(id, name), parts: [part] };
        };
        const reference = compileAssembly(make('beam', 'Beam', [0, 1, 0])).configuration.bodies[0];
        const perturbed = compileAssembly(make(`p-${seed}`, `Renamed ${seed}`, position)).configuration.bodies[0];
        assert.deepEqual(perturbed.halfExtents, reference.halfExtents);
        assert.equal(perturbed.mass, reference.mass);
        assert.equal(perturbed.friction, reference.friction);
        assert.equal(perturbed.restitution, reference.restitution);
        assert.ok(Math.abs(perturbed.mass - 8 * (length / 2) * 0.02 * 0.02 * MATERIALS[material].density) < 1e-9);
      },
    ),
    { numRuns: 60 },
  );
  // Counterexample: mass derived from identity rather than the authored choices fails the property.
  const fromName = (bp) => {
    const compiled = compileAssembly(bp);
    compiled.configuration.bodies[0].mass *= bp.parts[0].name.length;
    return compiled;
  };
  const named = (name) => {
    const part = beamAt('beam', [0, 1, 0], 0.5);
    part.name = name;
    return fromName({ ...createEmptyBlueprint('t', 'T'), parts: [part] }).configuration.bodies[0].mass;
  };
  assert.notEqual(named('A'), named('Renamed beam'), 'identity-derived mass violates the property');
});

test('a length change keeps long-face mounts that still fit and rejects the rest atomically', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'beam', id: 'rail', position: [0, 1, 0] });
    await w.act({ type: 'place', partType: 'spacerBlock', id: 'block', position: [0, 2, 0] });
    const mounted = await w.act({
      type: 'surface-mount', part: 'block', sourceRegion: 'bottom', targetPart: 'rail',
      targetRegion: 'top', u: 0.15, v: 0, twist: 0, id: 'mount',
    });
    assert.equal(mounted.ok, true);
    assert.equal((await w.act({ type: 'parameter', id: 'rail', key: 'length', value: 0.35 })).ok, true);
    const before = w.observe();
    const rejected = await w.act({ type: 'parameter', id: 'rail', key: 'length', value: 0.25 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reasonCode, 'SURFACE_OUT_OF_BOUNDS');
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, before.frames[0].metadata.blueprint);
    assert.deepEqual(w.observe().frames[0].metadata.editing, before.frames[0].metadata.editing);
  } finally {
    w.dispose();
  }
});

test('a length change that would move a surface peer is rejected, then admitted once detached', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'beam', id: 'beam', position: [0, 1, 0] });
    await w.act({ type: 'place', partType: 'spacerBlock', id: 'cap', position: [1, 1, 0] });
    assert.equal(
      (await w.act({
        type: 'surface-mount', part: 'cap', sourceRegion: 'left', targetPart: 'beam',
        targetRegion: 'right', u: 0, v: 0, twist: 0, id: 'end',
      })).ok,
      true,
    );
    const before = w.observe();
    const rejected = await w.act({ type: 'parameter', id: 'beam', key: 'length', value: 0.6 });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reasonCode, 'SURFACE_RESIZE_MOVES_MOUNT');
    assert.match(explainFailure(rejected, before.frames[0].metadata.blueprint), /Detach/);
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, before.frames[0].metadata.blueprint);
    assert.deepEqual(w.observe().frames[0].metadata.editing, before.frames[0].metadata.editing);
    assert.ok(
      w.observe().frames[0].metadata.connections.every((c) => c.reasonCode === 'OK'),
      'no connection is left misaligned',
    );
    assert.equal((await w.act({ type: 'disconnect', id: 'end' })).ok, true);
    // Detached but still in the way: the ordinary overlap rule now owns the rejection.
    assert.equal(
      (await w.act({ type: 'parameter', id: 'beam', key: 'length', value: 0.6 })).reasonCode,
      'SURFACE_OVERLAP',
    );
    assert.equal((await w.act({ type: 'delete', id: 'cap' })).ok, true);
    assert.equal((await w.act({ type: 'parameter', id: 'beam', key: 'length', value: 0.6 })).ok, true);
  } finally {
    w.dispose();
  }
});

test('a beam mounted by its own end face cannot be resized in place (guided-suspension bridge)', async () => {
  const w = await createWorkshop(createPassiveSuspensionCart());
  try {
    const bp = w.observe().frames[0].metadata.blueprint;
    const endMounted = bp.connections.find((c) =>
      [c.a, c.b].some((e) => e.surface && ['left', 'right'].includes(e.surface.region) && bp.parts.find((p) => p.id === e.part)?.type === 'beam'),
    );
    assert.ok(endMounted, 'fixture mounts a beam by an end face');
    const beam = [endMounted.a, endMounted.b].map((e) => bp.parts.find((p) => p.id === e.part)).find((p) => p.type === 'beam');
    const rejected = await w.act({ type: 'parameter', id: beam.id, key: 'length', value: 0.5 });
    assert.equal(rejected.reasonCode, 'SURFACE_RESIZE_MOVES_MOUNT');
    assert.deepEqual(w.observe().frames[0].metadata.blueprint, bp);
  } finally {
    w.dispose();
  }
});

test('the resize rule is not type dispatch: a wheel with an attached axle still resizes', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'gripWheel', id: 'wheel', position: [0, 1, 0] });
    await w.act({ type: 'place', partType: 'steelAxle', id: 'axle', position: [-0.3, 1, 0] });
    assert.equal(
      (await w.act({ type: 'connect', id: 'shaft', a: { part: 'axle', port: 'right' }, b: { part: 'wheel', port: 'axle' } })).ok,
      true,
    );
    assert.equal((await w.act({ type: 'parameter', id: 'wheel', key: 'diameter', value: 0.3 })).ok, true);
  } finally {
    w.dispose();
  }
});

test('a length that would intersect a neighbour is rejected on the command path', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'beam', id: 'beam', position: [0, 1, 0] });
    await w.act({ type: 'place', partType: 'beam', id: 'wall', position: [0.5, 1, 0] });
    const rejected = await w.act({ type: 'parameter', id: 'beam', key: 'length', value: 0.9 });
    assert.equal(rejected.reasonCode, 'SURFACE_OVERLAP');
    // A placed part stores the explicit default; the rejected edit leaves it untouched.
    assert.equal(w.observe().frames[0].metadata.blueprint.parts[0].parameters.length, 0.4);
  } finally {
    w.dispose();
  }
});

test('duplication and mirroring carry the authored length; they never derive it', async () => {
  const w = await createWorkshop();
  try {
    await w.act({ type: 'place', partType: 'beam', id: 'beam', position: [0, 1, 0] });
    assert.equal((await w.act({ type: 'parameter', id: 'beam', key: 'length', value: 0.7 })).ok, true);
    await w.act({ type: 'place', partType: 'chassis', id: 'reference', position: [-2, 1, 0] });
    const mirrored = await w.act({ type: 'mirror-assembly', ids: ['beam'], referenceId: 'reference', axis: 'x' });
    assert.equal(mirrored.ok, true);
    const parts = w.observe().frames[0].metadata.blueprint.parts.filter((p) => p.type === 'beam');
    assert.equal(parts.length, 2);
    for (const part of parts) assert.equal(part.parameters.length, 0.7);
  } finally {
    w.dispose();
  }
});

test('the catalog refuses a length default that disagrees with its canonical primitive', async () => {
  const { assertDimensionDefaults } = await import('../src/model/catalog.mjs');
  assert.doesNotThrow(() => assertDimensionDefaults(CATALOG));
  const wrong = structuredClone(CATALOG);
  wrong.beam.parameterDefinitions.length.default = 0.5;
  assert.throws(() => assertDimensionDefaults(wrong), /beam/);
});
