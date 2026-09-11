import test from 'node:test';
import assert from 'node:assert/strict';
import { createRetry } from '../src/application/retry.mjs';
import { createImpactEvents } from '../src/presentation/impact-sound.mjs';

test('retry resets before running, blocks duplicate requests and stops on rejection', async () => {
  const calls = [];
  let release;
  const retry = createRetry({
    prepare: () => calls.push('prepare'),
    finish: () => calls.push('finish'),
    execute: async (command) => {
      calls.push(command.type);
      if (command.type === 'build') await new Promise((r) => (release = r));
      return { ok: true };
    },
  });
  const first = retry.run();
  await Promise.resolve();
  assert.equal((await retry.run()).ok, false);
  release();
  assert.equal((await first).ok, true);
  assert.deepEqual(calls, ['prepare', 'build', 'run', 'finish']);
  const fail = createRetry({
    prepare() {},
    finish() {},
    execute: async (c) => {
      assert.equal(c.type, 'build');
      return { ok: false, reasonCode: 'FAILED' };
    },
  });
  assert.equal((await fail.run()).ok, false);
});

test('impact events deduplicate snapshots and sustained contacts, mute and reset safely', () => {
  const events = createImpactEvents();
  const row = { a: 0, b: 1, available: true, solved: true, normalImpulse: [0, 2, 0] };
  const frame = (tick, rows = [row]) => ({ epoch: 1, tick, available: true, rows });
  assert.equal(events.read(frame(1)).length, 0); // baseline, no reset thump
  assert.equal(events.read(frame(2, [])).length, 0);
  assert.equal(events.read(frame(3)).length, 1);
  assert.equal(events.read(frame(3)).length, 0);
  assert.equal(events.read(frame(4)).length, 0);
  assert.equal(events.read({ ...frame(5), available: false }).length, 0);
  assert.equal(events.read({ ...frame(6), epoch: 2 }).length, 0);
});

test('predictive contact does not consume the later impact sound', () => {
  const events = createImpactEvents();
  const frame = (tick, impulse) => ({
    epoch: 1,
    tick,
    available: true,
    rows:
      impulse === null
        ? []
        : [{ a: 0, b: 1, available: true, solved: true, normalImpulse: [0, impulse, 0] }],
  });
  assert.equal(events.read(frame(1, null)).length, 0);
  assert.equal(events.read(frame(2, 0)).length, 0);
  assert.equal(events.read(frame(3, 2)).length, 1);
  assert.equal(events.read(frame(4, 0)).length, 0);
  assert.equal(events.read(frame(5, 2)).length, 0);
  assert.equal(events.read(frame(6, null)).length, 0);
  assert.equal(events.read(frame(7, 2)).length, 1);
});

test('audio denial and disposal during enable leave sound disabled and release voices', async () => {
  const { createImpactSound } = await import('../src/presentation/impact-sound.mjs');
  const original = globalThis.AudioContext;
  let resume,
    disconnected = 0,
    created = 0;
  class Audio {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume() {
      return new Promise((resolve) => {
        resume = resolve;
      });
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    createOscillator() {
      created++;
      return {
        frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {
          disconnected++;
        },
        start() {},
        stop() {},
      };
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {},
        disconnect() {
          disconnected++;
        },
      };
    }
  }
  try {
    globalThis.AudioContext = Audio;
    const denied = createImpactSound();
    const pending = denied.enable(true);
    resume();
    assert.equal(await pending, false);
    assert.equal(denied.enabled(), false, 'a blocked resume must not stay enabled');
    denied.dispose();
    let context;
    globalThis.AudioContext = class extends Audio {
      constructor() {
        super();
        context = this;
      }
    };
    const sound = createImpactSound();
    const enabling = sound.enable(true);
    context.state = 'running';
    resume();
    assert.equal(await enabling, true);
    sound.play(Array.from({ length: 20 }, () => ({ material: 'rubber', impulse: 2 })));
    assert.equal(created, 8);
    sound.stop();
    assert.equal(disconnected, 16, 'stop immediately disconnects all audio nodes');
    const again = sound.enable(true);
    sound.dispose();
    resume();
    assert.equal(await again, false);
    assert.equal(await sound.enable(true), false, 'disposed sound cannot reopen');
  } finally {
    globalThis.AudioContext = original;
  }
});

