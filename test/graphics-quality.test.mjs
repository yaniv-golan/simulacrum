import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGraphicsQuality,
  GRAPHICS_LEVELS,
  applyGraphicsQuality,
} from '../src/presentation/graphics-quality.mjs';
function driver(q) {
  let now = 0;
  return (count, frameMs, overrides = {}) => {
    for (let i = 0; i < count; i++) {
      now += frameMs;
      q.observe({ now, frameMs, active: true, visible: true, ...overrides });
    }
    return q.read();
  };
}
test('graphics starts at full fidelity and retains it on fast or isolated slow frames', () => {
  const q = createGraphicsQuality(),
    run = driver(q);
  assert.deepEqual(q.read(), { level: 0, ...GRAPHICS_LEVELS[0], changes: 0 });
  run(300, 16.7);
  run(1, 500);
  run(150, 16.7);
  assert.equal(q.read().level, 0);
});
test('sustained pressure lowers one graphics level at a time and stops at the floor', () => {
  const q = createGraphicsQuality(),
    run = driver(q);
  assert.equal(run(74, 50).level, 0);
  assert.equal(run(1, 50).level, 1);
  assert.equal(run(59, 50).level, 1);
  assert.equal(run(1, 50).level, 2);
  run(1000, 50);
  assert.equal(q.read().level, GRAPHICS_LEVELS.length - 1);
  assert.equal(q.read().changes, GRAPHICS_LEVELS.length - 1);
});
test('graphics recovery needs sustained headroom and backs off after a failed upgrade', () => {
  const q = createGraphicsQuality(),
    run = driver(q);
  run(75, 50);
  assert.equal(q.read().level, 1);
  run(500, 16.7);
  assert.equal(q.read().level, 1);
  for (let i = 0; i < 2000 && q.read().level > 0; i++) run(1, 16.7);
  assert.equal(q.read().level, 0);
  run(60, 50);
  assert.equal(q.read().level, 1);
  run(1000, 16.7);
  assert.equal(q.read().level, 1);
  run(1000, 16.7);
  assert.equal(q.read().level, 0);
});
test('idle and hidden frames cannot lower quality or manufacture recovery evidence', () => {
  for (const overrides of [{ active: false }, { visible: false }]) {
    const q = createGraphicsQuality(),
      run = driver(q);
    run(500, 100, overrides);
    assert.equal(q.read().level, 0);
    run(100, 50);
    assert.equal(q.read().level, 1);
    run(5000, 16.7, overrides);
    assert.equal(q.read().level, 1);
    run(59, 16.7);
    assert.equal(q.read().level, 1);
  }
});

test('graphics transitions refresh shadow shader variants and release old targets without changing geometry', () => {
  const material = { needsUpdate: false },
    other = { needsUpdate: false },
    geometry = {};
  const objects = [{ material, geometry }, { material: [other], geometry }, {}];
  let disposed = 0,
    ratio,
    size,
    shadowSize;
  const renderer = {
    shadowMap: { enabled: true },
    setPixelRatio: (v) => (ratio = v),
    setSize: (...v) => (size = v),
  };
  const shadow = {
    map: {},
    mapPass: {},
    dispose: () => disposed++,
    mapSize: { set: (...v) => (shadowSize = v) },
  };
  const scene = { traverse: (fn) => objects.forEach(fn) };
  applyGraphicsQuality({
    renderer,
    scene,
    shadow,
    quality: GRAPHICS_LEVELS[3],
    pixelRatio: 2,
    width: 800,
    height: 600,
  });
  assert.equal(material.needsUpdate, true);
  assert.equal(other.needsUpdate, true);
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(renderer.shadowMap.needsUpdate, true);
  assert.equal(shadow.map, null);
  assert.equal(shadow.mapPass, null);
  assert.equal(disposed, 1);
  assert.equal(ratio, 1.4);
  assert.deepEqual(size, [800, 600, false]);
  material.needsUpdate = false;
  other.needsUpdate = false;
  applyGraphicsQuality({
    renderer,
    scene,
    shadow,
    quality: GRAPHICS_LEVELS[0],
    pixelRatio: 2,
    width: 800,
    height: 600,
  });
  assert.equal(material.needsUpdate, true);
  assert.equal(other.needsUpdate, true);
  assert.equal(renderer.shadowMap.enabled, true);
  assert.deepEqual(shadowSize, [2048, 2048]);
  assert.equal(ratio, 2);
  assert.equal(objects[0].geometry, geometry);
  assert.equal(objects[1].geometry, geometry);
});
