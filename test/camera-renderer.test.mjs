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

test('camera rope surfaces occlude rays at completed nodes and release retained geometry', async () => {
  const THREE = await import('three');
  let scene;
  const adapter = createCameraRenderer({
    createRenderer: () => ({
      setPixelRatio() {},
      setSize() {},
      getContext: () => ({ isContextLost: () => false }),
      render(value) {
        scene = value;
      },
      domElement: { remove() {} },
      dispose() {},
      forceContextLoss() {},
    }),
  });
  const frame = {
    tick: 12,
    blueprint: { parts: [{ type: 'camera', parameters: {}, authoredMaterial: {} }] },
    physics: [{ position: [0, 1, 0], rotation: [0, 0, 0, 1] }],
    ropes: [
      {
        diameter: 0.02,
        points: [
          [-1, 1, 1],
          [1, 1, 1],
        ],
      },
    ],
  };
  const hits = () => {
    scene.updateMatrixWorld(true);
    return new THREE.Raycaster(
      new THREE.Vector3(0, 1, 0.021),
      new THREE.Vector3(0, 0, 1),
    ).intersectObjects(scene.children, true);
  };
  try {
    adapter.render(frame, 0);
    const rope = hits()[0];
    assert.ok(rope, 'visible rope across the lens must occlude the optical ray');
    assert.ok(Math.abs(rope.point.z - 0.99) < 1e-5);
    assert.equal(rope.object.material.side, THREE.DoubleSide);
    assert.equal(
      rope.object.material.emissive.getHex(),
      0,
      'selection must not enter optical images',
    );
    let released = 0;
    rope.object.geometry.addEventListener('dispose', () => released++);
    frame.tick = 24;
    frame.ropes[0].points = [
      [-1, 2, 1],
      [1, 2, 1],
    ];
    adapter.render(frame, 0);
    assert.equal(hits().length, 0, 'the former completed rope position must not linger');
    frame.ropes = [];
    adapter.render(frame, 0);
    assert.equal(released, 1);
  } finally {
    adapter.dispose();
  }
});
