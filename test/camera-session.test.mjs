import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraSession } from '../src/application/camera-session.mjs';
const observation = (
  tick,
  { mode = 'run', serial = 0, epoch = 1, ok = true, camera = true } = {},
) => ({
  ok,
  cursor: { session: 's', epoch },
  frames: [
    {
      tick,
      status: 'ready',
      metadata: { mode, blueprint: { parts: camera ? [{ id: 'lens', type: 'camera' }] : [] } },
      physics: [],
      cameras: camera
        ? [
            {
              node: 0,
              powered: true,
              sampleTick: Math.floor(tick / 12) * 12,
              serial,
              busySerial: 0,
              manualId: serial,
              result: serial ? { id: serial, tick, status: 'ok', source: 'manual' } : null,
            },
          ]
        : [],
    },
  ],
});
function fixture() {
  let current = observation(0),
    disposed = 0,
    changes = 0;
  const encoded = [],
    renders = [];
  const session = createCameraSession({
    send: async () => ({ ok: true }),
    observe: () => current,
    buildId: 'test',
    sourceIdentity: { head: 'commit', workingTreeDigest: 'digest' },
    changed: () => changes++,
    createCanvas: () => ({ getContext: () => ({ clearRect() {}, drawImage() {} }) }),
    createRenderer: () => ({
      render(frame) {
        renders.push(frame.tick);
        return {};
      },
      encode(packet) {
        encoded.push(packet);
        return Promise.resolve(new Blob(['png'], { type: 'image/png' }));
      },
      read() {
        return {};
      },
      dispose() {
        disposed++;
      },
    }),
  });
  return {
    session,
    encoded,
    renders,
    set(o) {
      current = o;
      session.ingest(o);
    },
    counts: () => ({ disposed, changes }),
  };
}
test('camera destination pins completed frames, suppresses replay and retains paused frame identity', async () => {
  const f = fixture();
  try {
    f.session.watch('lens');
    const sample = observation(12, { serial: 1 });
    f.set(sample);
    await new Promise((r) => setImmediate(r));
    assert.equal(f.encoded[0].frame.tick, sample.frames[0].tick);
    assert.equal(f.session.read().gallery.photos[0].metadata.captureTick, 12);
    f.set(observation(24, { serial: 1, ok: false, epoch: 2 }));
    assert.equal(f.encoded.length, 1);
    f.set(observation(36));
    f.set(observation(37, { mode: 'paused' }));
    await f.session.photo();
    assert.equal(f.session.read().gallery.photos[1].metadata.captureTick, 36);
    assert.equal(f.session.read().gallery.photos[1].metadata.source, 'paused-frame');
    assert.equal(f.session.read().gallery.photos.length, 2);
  } finally {
    f.session.dispose();
  }
});
test('deleting the last camera releases its renderer and notifies view recovery without any photographs', () => {
  const f = fixture();
  try {
    f.session.watch('lens');
    f.set(observation(12));
    const before = f.counts().changes;
    f.set(observation(13, { camera: false }));
    assert.equal(f.session.read().active, null);
    assert.equal(f.counts().disposed, 1);
    assert.ok(f.counts().changes > before);
  } finally {
    f.session.dispose();
  }
});

test('optical renderer receives only completed poses and authored geometry, never programs or identities', async () => {
  const f = fixture();
  try {
    const o = observation(12, { serial: 1 });
    o.frames[0].metadata.blueprint.parts[0].controllerProgram = { source: 'secret' };
    f.set(o);
    await new Promise((r) => setImmediate(r));
    const packet = f.encoded[0];
    assert.deepEqual(Object.keys(packet).sort(), ['frame', 'node']);
    assert.equal(packet.frame.metadata, undefined);
    assert.equal(packet.frame.blueprint.parts[0].id, undefined);
    assert.equal(packet.frame.blueprint.parts[0].controllerProgram, undefined);
  } finally {
    f.session.dispose();
  }
});

test('successful exposure retains visible competing trigger rejection until explicit clear', async () => {
  const f = fixture();
  try {
    const o = observation(12, { serial: 1 });
    o.frames[0].cameras[0].busySerial = 1;
    f.set(o);
    await new Promise((r) => setImmediate(r));
    assert.match(f.session.read().captureStatus, /1.*busy/);
    f.session.clear();
    assert.doesNotMatch(f.session.read().captureStatus, /busy/);
  } finally {
    f.session.dispose();
  }
});

test('photo metadata retains immutable source provenance alongside the build', async () => {
  const f = fixture();
  try {
    f.set(observation(12, { serial: 1 }));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(f.session.read().gallery.photos[0].metadata.sourceIdentity, {
      head: 'commit',
      workingTreeDigest: 'digest',
    });
  } finally {
    f.session.dispose();
  }
});

test('power loss and missing samples retain the old image with explicit non-live status', () => {
  const f = fixture();
  try {
    f.session.watch('lens');
    f.set(observation(12));
    const no = observation(24);
    no.frames[0].cameras[0].powered = false;
    f.set(no);
    assert.match(f.session.read().status, /No power.*tick 12/);
    assert.equal(f.session.read().live, 12);
    f.set(observation(49));
    assert.match(f.session.read().status, /Stale.*tick 12/);
    assert.equal(f.session.read().live, 12);
    f.set(observation(60));
    assert.match(f.session.read().status, /Live.*60/);
  } finally {
    f.session.dispose();
  }
});

test('entering paused camera view labels a completed exposure paused and resumes live only in Run', () => {
  const f = fixture();
  try {
    f.set(observation(12, { mode: 'paused' }));
    f.session.watch('lens');
    assert.equal(f.session.read().status, 'Paused · image from tick 12');
    assert.equal(f.session.read().canPhoto, true);
    assert.deepEqual(f.renders, [12]);
    f.set(observation(24));
    assert.equal(f.session.read().status, 'Live · tick 24');
  } finally {
    f.session.dispose();
  }
});
