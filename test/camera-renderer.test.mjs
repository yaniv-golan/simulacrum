import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraRenderer } from '../src/presentation/camera-renderer.mjs';
test('camera context loss rejects stale rasterization and recovers only with a fresh render', () => {
  let lost = false,
    renders = 0,
    loseDuringRender = false;
  const backend = {
    setPixelRatio() {},
    setSize() {},
    getContext: () => ({ isContextLost: () => lost }),
    render() {
      if (!lost) renders++;
      if (loseDuringRender) lost = true;
    },
    domElement: { remove() {} },
    dispose() {},
    forceContextLoss() {
      lost = true;
    },
  };
  const adapter = createCameraRenderer({ createRenderer: () => backend });
  const frame = {
    tick: 12,
    blueprint: { parts: [{ type: 'camera', authoredMaterial: {}, parameters: {} }] },
    physics: [{ position: [0, 1, 0], rotation: [0, 0, 0, 1] }],
  };
  try {
    adapter.render(frame, 0);
    assert.equal(renders, 1);
    lost = true;
    assert.throws(() => adapter.render({ ...frame, tick: 24 }, 0), /context lost/i);
    assert.equal(adapter.read().tick, 12);
    lost = false;
    adapter.render({ ...frame, tick: 36 }, 0);
    assert.equal(adapter.read().tick, 36);
    assert.equal(renders, 2);
    loseDuringRender = true;
    assert.throws(() => adapter.render({ ...frame, tick: 48 }, 0), /context lost/i);
    assert.equal(adapter.read().tick, 36);
  } finally {
    adapter.dispose();
  }
});
test('camera reports bounded resources and separate raster copy and PNG completion cost', async () => {
  const prior = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({ drawImage() {} }),
      toBlob: (fn) => fn(new Blob(['png'], { type: 'image/png' })),
    }),
  };
  const backend = {
    setPixelRatio() {},
    setSize() {},
    getContext: () => ({ isContextLost: () => false }),
    render() {},
    domElement: { remove() {} },
    info: { memory: { geometries: 2, textures: 0 } },
    dispose() {},
    forceContextLoss() {},
  };
  const adapter = createCameraRenderer({ createRenderer: () => backend });
  try {
    await adapter.encode({
      frame: {
        tick: 12,
        blueprint: { parts: [] },
        physics: [{ position: [0, 1, 0], rotation: [0, 0, 0, 1] }],
      },
      node: 0,
    });
    const data = adapter.read();
    assert.deepEqual(data.resources, { geometries: 2, textures: 0 });
    for (const key of ['rasterMs', 'copyMs', 'completionMs', 'elapsedMs'])
      assert.ok(Number.isFinite(data.encoding[key]) && data.encoding[key] >= 0, key);
    assert.equal(data.encoding.tick, 12);
  } finally {
    adapter.dispose();
    globalThis.document = prior;
  }
});