test('retry preserves authored edits/history and queued capture while resetting a whole run', async () => {
  const { createWorkshop } = await import('../src/core/workshop.mjs');
  const { createEmptyBlueprint, createPart } = await import('../src/model/blueprint.mjs');
  const { createCaptureEncoder, decodeCaptureEvents } = await import(
    '../src/application/capture-stream.mjs'
  );
  const { IDBFactory } = await import('fake-indexeddb');
  const { openCaptureOutbox } = await import('../src/application/capture-outbox.mjs');
  const oldIDB = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const box = await openCaptureOutbox(),
    w = await createWorkshop();
  try {
    const bp = createEmptyBlueprint('retry-edited', 'My experiment');
    bp.parts.push(createPart('ball', 'ball', [0, 3, 0]));
    assert.equal((await w.act({ type: 'load', save: bp })).ok, true);
    for (const command of [
      { type: 'parameter', id: 'ball', key: 'diameter', value: 0.14 },
      { type: 'material', id: 'ball', primitive: 'body', material: 'steel' },
      {
        type: 'contactProperty',
        id: 'ball',
        primitive: 'body',
        property: 'restitution',
        value: 0.7,
      },
    ])
      assert.equal((await w.act(command)).ok, true);
    const authored = w.save(),
      history = w.observe().frames[0].metadata.editing;
    await w.act({ type: 'run' });
    w.step(120);
    const before = w.observe(),
      encoder = createCaptureEncoder();
    const event = (seq, observation, kind) => ({
      id: `retry-${seq}`,
      seq,
      timeMs: seq,
      at: '2026-09-11T00:00:00Z',
      kind,
      data: {},
      context: { observation },
    });
    const first = encoder.encode(event(1, before, 'session-start'));
    await box.enqueue({
      url: `/api/playtest/v2/${'a'.repeat(32)}/event`,
      body: new Blob([JSON.stringify(first)]),
      type: 'application/json',
    });
    const queued = await box.items();
    const retry = createRetry({ prepare() {}, execute: (command) => w.act(command), finish() {} });
    assert.equal((await retry.run()).ok, true);
    const after = w.observe();
    assert.ok(after.cursor.epoch > before.cursor.epoch);
    assert.equal(after.cursor.tick, 0);
    assert.deepEqual(after.frames[0].physics[0].position, [0, 3, 0]);
    assert.deepEqual(after.frames[0].metadata.blueprint, authored);
    assert.deepEqual(after.frames[0].metadata.editing, history);
    assert.deepEqual(await box.items(), queued, 'retry does not lose queued captures');
    const second = encoder.encode(event(2, after, 'session-end'));
    const decoded = decodeCaptureEvents([first, second]);
    assert.equal(decoded.status, 'complete');
    assert.equal(decoded.events[0].context.observation.cursor.epoch, before.cursor.epoch);
    assert.equal(decoded.events[1].context.observation.cursor.epoch, after.cursor.epoch);
    await w.act({ type: 'build' });
    await w.act({ type: 'undo' });
    assert.equal(w.save().parts[0].authoredContact, undefined);
    await w.act({ type: 'redo' });
    assert.deepEqual(w.save(), authored);
  } finally {
    w.dispose();
    box.close();
    globalThis.indexedDB = oldIDB;
  }
});

test('material-pair timbre is symmetric and preparation failure cannot start a run', async () => {
  const { impactTone } = await import('../src/presentation/impact-sound.mjs');
  assert.deepEqual(impactTone(['rubber', 'steel']), impactTone(['steel', 'rubber']));
  assert.notDeepEqual(impactTone(['rubber', 'steel']), impactTone(['aluminium', 'steel']));
  let finished = 0,
    executions = 0,
    fail = true;
  const retry = createRetry({
    prepare() {
      if (fail) throw Error('release failed');
    },
    execute() {
      executions++;
      return { ok: true };
    },
    finish() {
      finished++;
    },
  });
  await assert.rejects(retry.run(), /release failed/);
  assert.equal(executions, 0);
  assert.equal(finished, 1);
  assert.equal(retry.pending(), false);
  fail = false;
  assert.equal((await retry.run()).ok, true);
  assert.equal(executions, 2);
});
