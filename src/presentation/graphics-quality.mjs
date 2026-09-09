/** Presentation-only budgets. No model, simulation, device-name or saved-state inputs. */
export const GRAPHICS_LEVELS = Object.freeze([
  Object.freeze({ name: 'Full', scale: 1, shadowSize: 2048 }),
  Object.freeze({ name: 'Balanced', scale: 1, shadowSize: 1024 }),
  Object.freeze({ name: 'Reduced', scale: 0.85, shadowSize: 512 }),
  Object.freeze({ name: 'Low', scale: 0.7, shadowSize: 0 }),
  Object.freeze({ name: 'Very low', scale: 0.5, shadowSize: 0 }),
  Object.freeze({ name: 'Minimum', scale: 0.4, shadowSize: 0 }),
]);
export function createGraphicsQuality() {
  let level = 0,
    warmup = 30,
    samples = [],
    healthy = 0,
    retryAfter = 0,
    changes = 0;
  const read = () => ({ level, ...GRAPHICS_LEVELS[level], changes });
  return {
    read,
    observe({ frameMs, now, active, visible }) {
      if (
        !active ||
        !visible ||
        !Number.isFinite(frameMs) ||
        frameMs <= 0 ||
        !Number.isFinite(now)
      ) {
        samples = [];
        healthy = 0;
        warmup = 15;
        return read();
      }
      if (warmup > 0) {
        warmup--;
        return read();
      }
      samples.push(frameMs);
      if (samples.length < 45) return read();
      const p95 = [...samples].sort((a, b) => a - b)[42];
      samples = [];
      if (p95 > 35 && level < GRAPHICS_LEVELS.length - 1) {
        level++;
        changes++;
        warmup = 15;
        healthy = 0;
        retryAfter = now + 30000;
      } else if (p95 < 20 && level > 0) {
        healthy = Math.min(healthy + 1, 8);
        if (healthy === 8 && now >= retryAfter) {
          level--;
          changes++;
          warmup = 15;
          healthy = 0;
        }
      } else healthy = 0;
      return read();
    },
  };
}

/** Apply quality without replacing meshes, picking geometry, DOM or the canvas. */
export function applyGraphicsQuality({
  renderer,
  scene,
  shadow,
  quality,
  pixelRatio,
  width,
  height,
}) {
  renderer.setPixelRatio(pixelRatio * quality.scale);
  renderer.setSize(width, height, false);
  const shadowsChanged = renderer.shadowMap.enabled !== quality.shadowSize > 0;
  renderer.shadowMap.enabled = quality.shadowSize > 0;
  if (shadowsChanged)
    scene.traverse((object) => {
      for (const material of object.material ? [object.material].flat() : [])
        material.needsUpdate = true;
    });
  shadow.dispose();
  shadow.map = null;
  shadow.mapPass = null;
  shadow.mapSize.set(quality.shadowSize || 512, quality.shadowSize || 512);
  renderer.shadowMap.needsUpdate = true;
}
