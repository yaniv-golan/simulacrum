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
      assert.ok(view.lens.material.emissiveIntensity > 0);
    }
    view.update({ color: 0xff4400, beamSpread: 0.52, luminousFluxLm: 100 });
    const weak = view.light.intensity;
    view.update({ color: 0xff4400, beamSpread: 0.52, luminousFluxLm: 1000 });
    assert.ok(view.light.intensity > weak * 9);
    view.update({ color: 0, beamSpread: 0.52, luminousFluxLm: 1000 });
    assert.equal(view.light.color.getHex(), 0);
    view.update(null);
    assert.equal(view.light.intensity, 0);
    assert.equal(view.lens.material.emissiveIntensity, 0);
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
