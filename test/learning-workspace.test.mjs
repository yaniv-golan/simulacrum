import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningWorkspace } from '../src/application/learning-workspace.mjs';
import { createLegacyLearningDelivery as createLearningDelivery } from '../src/model/fixtures/learning-delivery.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
const run = async (action) => {
  const workshop = await createWorkshop(createLearningDelivery());
  let stored = null,
    fail = false,
    cursor,
    yieldHook;
  const api = createLearningWorkspace({
    readFrame: () => workshop.observe().frames[0],
    send: async (c) => {
      const result = await workshop.act(c);
      ingest();
      return result;
    },
    storage: {
      getItem: () => stored,
      setItem: (k, v) => {
        if (fail) throw Error('Storage full');
        stored = v;
      },
    },
    yieldWork: async () => yieldHook?.(),
  });
  api.select('learner');
  const ingest = () => {
    const o = workshop.observe('scene', 'full', cursor);
    cursor = o.cursor;
    api.ingest(o);
  };
  ingest();
  try {
    await action({
      workshop,
      setYield: (fn) => {
        yieldHook = fn;
      },
      api: {
        ...api,
        async tryModel() {
          await api.tryModel();
          for (let i = 0; i < 3; i++) {
            workshop.step();
            ingest();
            await new Promise((resolve) => setImmediate(resolve));
          }
        },
        async restart(...args) {
          await api.restart(...args);
          for (let i = 0; i < 3; i++) {
            workshop.step();
            ingest();
            await new Promise((resolve) => setImmediate(resolve));
          }
        },
      },
      ingest,
      storageFailure: () => {
        fail = true;
      },
    });
  } finally {
    api.dispose();
    workshop.dispose();
  }
};
test('capture uses prior-tick measurements and only explicit manual teaching; failure inspection does not mutate', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    const s = api.status();
    assert.equal(s.intervals.length, 1);
    assert.deepEqual(
      s.intervals[0].samples.map((s) => s.tick),
      [2, 6, 12],
    );
    assert.equal(s.attempts.length, 1);
    assert.equal(
      api.status().attempts,
      s.attempts,
      'unchanged history is shared across live refreshes',
    );
    assert.ok(Object.isFrozen(s.attempts[0].samples));
    const first = s.intervals[0].samples[0];
    assert.equal(first.tick, 2);
    assert.ok(first.values[0] > 1);
    assert.deepEqual(first.targets, [0, 0]);
    const before = workshop.checkpoint();
    api.status();
    assert.deepEqual(workshop.checkpoint(), before);
    await workshop.act({ type: 'build' });
    ingest();
    await api.train();
    await api.install();
    await workshop.act({ type: 'build' });
    ingest();
    await api.tryModel();
    workshop.step(18);
    ingest();
    await workshop.act({ type: 'pause' });
    ingest();
    assert.equal(
      api.status().intervals.length,
      1,
      'autonomous commands never become teaching targets',
    );
    assert.equal(api.status().attempts.length, 2);
    assert.equal(api.status().attempts[1].samples[0].modes[0], 'learned');
  }));
test('saved versions restore through core; duplicate import preserves interval influence and failed storage keeps work', () =>
  run(async ({ workshop, api, ingest, storageFailure }) => {
    await api.saveVersion('First machine');
    const saved = api.export();
    api.importRecords(JSON.stringify(saved));
    assert.equal(api.status().versions.length, 1);
    await workshop.act({ type: 'rename', id: 'learner', name: 'Changed name' });
    await api.restoreVersion(saved.versions[0].id);
    assert.equal(
      workshop.observe().frames[0].metadata.blueprint.parts.find((p) => p.id === 'learner').name,
      'Delivery learner',
    );
    assert.equal(api.status().versions.length, 2, 'restore retains the displaced build');
    const before = api.export();
    storageFailure();
    await assert.rejects(api.saveVersion('Failed save'), /Storage full/);
    assert.deepEqual(api.export(), before);
    assert.throws(() => api.importRecords('{"version":1}'));
    assert.deepEqual(api.export(), before);
  }));
test('manual history retries are labelled manual and incompatible starts reject without rewriting the machine', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    const id = api.status().attempts[0].id;
    await workshop.act({ type: 'build' });
    ingest();
    await workshop.act({ type: 'rename', id: 'learner', name: 'Changed' });
    const before = workshop.checkpoint();
    await assert.rejects(api.restart(id, 6), /Different build/);
    assert.deepEqual(workshop.checkpoint(), before);
    await api.restoreAttempt(id);
    await api.restart(id, 6);
    assert.match(api.status().notice, /Manual retry/);
    assert.equal(api.status().recording, false);
    await api.stop();
    assert.equal(api.status().cue, null);
  }));

