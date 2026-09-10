import test from 'node:test';
import assert from 'node:assert/strict';
import { machineMotion } from '../src/model/motion-readout.mjs';
test('motion readout uses mass-weighted authored bodies and excludes terrain', () => {
  const frame = {
    metadata: { blueprint: { parts: [{}, {}] } },
    physics: [
      { mass: 1, position: [0, 1, 0], velocity: [0, 0, 2] },
      { mass: 3, position: [4, 1, 0], velocity: [0, 0, 0] },
      { mass: 1000, position: [0, 0, 0], velocity: [0, 0, 0] },
    ],
  };
  assert.deepEqual(machineMotion(frame), { center: [3, 1, 0], speed: 0.5 });
  assert.equal(machineMotion({ ...frame, metadata: { blueprint: { parts: [] } } }), null);
  const wrong = structuredClone(frame);
  wrong.physics[1].velocity = [0, 0, 2];
  assert.notEqual(machineMotion(wrong).speed, 0.5);
});
import { BUILD_ENVIRONMENT } from '../src/model/environment.mjs';
import * as motionModel from '../src/model/motion-readout.mjs';
test('workshop floor is 200 metres across and warnings follow actual configured bounds', () => {
  assert.deepEqual(BUILD_ENVIRONMENT.ground.halfExtents, [100, 0.1, 100]);
  const frame = (position) => ({
    metadata: { blueprint: { parts: [{}] } },
    physics: [{ position, mass: 1, velocity: [0, 0, 0] }],
  });
  assert.equal(typeof motionModel.machineBoundary, 'function');
  assert.equal(
    motionModel.machineBoundary(frame([13, 1, 0])),
    null,
    'old24m floor must not determine the new boundary',
  );
  assert.equal(motionModel.machineBoundary(frame([89, 1, 0])), null);
  assert.equal(motionModel.machineBoundary(frame([91, 1, 0])).kind, 'near');
  assert.equal(motionModel.machineBoundary(frame([-101, 1, 0])).kind, 'outside');
  assert.equal(motionModel.machineBoundary(frame([0, -3, 0])).kind, 'fallen');
  const custom = { position: [30, 5, -20], halfExtents: [20, 1, 40] };
  assert.equal(motionModel.machineBoundary(frame([30, 7, -20]), custom), null);
  assert.equal(motionModel.machineBoundary(frame([42, 7, -20]), custom).kind, 'near');
  assert.equal(motionModel.machineBoundary(frame([51, 7, -20]), custom).kind, 'outside');
  assert.equal(motionModel.machineBoundary(frame([30, 3, -20]), custom).kind, 'fallen');
  assert.equal(motionModel.machineBoundary(frame([1000, -100, 0]), null), null);
  assert.match(motionModel.machineBoundary(frame([101, 1, 0])).message, /Return to Build/);
});
test('boundary warning measures authored parts and excludes the terrain body', () => {
  const f = {
    metadata: { blueprint: { parts: [{}] } },
    physics: [
      { position: [0, 1, 0], mass: 1, velocity: [0, 0, 0] },
      { position: [1000, -50, 0], mass: 1000, velocity: [0, 0, 0] },
    ],
  };
  assert.equal(motionModel.machineBoundary(f), null);
  const wrong = structuredClone(f);
  wrong.metadata.blueprint.parts.push({});
  assert.equal(motionModel.machineBoundary(wrong).kind, 'fallen');
});

test('selected-body acceleration uses every completed sample and a declared 100ms filter', () => {
  assert.equal(typeof motionModel.createBodyMotionAccumulator, 'function');
  const recorder = motionModel.createBodyMotionAccumulator();
  for (let tick = 0; tick <= 120; tick++)
    recorder.add({ tick, y: 3 + (tick * tick) / 14400, vy: (2 * tick) / 120 });
  const r = recorder.read();
  assert.equal(r.status, 'ready');
  assert.equal(r.startTick, 0);
  assert.equal(r.endTick, 120);
  assert.equal(r.accelerationSamples, 109);
  assert.equal(r.displacement, 1);
  assert.ok(Math.abs(r.accelerationRms - 2) < 1e-12);
  assert.notEqual(r.accelerationRms, 0, 'a falsely flat acceleration trace must fail');
  recorder.add({ tick: 120, y: 4, vy: 2 });
  assert.deepEqual(recorder.read(), r, 'same tick is not an extra sample');
});
test('selected-body missing, stale, conflicting and nonfinite samples cannot become smooth results', () => {
  assert.equal(typeof motionModel.createBodyMotionAccumulator, 'function');
  for (const bad of [
    { tick: 2, y: 0, vy: 0 },
    { tick: -1, y: 0, vy: 0 },
    { tick: 0, y: 1, vy: 0 },
    { tick: 1, y: NaN, vy: 0 },
    { tick: 1, y: 0, vy: Infinity },
  ]) {
    const r = motionModel.createBodyMotionAccumulator();
    r.add({ tick: 0, y: 0, vy: 0 });
    r.add(bad);
    assert.equal(r.read().status, 'invalid');
    r.add({ tick: 3, y: 0, vy: 0 });
    assert.equal(r.read().status, 'invalid');
    r.reset();
    r.add({ tick: 30, y: 5, vy: 0 });
    assert.equal(r.read().startTick, 30);
    assert.equal(r.read().displacement, 0);
  }
  const r = motionModel.createBodyMotionAccumulator();
  for (let tick = 0; tick < 12; tick++) r.add({ tick, y: 0, vy: 0 });
  assert.equal(r.read().status, 'waiting');
  assert.equal(r.read().accelerationRms, null);
  r.invalidate('history unavailable');
  assert.equal(r.read().status, 'invalid');
  assert.match(r.read().reason, /history/);
});

