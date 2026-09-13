import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { sceneParts } from '../src/presentation/capture-review-model.mjs';
import { assertRejectedEditUnchanged, assertNoOpEditUnchanged } from './contracts/editing.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';

const machine = () => {
  const b = createEmptyBlueprint('environment-test', 'Environment test');
  b.parts.push(createPart('beam', 'beam', [0, 2, 0]));
  return b;
};
test('saved environment admits only fixed presets and compiles exact geometry after the ground', () => {
  const flat = machine(),
    bump = { ...flat, environment: 'rounded-bump' };
  assert.equal(loadSave(bump).ok, true);
  for (const environment of [null, {}, [], true, 'unknown', 1])
    assert.equal(loadSave({ ...flat, environment }).ok, false);
  const a = compileAssembly(flat),
    b = compileAssembly(bump),
    body = b.configuration.bodies.at(-1);
  assert.equal(b.configuration.bodies.length, a.configuration.bodies.length + 1);
  assert.deepEqual(b.configuration.bodies.slice(0, -1), a.configuration.bodies);
  assert.deepEqual(body, {
    shape: 'cylinder',
    halfExtents: [1, 0.03, 0.03],
    position: [0.14, -0.02, -0.6],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    mass: 1,
    fixed: true,
    friction: 0.8,
    restitution: 0,
  });
  assert.equal(body.position[1] + body.halfExtents[1], 0.009999999999999998);
  const renamed = structuredClone(bump);
  renamed.id = 'unrelated';
  renamed.name = 'Not a suspension example';
  renamed.parts[0].id = 'different';
  assert.deepEqual(compileAssembly(renamed).configuration, b.configuration);
  assert.equal(compileAssembly(flat, { ground: null }).configuration.bodies.length, 1);
  assert.deepEqual(compileAssembly(bump, { ground: null }).configuration.bodies, [
    a.configuration.bodies[0],
    body,
  ]);
});
test('environment selection is an atomic Build edit with save, history and checkpoint identity', async () => {
  const w = await createWorkshop(machine());
  try {
    await assertNoOpEditUnchanged(w, { type: 'choose-environment', environment: 'flat' });
    for (const command of [
      { type: 'choose-environment', environment: 'unknown' },
      { type: 'choose-environment', environment: null },
      { type: 'choose-environment', environment: 'rounded-bump', extra: 1 },
    ])
      await assertRejectedEditUnchanged(w, command);
    assert.equal(
      (await w.act({ type: 'choose-environment', environment: 'rounded-bump' })).ok,
      true,
    );
    const saved = w.save();
    assert.equal(saved.environment, 'rounded-bump');
    await assertNoOpEditUnchanged(w, { type: 'choose-environment', environment: 'rounded-bump' });
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.equal(w.save().environment, undefined);
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.deepEqual(w.save(), saved);
    assert.equal((await w.act({ type: 'run' })).ok, true);
    await assertRejectedEditUnchanged(w, { type: 'choose-environment', environment: 'flat' });
    w.step(3);
    const cp = w.checkpoint();
    w.step(4);
    const expected = w.observe().frames[0].physics;
    w.restore(cp);
    w.step(4);
    assert.deepEqual(w.observe().frames[0].physics, expected);
    const bad = structuredClone(cp);
    bad.metadata.blueprint.environment = 'flat';
    const before = w.observe();
    assert.throws(() => w.restore(bad));
    assert.deepEqual(w.observe(), before);
    const loaded = await createWorkshop(saved);
    try {
      assert.deepEqual(loaded.save(), saved);
      assert.equal(loaded.observe().frames[0].physics.length, 3);
    } finally {
      loaded.dispose();
    }
  } finally {
    w.dispose();
  }
});
test('bump overlap rejects selection and loading without inventing contact at empty cylinder corners', async () => {
  const b = machine();
  b.parts[0].position = [0.14, 0, -0.6];
  const w = await createWorkshop(b);
  try {
    await assertRejectedEditUnchanged(w, {
      type: 'choose-environment',
      environment: 'rounded-bump',
    });
  } finally {
    w.dispose();
  }
  assert.throws(() => compileAssembly({ ...b, environment: 'rounded-bump' }), /SURFACE_OVERLAP/);
  const clear = machine();
  clear.environment = 'rounded-bump';
  clear.parts[0].position = [0.14, 0.02, -0.555];
  assert.doesNotThrow(() => compileAssembly(clear));
});
test('assembly insertion retains receiving environment and does not import source terrain', () => {
  const source = machine();
  source.environment = 'rounded-bump';
  const { definition } = captureAssembly(source, { name: 'Beam module', ids: ['beam'], ports: [] });
  assert.equal(definition.environment, undefined);
  const flat = createEmptyBlueprint('target', 'Target');
  const inserted = insertAssembly(flat, definition, [0, 2, 0], [0, 0, 0, 1]);
  assert.equal(inserted.blueprint.environment, undefined);
  const rounded = { ...flat, environment: 'rounded-bump' };
  assert.equal(
    insertAssembly(rounded, definition, [0, 2, 0], [0, 0, 0, 1]).blueprint.environment,
    'rounded-bump',
  );
});

test('recorded scene includes the same saved environment geometry without part identity authority', () => {
  const blueprint = machine();
  assert.equal(sceneParts({ metadata: { blueprint } }).length, 1);
  blueprint.environment = 'rounded-bump';
  const shape = sceneParts({ metadata: { blueprint } }).at(-1);
  assert.deepEqual(shape.position, [0.14, -0.02, -0.6]);
  assert.deepEqual(shape.rotation, [0, 0, 0, 1]);
  assert.deepEqual(shape.primitives, [{ kind: 'cylinder', halfExtents: [1, 0.03, 0.03] }]);
  blueprint.environment = 'unknown';
  assert.throws(() => sceneParts({ metadata: { blueprint } }));
});