test('new teaching invalidates candidates and installed runs retain immutable training provenance', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    await workshop.act({ type: 'build' });
    ingest();
    await api.train();
    await api.teach();
    workshop.step(24);
    ingest();
    await api.stop();
    await workshop.act({ type: 'build' });
    ingest();
    assert.equal(api.status().candidate, null);
    await assert.rejects(api.install());
    await api.train();
    const expected = api.status().candidate.trainingIdentity;
    await api.install();
    await api.saveVersion('Trained copy');
    const saved = api.export();
    const version = saved.versions.find((v) => v.name === 'Trained copy');
    assert.equal(version.training.trainingIdentity, expected);
    assert.equal(version.training.dataset.length, 2);
    api.reviseInterval(saved.intervals[0].id, 'validation', 1);
    assert.equal(
      api.export().versions.find((v) => v.name === 'Trained copy').training.dataset[0].partition,
      'train',
    );
    api.importRecords(JSON.stringify(api.export()));
  }));

test('import rejects altered evaluation claims and learned retry cues neither drive nor record corrections', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    await workshop.act({ type: 'build' });
    ingest();
    await api.train();
    await api.install();
    ingest();
    const saved = api.export(),
      forged = structuredClone(saved);
    forged.versions[0].id = 'forged-run';
    forged.versions[0].training.evaluation.train.loss = 42;
    assert.throws(() => api.importRecords(JSON.stringify(forged)), /evaluation/);
    assert.deepEqual(api.export(), saved);
    await api.tryModel();
    workshop.step(24);
    ingest();
    await api.stop();
    const past = api.status().attempts.at(-1),
      count = api.status().intervals.length;
    await workshop.act({ type: 'build' });
    ingest();
    await api.restart(past.id, 18);
    workshop.step(12);
    ingest();
    assert.equal(api.status().cue.visible, true);
    assert.equal(api.status().recording, false);
    assert.equal(api.status().intervals.length, count);
    assert.ok(
      workshop.observe().frames[0].receiverControl.receivers.every((r) => r.mode === 'learned'),
    );
    await api.takeover();
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    assert.equal(api.status().intervals.length, count + 1);
    assert.ok(
      api
        .status()
        .attempts.at(-1)
        .samples.some((s) => s.modes.includes('manual')),
    );
  }));

test('saved-build restoration admits before replacing a running session', () =>
  run(async ({ workshop }) => {
    await workshop.act({ type: 'run' });
    workshop.step(12);
    const before = workshop.checkpoint();
    assert.equal((await workshop.act({ type: 'restore-build', save: {} })).ok, false);
    assert.deepEqual(workshop.checkpoint(), before);
    const restored = await workshop.act({ type: 'restore-build', save: createLearningDelivery() });
    assert.equal(restored.ok, true);
    assert.equal(workshop.observe().frames[0].metadata.mode, 'build');
    assert.equal(workshop.observe().frames[0].tick, 0);
  }));

test('cancelling a new run preserves the installed model and retained provenance', () =>
  run(async ({ workshop, api, ingest, setYield }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    await workshop.act({ type: 'build' });
    ingest();
    await api.train();
    await api.install();
    const before = workshop.checkpoint(),
      records = api.export();
    setYield(() => api.cancel());
    await assert.rejects(api.train(), /LEARNING_CANCELLED/);
    assert.deepEqual(workshop.checkpoint(), before);
    assert.deepEqual(api.export(), records);
  }));

test('malformed imported physical observations cannot replace retained history', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    const before = api.export(),
      bad = structuredClone(before);
    api.importRecords(JSON.stringify(before));
    bad.attempts[0].id = 'broken-physical-record';
    bad.attempts[0].samples[0].physics[0].position = null;
    assert.throws(() => api.importRecords(JSON.stringify(bad)), /observations/);
    assert.deepEqual(api.export(), before);
  }));

test('adding speed preserves distance examples and names the missing channel without filling it', () =>
  run(async ({ workshop, api, ingest }) => {
    const wire = workshop
      .observe()
      .frames[0].metadata.blueprint.connections.find(
        (c) => c.kind === 'signal' && c.a.port === 'speed',
      );
    assert.equal((await workshop.act({ type: 'disconnect', id: wire.id })).ok, true);
    ingest();
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    const old = api.export().intervals[0];
    await workshop.act({ type: 'build' });
    ingest();
    assert.equal(
      (await workshop.act({ type: 'connect', id: wire.id, a: wire.a, b: wire.b })).ok,
      true,
    );
    ingest();
    assert.deepEqual(api.status().data.excluded[0].missing, ['speed']);
    assert.equal(api.status().data.samples.length, 0);
    assert.deepEqual(api.export().intervals[0], old);
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    assert.equal(api.export().intervals[1].samples[0].values.length, 2);
  }));

