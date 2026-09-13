import { immutableCopy } from './observation.mjs';
import { rotateVector } from './transforms.mjs';
export const CAMERA = immutableCopy({
  version: 1,
  width: 320,
  height: 240,
  period: 12,
  horizontalFov: 60,
  near: 0.00001,
  far: 100,
  origin: [0, 0, 0.020001],
  maxParts: 8,
  maxPhotos: 100,
  maxBytes: 32 * 1024 * 1024,
});
export function opticalFrame(body) {
  const offset = rotateVector(body.rotation, CAMERA.origin);
  return immutableCopy({
    position: body.position.map((v, i) => v + offset[i]),
    forward: rotateVector(body.rotation, [0, 0, 1]),
    up: rotateVector(body.rotation, [0, 1, 0]),
  });
}
