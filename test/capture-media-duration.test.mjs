import test from 'node:test';
import assert from 'node:assert/strict';
import { measureRecordedDuration } from '../src/application/capture-media-duration.mjs';
test('recorded duration uses media metadata and cleans up object URLs', async () => {
  let revoked = false;
  const handlers = new Map();
  const video = {
    duration: 2.75,
    addEventListener: (key, fn) => handlers.set(key, fn),
    removeEventListener: (key) => handlers.delete(key),
    load() {
      queueMicrotask(() => handlers.get('loadedmetadata')?.());
    },
    removeAttribute() {},
    pause() {},
  };
  const duration = await measureRecordedDuration(new Blob(['media']), {
    document: { createElement: () => video },
    urls: {
      createObjectURL: () => 'blob:test',
      revokeObjectURL: () => {
        revoked = true;
      },
    },
  });
  assert.equal(duration, 2750);
  assert.equal(revoked, true);
});
test('unavailable duration remains unavailable instead of substituting wall time', async () => {
  const handlers = new Map();
  const video = {
    duration: Infinity,
    currentTime: 0,
    addEventListener: (key, fn) => handlers.set(key, fn),
    removeEventListener: (key) => handlers.delete(key),
    load() {
      queueMicrotask(() => handlers.get('error')?.());
    },
    removeAttribute() {},
    pause() {},
  };
  assert.equal(
    await measureRecordedDuration(new Blob(['invalid']), {
      document: { createElement: () => video },
      urls: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
      timeoutMs: 20,
    }),
    null,
  );
});