test('uninstalled equal-weight candidates cannot relabel installed provenance; explicit restore selects origin', () =>
  run(async ({ workshop, api, ingest }) => {
    for (const duty of [0.1, 0.2]) {
      await api.teach();
      await workshop.act({ type: 'control', id: 'left-control', duty });
      workshop.step(12);
      ingest();
      await api.stop();
      await workshop.act({ type: 'build' });
      ingest();
    }
    const held = api.status().intervals[1].id;
    api.reviseInterval(held, 'test', 1);
    await api.train();
    const first = api.status().candidate.training;
    await api.install();
    api.reviseInterval(held, 'validation', 1);
    await api.train();
    const second = api.status().candidate.training;
    assert.equal(first.modelIdentity, second.modelIdentity);
    await api.saveVersion('Still first');
    assert.equal(api.export().versions.at(-1).training.id, first.id);
    await api.tryModel();
    workshop.step(12);
    ingest();
    await api.stop();
    assert.equal(api.status().attempts.at(-1).training.id, first.id);
    await api.restoreVersion(second.id);
    await api.tryModel();
    workshop.step(12);
    ingest();
    await api.stop();
    assert.equal(api.status().attempts.at(-1).training.id, second.id);
  }));

test('sensor failure between capture samples marks historical attempts incomplete', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(6);
    ingest();
    const frame = structuredClone(workshop.observe().frames[0]);
    frame.tick = 7;
    frame.sensors.tick = 6;
    frame.sensors.readings.find((r) => r.channels.distance).channels.distance = {
      status: 'no-power',
    };
    api.ingest({ ok: true, frames: [frame] });
    assert.equal(api.status().attempts.at(-1)?.incompleteReason, 'SENSOR_UNAVAILABLE');
    assert.equal(api.status().recording, false);
  }));

test('storage failure freezes capped capture and preserves an importable pending export', () =>
  run(async ({ workshop, api, ingest, storageFailure }) => {
    await api.teach();
    workshop.step(6);
    ingest();
    storageFailure();
    const frame = structuredClone(workshop.observe().frames[0]);
    for (let i = 2; i <= 1205; i++) {
      frame.tick = i * 6;
      frame.sensors.tick = frame.tick - 1;
      api.ingest({ ok: true, frames: [frame] });
    }
    const saved = api.export();
    assert.ok(saved.attempts[0].samples.length > 0 && saved.attempts[0].samples.length <= 1200);
    assert.equal(saved.intervals[0].samples.length, saved.attempts[0].samples.length);
    assert.match(api.status().notice, /Storage full/);
    assert.equal(api.status().captureBlocked, true);
    const restored = createLearningWorkspace({
      readFrame: () => workshop.observe().frames[0],
      send: async () => ({ ok: true }),
      storage: { getItem: () => JSON.stringify(saved), setItem: () => {} },
    });
    assert.equal(typeof restored.export(), 'object', restored.status().notice);
    assert.equal(restored.export().attempts[0].samples.length, saved.attempts[0].samples.length);
    restored.dispose();
    await api.discardPending();
    assert.equal(api.status().captureBlocked, false);
  }));

test('failed explicit stop freezes capture before its size limit', () =>
  run(async ({ workshop, api, ingest, storageFailure }) => {
    await api.teach();
    workshop.step(6);
    ingest();
    storageFailure();
    await assert.rejects(api.stop(), /Storage full/);
    workshop.step(6);
    ingest();
    assert.deepEqual(
      api.export().attempts[0].samples.map((s) => s.tick),
      [2, 6],
    );
    assert.equal(api.status().captureBlocked, true);
  }));

test('reusing another equal-weight controller never borrows the saved controllers provenance', () =>
  run(async ({ workshop, api, ingest }) => {
    await api.teach();
    workshop.step(12);
    ingest();
    await api.stop();
    await workshop.act({ type: 'build' });
    ingest();
    await api.train();
    await api.install();
    const v = structuredClone(api.export().versions[0]);
    v.id = 'two-controller-source';
    v.name = 'Two controllers';
    const bp = v.blueprint,
      ids = ['learner', 'left-control', 'right-control'];
    for (const id of ids) {
      const p = structuredClone(bp.parts.find((p) => p.id === id));
      p.id += '-b';
      p.position = [10 + bp.parts.length, 1, 0];
      bp.parts.push(p);
    }
    for (const c of [...bp.connections].filter(
      (c) => c.kind === 'signal' && (c.a.part === 'learner' || c.b.part === 'learner'),
    )) {
      const n = structuredClone(c);
      n.id += '-b';
      for (const side of ['a', 'b']) if (ids.includes(n[side].part)) n[side].part += '-b';
      bp.connections.push(n);
    }
    api.importRecords(JSON.stringify({ version: 1, intervals: [], attempts: [], versions: [v] }));
    await api.reuseModel(v.id, 'learner-b');
    await api.saveVersion('Reused B');
    assert.equal(api.export().versions.at(-1).training, null);
    await api.reuseModel(v.id, 'learner');
    await api.saveVersion('Reused A');
    assert.equal(api.export().versions.at(-1).training.id, v.training.id);
  }));
