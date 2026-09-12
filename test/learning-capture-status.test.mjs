import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createLearningWorkspace } from '../src/application/learning-workspace.mjs';
function blueprint() {
  const bp = createEmptyBlueprint('touch-learning', 'Touch learning');
  bp.parts = [
    ['contactSensor', 'sensor'],
    ['learningController', 'learner'],
    ['commandReceiver', 'receiver'],
    ['powerCell', 'supply'],
  ].map(([type, id], i) => createPart(type, id, [i, 1, 0]));
  bp.connections = [
    {
      id: 'input',
      kind: 'signal',
      a: { part: 'sensor', port: 'touching' },
      b: { part: 'learner', port: 'input1' },
    },
    {
      id: 'output',
      kind: 'signal',
      a: { part: 'learner', port: 'out1' },
      b: { part: 'receiver', port: 'command' },
    },
    {
      id: 'power',
      kind: 'power',
      a: { part: 'supply', port: 'power' },
      b: { part: 'sensor', port: 'power' },
    },
  ];
  return bp;
}
test('brief touch and release between periodic samples retain explicit feature and endpoint provenance', async () => {
  const w = await createWorkshop(blueprint());
  let current = w.observe().frames[0];
  const store = new Map();
  const api = createLearningWorkspace({
    readFrame: () => current,
    send: async (c) => {
      const r = await w.act(c);
      current = w.observe().frames[0];
      return r;
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  api.select('learner');
  try {
    await api.teach();
    for (let tick = 1; tick <= 12; tick++) {
      w.step();
      current = structuredClone(w.observe().frames[0]);
      if (tick >= 2)
        current.sensors.readings[0].channels.touching = { status: 'ok', value: tick === 3 ? 1 : 0 };
      api.ingest({ ok: true, frames: [current] });
    }
    await api.stop();
    const interval = api.status().intervals[0];
    assert.deepEqual(
      interval.samples.map((s) => s.tick),
      [2, 3, 4, 6, 12],
    );
    assert.deepEqual(interval.samples.find((s) => s.tick === 3).values, [1, 1, 0, 0]);
    assert.deepEqual(interval.samples.find((s) => s.tick === 4).values, [0, 1, 0, 0]);
    assert.equal(interval.capture.inputs[0].partId, 'sensor');
    assert.equal(interval.capture.inputs[0].frame, 'pad-face');
    const bad = structuredClone(api.export());
    bad.intervals[0].capture.inputs[0].channel = 'normalLoad';
    assert.throws(() => api.importRecords(JSON.stringify(bad)), /INVALID_LEARNING_DATA/);
    assert.deepEqual(api.status().intervals[0], interval);
  } finally {
    api.dispose();
    w.dispose();
  }
});
test('legacy browser records remain byte-identical when new records are saved', async () => {
  const w = await createWorkshop(blueprint());
  const legacy = '{"version":1,"intervals":[],"attempts":[],"versions":[]}';
  const store = new Map([['simulacrum-learning-v1', legacy]]);
  const api = createLearningWorkspace({
    readFrame: () => w.observe().frames[0],
    send: (c) => w.act(c),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  try {
    api.select('learner');
    await api.saveVersion('New version');
    assert.equal(store.get('simulacrum-learning-v1'), legacy);
    assert.equal(api.exportLegacy(), legacy);
    assert.equal(JSON.parse(store.get('simulacrum-learning-v2')).version, 2);
  } finally {
    api.dispose();
    w.dispose();
  }
});
test('brief load peaks survive capture and the terminal power fault is retained outside training rows', async () => {
  const bp = blueprint();
  bp.connections[0].a.port = 'normalLoad';
  const w = await createWorkshop(bp);
  let current = w.observe().frames[0];
  const store = new Map();
  const api = createLearningWorkspace({
    readFrame: () => current,
    send: async (c) => {
      const r = await w.act(c);
      current = w.observe().frames[0];
      return r;
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  try {
    api.select('learner');
    await api.teach();
    for (let tick = 1; tick <= 10; tick++) {
      w.step();
      current = structuredClone(w.observe().frames[0]);
      if (tick >= 2)
        current.sensors.readings[0].channels.normalLoad =
          tick === 10 ? { status: 'no-power' } : { status: 'ok', value: tick === 3 ? 100 : 5 };
      api.ingest({ ok: true, frames: [current] });
    }
    const state = api.status();
    assert.ok(state.intervals[0].samples.some((s) => s.tick === 3 && s.values[0] === 100));
    assert.equal(state.attempts[0].fault.tick, 10);
    assert.equal(state.attempts[0].fault.inputs[0].status, 'no-power');
    assert.ok(state.intervals[0].samples.every((s) => s.tick < 10));
    api.importRecords(JSON.stringify(api.export()));
    const bad = structuredClone(api.export());
    bad.attempts[0].fault.tick = -1;
    assert.throws(() => api.importRecords(JSON.stringify(bad)));
  } finally {
    api.dispose();
    w.dispose();
  }
});

test('an initial real power fault is exportable without becoming a training sample', async () => {
  const bp = blueprint();
  bp.connections = bp.connections.filter((c) => c.kind !== 'power');
  const w = await createWorkshop(bp);
  const store = new Map();
  const api = createLearningWorkspace({
    readFrame: () => w.observe().frames[0],
    send: (c) => w.act(c),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
  });
  try {
    api.select('learner');
    await api.teach();
    w.step();
    api.ingest({ ok: true, frames: w.observe().frames });
    const saved = api.export();
    assert.equal(saved.attempts.length, 1);
    assert.deepEqual(saved.attempts[0].samples, []);
    assert.equal(saved.attempts[0].fault.tick, 1);
    assert.equal(saved.attempts[0].fault.inputs[0].status, 'no-power');
    assert.deepEqual(saved.intervals, []);
    api.importRecords(JSON.stringify(saved));
    assert.deepEqual(api.export(), saved);
    const invalid = structuredClone(saved);
    delete invalid.attempts[0].fault;
    assert.throws(() => api.importRecords(JSON.stringify(invalid)), /Invalid saved attempt/);
    assert.deepEqual(api.export(), saved);
  } finally {
    api.dispose();
    w.dispose();
  }
});
