import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedbackCaptureGate } from '../src/application/feedback-capture-gate.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function environment() {
  const held = [],
    queue = [],
    listeners = new Set();
  function drain() {
    while (queue.length) {
      const next = queue[0];
      if (held.some((r) => r.mode === 'exclusive') || (next.mode === 'exclusive' && held.length))
        return;
      queue.shift();
      if (next.signal?.aborted) continue;
      held.push(next);
      Promise.resolve()
        .then(() => next.fn({ name: next.name }))
        .then(next.resolve, next.reject)
        .finally(() => {
          held.splice(held.indexOf(next), 1);
          drain();
        });
    }
  }
  return {
    locks: {
      request(name, options, fn) {
        return new Promise((resolve, reject) => {
          const row = { name, ...options, fn, resolve, reject };
          options.signal?.addEventListener(
            'abort',
            () => {
              const index = queue.indexOf(row);
              if (index >= 0) {
                queue.splice(index, 1);
                reject(Error('aborted'));
                drain();
              }
            },
            { once: true },
          );
          queue.push(row);
          drain();
        });
      },
    },
    channel() {
      const local = new Set();
      const receive = (data) => {
        for (const fn of local) fn({ data });
      };
      listeners.add(receive);
      return {
        addEventListener(_event, fn) {
          local.add(fn);
        },
        removeEventListener(_event, fn) {
          local.delete(fn);
        },
        postMessage(data) {
          for (const fn of listeners) if (fn !== receive) queueMicrotask(() => fn(data));
        },
        close() {
          listeners.delete(receive);
        },
      };
    },
  };
}
test('protected content waits for all capture suppression and blocks new capture', async () => {
  const env = environment(),
    events = [];
  let finish;
  const first = createFeedbackCaptureGate({
    ...env,
    channel: env.channel(),
    onResume: () => events.push('resume'),
    onSuppress: () =>
      new Promise((resolve) => {
        finish = () => {
          events.push('suppressed');
          resolve();
        };
      }),
  });
  const composer = createFeedbackCaptureGate({ ...env, channel: env.channel() });
  await first.startCapture();
  let visible = false;
  const opening = composer.enter().then(() => {
    visible = true;
  });
  await tick();
  assert.equal(visible, false);
  finish();
  await opening;
  assert.deepEqual(events, ['resume', 'suppressed']);
  const late = createFeedbackCaptureGate({
    ...env,
    channel: env.channel(),
    onResume: () => events.push('late'),
  });
  const starting = late.startCapture();
  await tick();
  assert.equal(events.includes('late'), false);
  // Finish while suppressed must invalidate any queued resume.
  await first.stopCapture();
  composer.leave();
  await starting;
  await tick();
  assert.deepEqual(events, ['resume', 'suppressed', 'late']);
  await Promise.all([first.close(), composer.close(), late.close()]);
});
test('unresponsive capture fails closed and a later retry can recover', async () => {
  const env = environment();
  let release;
  const unknown = env.locks.request(
    'simulacrum-feedback-video-v1',
    { mode: 'shared' },
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  await tick();
  const composer = createFeedbackCaptureGate({ ...env, channel: env.channel(), timeoutMs: 15 });
  await assert.rejects(composer.enter(), /capture|suppression/i);
  release();
  await unknown;
  await composer.enter();
  composer.leave();
  await composer.close();
});
test('failed suppression never grants protected access', async () => {
  const env = environment();
  let fail = true;
  const capture = createFeedbackCaptureGate({
    ...env,
    channel: env.channel(),
    onSuppress() {
      if (fail) throw Error('stop failed');
    },
  });
  const composer = createFeedbackCaptureGate({ ...env, channel: env.channel(), timeoutMs: 15 });
  await capture.startCapture();
  await assert.rejects(composer.enter(), /capture|suppression/i);
  fail = false;
  await capture.stopCapture();
  await composer.enter();
  composer.leave();
  await Promise.all([capture.close(), composer.close()]);
});
test('unsupported coordination never starts capture or claims protection', async () => {
  const gate = createFeedbackCaptureGate({ locks: null, channel: null });
  assert.equal(gate.isSupported, false);
  await assert.rejects(gate.enter(), /unavailable/i);
  await assert.rejects(gate.startCapture(), /unavailable/i);
  await gate.close();
});
