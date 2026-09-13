import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraGallery } from '../src/application/camera-gallery.mjs';
const packet = { metadata: { captureTick: 12, cameraId: 'lens', epoch: 0 } };
test('gallery retains existing photographs at both bounds, owns URLs, and clears explicitly', async () => {
  const revoked = [];
  let count = 0;
  const g = createCameraGallery({
    encode: async () => new Blob(['image'], { type: 'image/png' }),
    createURL: () => `photo-${++count}`,
    revokeURL: (url) => revoked.push(url),
    maxPhotos: 2,
    maxBytes: 10,
  });
  assert.equal(await g.capture(packet), true);
  assert.equal(await g.capture(packet), true);
  assert.equal(await g.capture(packet), false);
  assert.equal(g.read().bytes, 10);
  assert.equal(g.read().photos.length, 2);
  assert.match(g.read().status, /full/);
  g.clear();
  assert.deepEqual(revoked, ['photo-1', 'photo-2']);
  assert.equal(g.read().bytes, 0);
  assert.equal(await g.capture(packet), true);
  g.dispose();
  assert.equal(revoked.length, 3);
});
test('gallery rejects busy, late epoch results, encoding failure and one-byte overflow without eviction', async () => {
  let resolve;
  const g = createCameraGallery({
    encode: () => new Promise((r) => (resolve = r)),
    createURL: () => {
      throw Error('must not publish old epoch');
    },
    revokeURL: () => {},
  });
  g.epoch('one');
  const capture = g.capture(packet);
  assert.equal(await g.capture(packet), false);
  g.epoch('two');
  resolve(new Blob(['png'], { type: 'image/png' }));
  assert.equal(await capture, false);
  assert.equal(g.read().photos.length, 0);
  g.dispose();
  const bounded = createCameraGallery({
    encode: async () => new Blob(['123456'], { type: 'image/png' }),
    createURL: () => 'retained',
    revokeURL: () => {},
    maxBytes: 11,
  });
  assert.equal(await bounded.capture(packet), true);
  assert.equal(await bounded.capture(packet), false);
  assert.equal(bounded.read().photos[0].url, 'retained');
  bounded.dispose();
  const failed = createCameraGallery({
    encode: async () => {
      throw Error('encoder unavailable');
    },
  });
  assert.equal(await failed.capture(packet), false);
  assert.match(failed.read().status, /encoder unavailable/);
  failed.dispose();
});

test('epoch and deadline cancellation retain the one encoder reservation until it settles', async () => {
  let finish,
    calls = 0;
  const g = createCameraGallery({
    encode: () => {
      calls++;
      return new Promise((r) => (finish = r));
    },
    deadlineMs: 5,
    createURL: () => {
      throw Error('late URL');
    },
  });
  const first = g.capture(packet);
  g.epoch('next');
  assert.equal(g.read().pending, true);
  assert.equal(await g.capture(packet), false);
  assert.equal(calls, 1);
  finish(new Blob(['png'], { type: 'image/png' }));
  await first;
  const second = g.capture(packet);
  await new Promise((r) => setTimeout(r, 15));
  assert.match(g.read().status, /deadline/);
  assert.equal(g.read().pending, true);
  assert.equal(await g.capture(packet), false);
  assert.equal(calls, 2);
  finish(new Blob(['png'], { type: 'image/png' }));
  assert.equal(await second, false);
  g.dispose();
});

test('a successful encoder does not erase concurrent busy rejections', async () => {
  let finish;
  const g = createCameraGallery({
    encode: () => new Promise((r) => (finish = r)),
    createURL: () => 'kept',
    revokeURL: () => {},
  });
  const accepted = g.capture(packet);
  assert.equal(await g.capture(packet), false);
  assert.equal(await g.capture(packet), false);
  finish(new Blob(['png'], { type: 'image/png' }));
  assert.equal(await accepted, true);
  assert.equal(g.read().photos.length, 1);
  assert.match(g.read().status, /2.*busy/);
  g.clear();
  assert.doesNotMatch(g.read().status, /busy/);
  g.dispose();
});
