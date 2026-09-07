import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { proposeSurfaceMount, snapConnection, compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { controlBindingPreset } from '../src/model/control-bindings.mjs';
import { partPrimitives } from '../src/model/geometry.mjs';
import { rotateVector, normalizeQuaternion } from '../src/model/transforms.mjs';
import { transformGroup } from '../src/model/editing.mjs';
import * as mirror from '../src/model/mirror-assembly.mjs';
function fixture() {
  let bp = createEmptyBlueprint('mirror', 'Mirror');
  bp.parts.push(
    createPart('chassis', 'base', [0, 1, 0]),
    createPart('poweredMotor', 'motor', [1, 1, 0]),
  );
  bp = proposeSurfaceMount(bp, {
    part: 'motor',
    sourceRegion: 'left',
    targetPart: 'base',
    targetRegion: 'right',
    id: 'mount',
    u: 0,
    v: 0.1,
    twist: 0,
  }).blueprint;
  bp.parts.push(createPart('gripWheel', 'wheel', [2, 1, 0]));
  bp = snapConnection(bp, { part: 'motor', port: 'shaft' }, { part: 'wheel', port: 'axle' });
  bp.connections.push({
    id: 'axle',
    kind: 'shaft',
    a: { part: 'motor', port: 'shaft' },
    b: { part: 'wheel', port: 'axle' },
  });
  bp.parts.find((p) => p.id === 'wheel').authoredMaterial.body = 'steel';
  bp.parts.find((p) => p.id === 'motor').parameters.defaultDuty = 0.4;
  bp.parts.push(createPart('powerCell', 'cell', [0, 1, 2]));
  bp.connections.push({
    id: 'wire',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'motor', port: 'power' },
  });
  return bp;
}
test('mirror preview preserves internal shafts and reference mounts, authored choices and input blueprint', () => {
  const bp = fixture(),
    before = structuredClone(bp);
  const out = mirror.proposeMirroredAssembly(bp, {
    ids: ['motor', 'wheel'],
    referenceId: 'base',
    axis: 'x',
  });
  assert.deepEqual(bp, before);
  assert.equal(out.copiedIds.length, 2);
  assert.equal(out.copiedConnectionIds.length, 2);
  assert.deepEqual(out.omittedExternalConnectionIds, ['wire']);
  const wheel = out.blueprint.parts.find((p) => p.id === out.idMap.wheel);
  assert.deepEqual(
    wheel.authoredMaterial,
    before.parts.find((p) => p.id === 'wheel').authoredMaterial,
  );
  assert.equal(
    out.blueprint.parts.find((p) => p.id === out.idMap.motor).parameters.defaultDuty,
    0.4,
  );
  const mount = out.blueprint.connections.find((c) => c.id === out.connectionIdMap.mount);
  assert.equal(mount.a.part, 'base');
  assert.equal(mount.a.surface.region, 'left');
  assert.equal(mount.a.surface.v, -0.1);
  assert.ok(compileAssembly(out.blueprint).connections.every((c) => c.reasonCode === 'OK'));
  assert.ok(out.polarityWarnings.some((w) => w.id === out.idMap.motor));
  for (const id of ['motor', 'wheel']) {
    const original = bp.parts.find((part) => part.id === id),
      copy = out.blueprint.parts.find((part) => part.id === out.idMap[id]);
    for (let mask = 0; mask < 8; mask++) {
      const point = partPrimitives(original)[0].halfExtents.map(
        (extent, i) => extent * (mask & (1 << i) ? 1 : -1),
      );
      const before = rotateVector(original.rotation, point).map(
        (value, i) => value + original.position[i],
      );
      const after = rotateVector(copy.rotation, [point[0], point[1], -point[2]]).map(
        (value, i) => value + copy.position[i],
      );
      assert.ok(
        after.every((value, i) => Math.abs(value - before[i] * (i === 0 ? -1 : 1)) < 1e-10),
        'every transformed envelope corner must be the actual reflected corner',
      );
    }
  }
});

