import test from 'node:test';
import assert from 'node:assert/strict';
import { createLampView, LAMP_DISPLAY_SCALE } from '../src/presentation/lamp-view.mjs';
test('lamp emission and fixed-flux cone read completed telemetry including off and weak output', () => {
  const view = createLampView();
  try {
    for (const beamSpread of [0.1, 0.52, 1.2]) {
      view.update({ color: 0xff4400, beamSpread, luminousFluxLm: 300 });
      assert.ok(
        Math.abs(
          view.light.intensity * 2 * Math.PI * (1 - Math.cos(view.light.angle)) -
            300 * LAMP_DISPLAY_SCALE,
        ) < 1e-9,
      );
      assert.equal(view.light.penumbra, 0);
      assert.equal(view.light.castShadow, false);
      assert.equal(view.light.shadow.autoUpdate, true);
      assert.ok(view.lens.material.emissiveIntensity > 0);
    }
    view.update({ color: 0xff4400, beamSpread: 0.52, luminousFluxLm: 100 });
    const weak = view.light.intensity;
    view.update({ color: 0xff4400, beamSpread: 0.52, luminousFluxLm: 1000 });
    assert.ok(view.light.intensity > weak * 9);
    view.update({ color: 0, beamSpread: 0.52, luminousFluxLm: 1000 });
    assert.equal(view.light.color.getHex(), 0);
    assert.equal(view.light.shadow.autoUpdate, false, 'black tint shadows nothing');
    view.update(null);
    assert.equal(view.light.intensity, 0);
    assert.equal(view.lens.material.emissiveIntensity, 0);
    assert.equal(view.light.shadow.autoUpdate, false, 'unlit lamp skips its shadow pass');
  } finally {
    view.dispose();
  }
});
test('light source is on the lens axis without Three default height offset', () => {
  const v = createLampView();
  try {
    assert.deepEqual(v.light.position.toArray(), [0, 0, 0.045]);
    assert.deepEqual(v.light.target.position.toArray(), [0, 0, 1]);
  } finally {
    v.dispose();
  }
});
test('shadow budget owns cast and map size, releases old maps and forces one reallocation pass', () => {
  const view = createLampView();
  try {
    const shadow = view.light.shadow;
    assert.equal(view.light.castShadow, false);
    assert.equal(shadow.autoUpdate, false, 'a lamp that never lit has nothing to shadow');
    assert.ok(shadow.camera.near <= 0.05, 'default 0.5 m near plane would clip nearby parts');
    assert.equal(shadow.normalBias, 0.01);
    let disposed = 0;
    const fakeMap = () => ({ dispose: () => disposed++ });
    assert.equal(view.applyShadowBudget(1024), true);
    assert.equal(view.light.castShadow, true);
    assert.deepEqual(shadow.mapSize.toArray(), [1024, 1024]);
    assert.equal(shadow.needsUpdate, true);
    shadow.needsUpdate = false;
    shadow.map = fakeMap();
    shadow.mapPass = fakeMap();
    assert.equal(view.applyShadowBudget(1024), false);
    assert.equal(disposed, 0);
    assert.equal(shadow.needsUpdate, false);
    assert.notEqual(shadow.map, null);
    assert.equal(view.applyShadowBudget(512), true);
    assert.equal(disposed, 2, 'resize releases the old depth target and its pass');
    assert.equal(shadow.map, null);
    assert.equal(shadow.mapPass, null);
    assert.deepEqual(shadow.mapSize.toArray(), [512, 512]);
    assert.equal(shadow.needsUpdate, true, 'reallocation pass runs even while unlit');
    shadow.needsUpdate = false;
    shadow.map = fakeMap();
    assert.equal(view.applyShadowBudget(0), true);
    assert.equal(view.light.castShadow, false);
    assert.equal(disposed, 3, 'a lamp without shadows keeps no depth target alive');
    assert.equal(shadow.map, null);
    assert.equal(shadow.needsUpdate, false);
    assert.equal(view.applyShadowBudget(0), false);
    assert.equal(disposed, 3);
    view.update({ color: 0xffffff, beamSpread: 0.52, luminousFluxLm: 500 });
    assert.equal(shadow.autoUpdate, true, 'a lit lamp refreshes its shadow every frame');
    view.update({ color: 0xffffff, beamSpread: 0.52, luminousFluxLm: 0 });
    assert.equal(shadow.autoUpdate, false);
  } finally {
    view.dispose();
  }
});
