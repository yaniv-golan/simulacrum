import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneLibrary } from '../src/application/scene-library.mjs';
import { sceneLayout } from '../src/model/environment.mjs';

test('scene library keeps independent snapshots and preserves bytes on quota or corrupt-storage failure', () => {
  const values = new Map();
  let fail = false;
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem(k, v) {
      if (fail) throw Error('quota');
      values.set(k, v);
    },
  };
  const library = createSceneLibrary(storage),
    scene = sceneLayout('hill');
  library.add('Hill', scene);
  scene.objects[0].position[0] = 9;
  assert.equal(library.list()[0].scene.objects[0].position[0], 1);
  const before = JSON.stringify([...values]);
  fail = true;
  assert.throws(() => library.add('Second', scene), /full or unavailable/);
  assert.equal(JSON.stringify([...values]), before);
  assert.throws(() => library.remove('scene-1'), /full or unavailable/);
  assert.equal(JSON.stringify([...values]), before);
  fail = false;
  const result = library.list();
  result[0].scene.objects[0].position[0] = 8;
  assert.equal(library.list()[0].scene.objects[0].position[0], 1);
});

test('corrupt scene JSON keeps existing bytes and names a repairable unread state', () => {
  const values = new Map();
  const library = createSceneLibrary({
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  });
  library.add('Hill', sceneLayout('hill'));
  values.set('simulacrum.scenes.v1', 'broken');
  assert.equal(library.inspect().unreadable, true);
  assert.throws(() => library.add('Another', sceneLayout('hill')), /unreadable/);
  assert.equal(values.get('simulacrum.scenes.v1'), 'broken');
  library.reset();
  assert.deepEqual(library.list(), []);
});


test('recording subset rejects oversized machine observations before encoding', async () => {
  const { createCaptureEncoder } = await import('../src/application/capture-stream.mjs');
  const encoder = createCaptureEncoder();
  const event = {
    id: 'event-1',
    seq: 1,
    timeMs: 0,
    kind: 'frame',
    context: {
      observation: { metadata: { blueprint: { parts: Array.from({ length: 513 }, () => ({})) } } },
    },
  };
  assert.throws(() => encoder.encode(event), /512/);
  event.context.observation.metadata.blueprint.parts.length = 512;
  assert.doesNotThrow(() => encoder.encode(event));
  const tooLarge = { ...event, id: 'event-2', seq: 2, data: 'x'.repeat(2 * 1024 * 1024) };
  assert.throws(() => encoder.encode(tooLarge), /limit/);
});
