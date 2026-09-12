import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterVehicle } from '../src/model/starter-vehicle.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createObservationStore, immutableCopy } from '../src/model/observation.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';

const sensorBlueprint = () => {
  const bp = createEmptyBlueprint('sensor', 'Sensor');
  bp.parts.push(createPart('rotationSensor', 'sensor', [0, 2, 0]));
  return bp;
};
const corruptSensors = (cp, speed) => {
  cp.sensors.bodies[0].rotation = [1e308, 1e308, 1e308, 1e308];
  cp.sensors.bodies[0].angularVelocity = [1e308, 1e308, 1e308];
  cp.sensors.readings[0].channels.angularSpeed = { status: 'ok', value: speed };
};

test('accepted near-unit rotations preserve both clear and obstructed surface admission', async () => {
  const clear = createStarterVehicle(),
    scaled = structuredClone(clear);
  for (const part of scaled.parts) part.rotation = part.rotation.map((v) => v * (1 - 1e-9));
  assert.equal(loadSave(scaled).ok, true);
  assert.deepEqual(compileAssembly(scaled).configuration, compileAssembly(clear).configuration);
  for (const bp of [clear, scaled]) {
    bp.parts.push(
      createPart('beam', 'obstruction', [...bp.parts.find((p) => p.id === 'motor').position]),
    );
    assert.equal(loadSave(bp).reasonCode, 'SURFACE_OVERLAP');
    await assert.rejects(createWorkshop(bp), /SURFACE_OVERLAP/);
  }
});

test('public checkpoint restore rejects overflow-derived null readings atomically', async () => {
  const w = await createWorkshop(sensorBlueprint());
  try {
    w.step();
    const good = w.checkpoint();
    w.step();
    w.restore(good);
    assert.deepEqual(w.observe().frames[0].sensors.readings[0].channels.angularSpeed, {
      status: 'no-power',
    });
    w.step();
    const before = w.checkpoint(),
      cursor = w.observe().cursor,
      bad = structuredClone(good);
    corruptSensors(bad, null);
    assert.throws(() => w.restore(bad), /INVALID_CHECKPOINT/);
    assert.deepEqual(w.checkpoint(), before);
    assert.deepEqual(w.observe().cursor, cursor);
  } finally {
    w.dispose();
  }
});

test('session rejects nonfinite and malformed sensor checkpoints before replacing owners', async () => {
  const s = await createSession(compileAssembly(sensorBlueprint()).configuration);
  try {
    s.step();
    const good = s.checkpoint();
    s.step();
    const before = s.checkpoint(),
      cursor = s.observe().cursor;
    const bad = structuredClone(good);
    corruptSensors(bad, Infinity);
    assert.throws(() => s.restore(bad), /INVALID_CHECKPOINT/);
    assert.deepEqual(s.checkpoint(), before);
    assert.deepEqual(s.observe().cursor, cursor);
    for (const mutate of [
      (cp) => (cp.sensors.readings[0].speed = null),
      (cp) => (cp.sensors.readings[0].extra = 0),
      (cp) => (cp.sensors.readings = []),
      (cp) => (cp.sensors.bodies[0].rotation = [0, 0, 0, 2]),
    ]) {
      const cp = structuredClone(good);
      mutate(cp);
      assert.throws(() => s.restore(cp), /INVALID_CHECKPOINT/);
      assert.deepEqual(s.checkpoint(), before);
    }
    s.restore(good);
    s.step();
    assert.deepEqual(s.checkpoint().physics, before.physics);
  } finally {
    s.dispose();
  }
});

test('trusted immutable metadata is shared while caller-frozen nested data is copied', () => {
  const caller = { blueprint: { parts: [{ id: 'part' }] } };
  Object.freeze(caller);
  const metadata = immutableCopy(caller),
    store = createObservationStore({ tick: 0, metadata }, { sessionId: 'sharing', maxDeltas: 2 });
  const zero = store.cursor();
  store.publish({ tick: 1, metadata });
  store.publish({ tick: 2, metadata });
  const frames = store.observe('scene', 'full', zero).frames;
  assert.strictEqual(frames[0].metadata, frames[1].metadata);
  caller.blueprint.parts[0].id = 'mutated';
  assert.equal(frames[0].metadata.blueprint.parts[0].id, 'part');
  assert.throws(() => {
    frames[0].metadata.blueprint.parts[0].id = 'bad';
  });
  store.publish({ tick: 3, metadata });
  assert.equal(store.observe('scene', 'full', zero).reasonCode, 'RESYNC_REQUIRED');
});

test('completed tick timing includes publication and checkpoint cost but not deterministic state', async () => {
  const s = await createSession(compileAssembly(sensorBlueprint()).configuration);
  try {
    s.step(1200);
    const frame = s.observe().frames[0],
      timing = frame.tickTiming;
    assert.ok(timing);
    assert.ok(timing.publicationMs > 0);
    assert.ok(timing.checkpointMs > 0);
    for (const value of Object.values(timing)) assert.ok(Number.isFinite(value) && value >= 0);
    assert.ok(
      Math.abs(
        timing.totalMs -
          timing.phaseMs -
          timing.checkpointMs -
          timing.publicationMs -
          timing.frameMs -
          timing.overheadMs,
      ) < 1e-6,
    );
    const changed = structuredClone(frame);
    changed.tickTiming.totalMs += 999;
    changed.phaseTimings.telemetry += 999;
    assert.deepEqual(deterministicProjection(changed), deterministicProjection(frame));
    const cp = s.checkpoint();
    s.step();
    assert.equal(s.observe().frames[0].tickTiming.checkpointMs, 0);
    s.restore(cp);
    s.step();
    assert.equal(s.observe().cursor.tick, 1201);
  } finally {
    s.dispose();
  }
});

test('rename retains physical state and epoch while exact no-op retains cursor and edit history', async () => {
  const w = await createWorkshop(sensorBlueprint());
  try {
    w.step(2);
    const before = w.checkpoint(),
      cursor = w.observe().cursor;
    assert.equal((await w.act({ type: 'rename', id: 'sensor', name: 'Renamed sensor' })).ok, true);
    assert.equal(w.observe().cursor.tick, cursor.tick);
    assert.equal(w.observe().cursor.epoch, cursor.epoch);
    assert.equal(w.observe().cursor.revision, cursor.revision + 1);
    assert.deepEqual(w.checkpoint().physics, before.physics);
    assert.deepEqual(w.checkpoint().sensors, before.sensors);
    assert.equal(w.save().parts[0].name, 'Renamed sensor');
    const after = w.observe(),
      checkpoint = w.checkpoint();
    assert.equal((await w.act({ type: 'rename', id: 'sensor', name: 'Renamed sensor' })).ok, true);
    assert.deepEqual(w.observe(), after);
    assert.deepEqual(w.checkpoint(), checkpoint);
    assert.equal((await w.act({ type: 'undo' })).ok, true);
    assert.notEqual(w.save().parts[0].name, 'Renamed sensor');
  } finally {
    w.dispose();
  }
});