test('selected measurement lifecycle preserves every tick, isolates selection and exposes history loss', async () => {
  const { createMotionReadout } = await import('../src/presentation/motion-readout.mjs');
  const old = globalThis.document;
  globalThis.document = { createElement: () => ({ append() {}, setAttribute() {}, remove() {} }) };
  const panel = createMotionReadout({ append() {} });
  const blueprint = {
    id: 'machine',
    parts: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  };
  const frame = (tick, mode = 'run') => ({
    tick,
    metadata: { blueprint, mode },
    physics: [2, 3].map((a) => ({
      position: [0, 5 + 0.5 * a * (tick / 120) ** 2, 0],
      velocity: [0, (a * tick) / 120, 0],
      mass: 1,
    })),
  });
  const observation = (frames, epoch = 0) => ({ ok: true, frames, cursor: { epoch } });
  try {
    panel.ingest(observation([frame(0, 'build')]));
    panel.selectBody('a', frame(0, 'build'));
    panel.ingest(observation(Array.from({ length: 121 }, (_, i) => frame(i))));
    assert.ok(Math.abs(panel.readBody().accelerationRms - 2) < 1e-12);
    const paused = panel.readBody();
    panel.ingest(observation([frame(120, 'paused')]));
    assert.deepEqual(panel.readBody(), paused);
    panel.selectBody('b', frame(120));
    panel.ingest(observation(Array.from({ length: 23 }, (_, i) => frame(110 + i))));
    assert.equal(panel.readBody().startTick, 120);
    assert.equal(panel.readBody().accelerationSamples, 1);
    assert.ok(Math.abs(panel.readBody().accelerationRms - 3) < 1e-12);
    panel.ingest(observation([frame(134)]));
    assert.equal(panel.readBody().status, 'invalid');
    panel.setVisible(false);
    panel.ingest(observation([frame(135)]));
    panel.setVisible(true);
    assert.equal(panel.readBody().status, 'invalid');
    panel.ingest({
      ok: false,
      reasonCode: 'RESYNC_REQUIRED',
      cursor: { epoch: 1 },
      frame: frame(50),
    });
    assert.equal(panel.readBody().startTick, 50);
    assert.match(panel.readBody().windowReason, /reset/);
    panel.ingest(
      observation(
        Array.from({ length: 12 }, (_, i) => frame(51 + i)),
        1,
      ),
    );
    assert.equal(panel.readBody().status, 'ready');
    panel.ingest({
      ok: false,
      reasonCode: 'RESYNC_REQUIRED',
      cursor: { epoch: 1 },
      frame: frame(900),
    });
    assert.equal(panel.readBody().status, 'invalid');
    assert.match(panel.readBody().reason, /history/);
    panel.ingest({
      ok: false,
      reasonCode: 'RESYNC_REQUIRED',
      cursor: { session: 'new-session', epoch: 1 },
      frame: frame(0),
    });
    assert.equal(panel.readBody().status, 'waiting');
    assert.equal(panel.readBody().startTick, 0);
    assert.match(panel.readBody().windowReason, /reset/);
  } finally {
    panel.dispose();
    globalThis.document = old;
  }
});

test('selected-body displacement overflow invalidates immediately during warmup', () => {
  const r = motionModel.createBodyMotionAccumulator();
  r.add({ tick: 0, y: 1e308, vy: 0 });
  r.add({ tick: 1, y: -1e308, vy: 0 });
  assert.equal(r.read().status, 'invalid');
  assert.equal(r.read().displacement, null);
  assert.equal(r.read().accelerationRms, null);
});