test('environment overlap admission retains canonical protruding shaft envelopes', () => {
  const blueprint = createEmptyBlueprint('shaft-clearance', 'Shaft clearance');
  blueprint.environment = 'rounded-bump';
  const motor = createPart('poweredMotor', 'motor', [0.14, 0.115, -0.6]);
  motor.rotation = [0, 0, -Math.SQRT1_2, Math.SQRT1_2];
  blueprint.parts.push(motor);
  assert.throws(() => compileAssembly(blueprint), /SURFACE_OVERLAP/);
});

test('authored scene retains machine order, material, stable identities and chronological history', async () => {
  const scene = {
    objects: [
      {
        id: 'platform',
        name: 'Platform',
        shape: 'box',
        halfExtents: [0.2, 0.05, 0.2],
        position: [1, 0.05, 0],
        rotation: [0, 0, 0, 1],
        material: 'steel',
        friction: 0.7,
        restitution: 0,
        fixed: true,
      },
    ],
    ground: { friction: 0.6, restitution: 0 },
  };
  const w = await createWorkshop(machine());
  try {
    const original = w.save();
    const cursor = w.observe().cursor;
    assert.equal(
      (await w.act({ type: 'replace-scene', environment: scene, expectedCursor: cursor })).ok,
      true,
    );
    assert.deepEqual(w.save().parts, original.parts);
    assert.deepEqual(w.save().environment, scene);
    const compiled = compileAssembly(w.save());
    const renamed = structuredClone(w.save());
    renamed.environment.objects[0].id = 'renamed';
    renamed.environment.objects[0].name = 'No physical authority';
    assert.deepEqual(compileAssembly(renamed).configuration, compiled.configuration);
    assert.deepEqual(compiled.mapping, compileAssembly(original).mapping);
    assert.equal(compiled.configuration.bodies.at(-1).mass, 0.4 * 0.1 * 0.4 * 7850);
    assert.equal(compiled.configuration.bodies.at(-1).fixed, true);
    assert.equal(sceneParts({ metadata: { blueprint: w.save() } }).at(-1).id, 'scene-platform');
    await assertRejectedEditUnchanged(w, {
      type: 'replace-scene',
      environment: scene,
      expectedCursor: cursor,
    });
    const saved = w.save();
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.deepEqual(w.save(), original);
    assert.equal((await w.act({ type: 'redo' })).ok, true);
    assert.deepEqual(w.save(), saved);
    const bad = structuredClone(scene);
    bad.objects.push(structuredClone(bad.objects[0]));
    await assertRejectedEditUnchanged(w, {
      type: 'replace-scene',
      environment: bad,
      expectedCursor: w.observe().cursor,
    });
    bad.objects[1].id = 'other';
    await assertRejectedEditUnchanged(w, {
      type: 'replace-scene',
      environment: bad,
      expectedCursor: w.observe().cursor,
    });
    assert.equal(loadSave(saved).ok, true);
    await w.act({ type: 'run' });
    w.step(12);
    const checkpoint = w.checkpoint();
    w.step(6);
    const expected = w.observe().frames[0].physics;
    w.restore(checkpoint);
    w.step(6);
    assert.deepEqual(w.observe().frames[0].physics, expected);
    await assertRejectedEditUnchanged(w, {
      type: 'replace-scene',
      environment: scene,
      expectedCursor: w.observe().cursor,
    });
  } finally {
    w.dispose();
  }
});

test('combined body budget and scene-only settings cannot bypass admission or replacement protection', async () => {
  const { sceneLayout, hasWorkshopContent, createSceneObject } = await import(
    '../src/model/environment.mjs'
  );
  const { validateBlueprint } = await import('../src/model/blueprint.mjs');
  const b = createEmptyBlueprint('capacity', 'Capacity');
  assert.equal(hasWorkshopContent(b), false);
  b.environment = sceneLayout('flat');
  b.environment.ground.friction = 0.3;
  assert.equal(hasWorkshopContent(b), true);
  b.environment = sceneLayout('hill');
  for (let i = 0; i < 4095; i++) b.parts.push(createPart('beam', `beam-${i}`, [0, 2, 0]));
  assert.equal(validateBlueprint(b).ok, true);
  b.environment.objects.push({ ...createSceneObject('block', 'another'), position: [3, 0.025, 0] });
  assert.equal(validateBlueprint(b).ok, false);
  b.parts = [];
  for (const bad of [null, {}, { objects: [], ground: { friction: NaN, restitution: 0 } }])
    assert.equal(loadSave({ ...b, environment: bad }).ok, false);
  const base = sceneLayout('hill');
  for (const mutate of [
    (s) => (s.objects[0].rotation = [0, 0, 0, 0]),
    (s) => (s.objects[0].halfExtents[0] = 0),
    (s) => (s.objects[0].position[0] = Infinity),
    (s) => (s.objects[0].fixed = false),
    (s) => (s.objects[0].material = 'fiction'),
    (s) => (s.objects[0].friction = 3),
    (s) => (s.objects[0].shape = 'wedge'),
    (s) => (s.objects = Array.from({ length: 33 }, (_, i) => ({ ...s.objects[0], id: `a-${i}` }))),
  ]) {
    const s = structuredClone(base);
    mutate(s);
    assert.equal(loadSave({ ...b, environment: s }).ok, false);
  }
  const rotated = structuredClone(base);
  rotated.objects[0].rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  assert.equal(loadSave({ ...b, environment: rotated }).ok, true);
});
