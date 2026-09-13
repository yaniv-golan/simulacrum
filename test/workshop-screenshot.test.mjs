import test from 'node:test';
import assert from 'node:assert/strict';
import { captureWorkshopScreenshot } from '../src/presentation/workshop-screenshot.mjs';

test('feedback copies the visible camera canvas and returns to orbit only after camera view closes', () => {
  let active = 'lens',
    rendered = 0;
  const optical = { width: 320, height: 240 },
    orbit = { width: 2560, height: 1440 };
  const copies = [];
  const canvas = {
    getContext: () => ({ drawImage: (...args) => copies.push(args) }),
    toDataURL: (type, quality) => `${type}:${quality}`,
  };
  const capture = () =>
    captureWorkshopScreenshot({
      cameraSession: { read: () => ({ active }), canvas: () => optical },
      workshopCanvas: orbit,
      renderWorkshop: () => rendered++,
      createCanvas: () => canvas,
    });
  assert.equal(capture(), 'image/jpeg:0.65');
  assert.equal(copies[0][0], optical);
  assert.deepEqual([canvas.width, canvas.height], [320, 240]);
  assert.equal(rendered, 0, 'capturing a camera image must not rerender the hidden orbit scene');
  active = null;
  capture();
  assert.equal(copies[1][0], orbit);
  assert.deepEqual([canvas.width, canvas.height], [1280, 720]);
  assert.equal(rendered, 1);
});

test('feedback copies the visible view only when its camera image is available', () => {
  assert.throws(
    () =>
      captureWorkshopScreenshot({
        cameraSession: { read: () => ({ active: 'lens' }), canvas: () => null },
        workshopCanvas: { width: 100, height: 100 },
        renderWorkshop() {},
        createCanvas: () => ({
          getContext: () => ({ drawImage() {} }),
          toDataURL: () => 'hidden orbit',
        }),
      }),
    /Camera image unavailable/,
  );
});