test('hinge Y-axis and hub X-axis assembly mirrors together with internal receiver signal and explicit polarity warning', () => {
  let bp = createEmptyBlueprint('steering-mirror', 'Steering mirror');
  bp.parts = [
    createPart('chassis', 'base', [0, 1, 0]),
    createPart('poweredHinge', 'hinge', [1, 1, 0]),
  ];
  bp = proposeSurfaceMount(bp, {
    part: 'hinge',
    sourceRegion: 'bottom',
    targetPart: 'base',
    targetRegion: 'top',
    u: -0.08,
    v: 0,
    twist: Math.PI,
    id: 'hinge-mount',
  }).blueprint;
  for (const [type, id, previous, previousPort, port] of [
    ['wheelHub', 'hub', 'hinge', 'shaft', 'steering'],
    ['gripWheel', 'wheel', 'hub', 'shaft', 'axle'],
  ]) {
    bp.parts.push(createPart(type, id, [2, 2, 0]));
    const a = { part: previous, port: previousPort },
      b = { part: id, port };
    bp = snapConnection(bp, a, b);
    bp.connections.push({ id: `${id}-joint`, kind: 'shaft', a, b });
  }
  const receiver = createPart('commandReceiver', 'receiver', [0.4, 1.5, 0.5]);
  receiver.controlBinding = controlBindingPreset('steer');
  bp.parts.push(receiver);
  bp.connections.push({
    id: 'steer-signal',
    kind: 'signal',
    a: { part: 'receiver', port: 'signal' },
    b: { part: 'hinge', port: 'signal' },
  });
  const out = mirror.proposeMirroredAssembly(bp, {
    ids: ['hinge', 'hub', 'wheel', 'receiver'],
    referenceId: 'base',
    axis: 'x',
  });
  assert.equal(out.copiedConnectionIds.length, 4);
  assert.ok(
    compileAssembly(out.blueprint).connections.every(
      (connection) => connection.reasonCode === 'OK',
    ),
  );
  assert.deepEqual(
    out.blueprint.parts.find((part) => part.id === out.idMap.receiver).controlBinding,
    receiver.controlBinding,
  );
  assert.ok(out.polarityWarnings.some((warning) => warning.id === out.idMap.hinge));
  assert.ok(out.polarityWarnings.some((warning) => warning.id === out.idMap.receiver));
});
test('reflection is an involution across rotated reference local planes with proper rotations', () => {
  const pose = { position: [1, 2, 3], rotation: [0.2, 0, 0, Math.sqrt(0.96)] };
  const reference = { position: [0.3, 0.4, 0.5], rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)] };
  for (const axis of ['x', 'y', 'z']) {
    const once = mirror.reflectPose(pose, reference, axis),
      twice = mirror.reflectPose(once, reference, axis);
    twice.position.forEach((value, i) => assert.ok(Math.abs(value - pose.position[i]) < 1e-12));
    assert.ok(
      Math.abs(
        Math.abs(twice.rotation.reduce((sum, value, i) => sum + value * pose.rotation[i], 0)) - 1,
      ) < 1e-12,
    );
    assert.ok(Math.abs(Math.hypot(...once.rotation) - 1) < 1e-12);
  }
});
test('surface mirrors preserve reflected poses with either reference endpoint, rotated frames and pad bounds', () => {
  for (const twist of [0, 0.13])
    for (const rotation of [[0, 0, 0, 1], normalizeQuaternion([0.2, -0.3, 0.4, 0.7])])
      for (const referenceId of ['pad', 'parent']) {
        let bp = createEmptyBlueprint('surface-mirror', 'Surface mirror');
        bp.parts = [
          createPart('chassis', 'parent', [0, 1, 0]),
          createPart('plate', 'pad', [0, 2, 0]),
        ];
        bp = proposeSurfaceMount(bp, {
          part: 'pad',
          sourceRegion: 'bottom',
          targetPart: 'parent',
          targetRegion: 'top',
          id: 'mount',
          twist,
        }).blueprint;
        bp = transformGroup(bp, 'parent', [0.3, 2, -0.4], rotation);
        const before = structuredClone(bp),
          id = referenceId === 'pad' ? 'parent' : 'pad',
          original = bp.parts.find((part) => part.id === id),
          reference = bp.parts.find((part) => part.id === referenceId),
          out = mirror.proposeMirroredAssembly(bp, { ids: [id], referenceId, axis: 'y' }),
          copy = out.blueprint.parts.find((part) => part.id === out.idMap[id]),
          edge = out.blueprint.connections.find(
            (connection) => connection.id === out.connectionIdMap.mount,
          );
        assert.deepEqual(bp, before);
        assert.equal(edge.b.surface.twist, 0, 'source pad keeps its canonical zero twist');
        assert.equal(edge.b.surface.u, 0);
        assert.equal(edge.b.surface.v, 0);
        assert.equal(loadSave(out.blueprint).ok, true);
        assert.ok(compileAssembly(out.blueprint).connections.every((c) => c.reasonCode === 'OK'));
        // Independent world reflection: canonicalizing endpoints cannot move the solids.
        const local = [0.035, 0.043, -0.071],
          normal = rotateVector(reference.rotation, [0, 1, 0]),
          point = rotateVector(original.rotation, local).map(
            (value, i) => value + original.position[i],
          ),
          distance = point.reduce(
            (sum, value, i) => sum + (value - reference.position[i]) * normal[i],
            0,
          ),
          actual = rotateVector(copy.rotation, [local[0], local[1], -local[2]]).map(
            (value, i) => value + copy.position[i],
          );
        actual.forEach((value, i) =>
          assert.ok(Math.abs(value - (point[i] - 2 * distance * normal[i])) < 1e-12),
        );
        const outside = structuredClone(out.blueprint);
        outside.connections.find((c) => c.id === edge.id).a.surface.u = 1;
        assert.equal(
          loadSave(outside).reasonCode,
          'SURFACE_OUT_OF_BOUNDS',
          'real pad overflow remains rejected',
        );
      }
});
test('mirror rejects occupied destinations, invalid selections and unavailable reference faces without changing input', () => {
  const bp = fixture(),
    before = structuredClone(bp);
  const out = mirror.proposeMirroredAssembly(bp, {
    ids: ['motor', 'wheel'],
    referenceId: 'base',
    axis: 'x',
  });
  assert.throws(
    () =>
      mirror.proposeMirroredAssembly(out.blueprint, {
        ids: ['motor', 'wheel'],
        referenceId: 'base',
        axis: 'x',
      }),
    (e) =>
      (e.reasonCode === 'SURFACE_OVERLAP' || e.reasonCode === 'PORT_OCCUPIED') &&
      Array.isArray(e.previewBlueprint?.parts),
  );
  for (const ids of [[], ['motor', 'motor'], ['base'], ['missing']])
    assert.throws(() =>
      mirror.proposeMirroredAssembly(bp, { ids, referenceId: 'base', axis: 'x' }),
    );
  assert.throws(() =>
    mirror.proposeMirroredAssembly(bp, { ids: ['motor'], referenceId: 'base', axis: 'diagonal' }),
  );
  assert.deepEqual(bp, before);
  let unsupported = createEmptyBlueprint('unsupported', 'Unsupported');
  unsupported.parts = [
    createPart('poweredMotor', 'reference', [0, 1, 0]),
    createPart('commandReceiver', 'source', [1, 1, 0]),
  ];
  unsupported = proposeSurfaceMount(unsupported, {
    part: 'source',
    sourceRegion: 'bottom',
    targetPart: 'reference',
    targetRegion: 'left',
    id: 'mount',
  }).blueprint;
  assert.throws(
    () =>
      mirror.proposeMirroredAssembly(unsupported, {
        ids: ['source'],
        referenceId: 'reference',
        axis: 'x',
      }),
    (error) => error.reasonCode === 'MIRROR_UNREPRESENTABLE',
  );
});
test('mirror core transaction is atomic and undoable, rejects stale previews and edits outside Build', async () => {
  const bp = fixture(),
    workshop = await createWorkshop(bp);
  try {
    const command = {
      type: 'mirror-assembly',
      ids: ['motor', 'wheel'],
      referenceId: 'base',
      axis: 'x',
    };
    const before = workshop.observe();
    assert.equal((await workshop.act({ ...command, expectedCursor: before.cursor })).ok, true);
    const after = workshop.observe();
    assert.equal(after.frames[0].metadata.blueprint.parts.length, bp.parts.length + 2);
    assert.equal(after.frames[0].metadata.editing.undoCount, 1);
    assert.equal((await workshop.act(command)).ok, false);
    assert.deepEqual(workshop.observe(), after);
    assert.equal((await workshop.act({ type: 'undo' })).ok, true);
    assert.deepEqual(workshop.observe().frames[0].metadata.blueprint, bp);
    assert.equal(
      (await workshop.act({ ...command, expectedCursor: before.cursor })).reasonCode,
      'STALE_PROPOSAL',
    );
    assert.equal((await workshop.act({ type: 'redo' })).ok, true);
    assert.deepEqual(
      workshop.observe().frames[0].metadata.blueprint,
      after.frames[0].metadata.blueprint,
    );
    await workshop.act({ type: 'run' });
    assert.equal((await workshop.act(command)).reasonCode, 'EDIT_REQUIRES_BUILD');
  } finally {
    workshop.dispose();
  }
});
