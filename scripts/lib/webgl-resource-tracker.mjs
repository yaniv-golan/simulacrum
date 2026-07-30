/**
 * Installs browser-side counters for live WebGL resources and draw calls.
 * The function passed to Playwright is self-contained so it can run before
 * application modules create a rendering context.
 * @param {import("playwright").Page} page
 */
export async function installWebGLResourceTracker(page) {
  await page.addInitScript(() => {
    const metrics = (window.__simulacrumWebGLMetrics = {
      draws: 0,
      buffers: 0,
      programs: 0,
      textures: 0,
      captureDrawSignatures: false,
      drawSignatures: {},
    });
    const wrapContext = (prototype) => {
      if (!prototype || prototype.__simulacrumResourceTracker) return;
      prototype.__simulacrumResourceTracker = true;
      for (const name of [
        "drawArrays",
        "drawElements",
        "drawArraysInstanced",
        "drawElementsInstanced",
      ]) {
        const original = prototype[name];
        if (!original) continue;
        prototype[name] = function (...args) {
          metrics.draws++;
          if (metrics.captureDrawSignatures) {
            const arrays = name.startsWith("drawArrays"),
              vertexCount = Number(args[arrays ? 2 : 1]) || 0,
              instanceCount = name.endsWith("Instanced")
                ? Number(args[arrays ? 3 : 4]) || 0
                : 1,
              signature = `${name}:${vertexCount}:${instanceCount}`;
            metrics.drawSignatures[signature] =
              (metrics.drawSignatures[signature] || 0) + 1;
          }
          return original.apply(this, args);
        };
      }
      for (const [createName, deleteName, key] of [
        ["createBuffer", "deleteBuffer", "buffers"],
        ["createProgram", "deleteProgram", "programs"],
        ["createTexture", "deleteTexture", "textures"],
      ]) {
        const create = prototype[createName],
          remove = prototype[deleteName];
        if (!create || !remove) continue;
        prototype[createName] = function (...args) {
          const value = create.apply(this, args);
          if (value) metrics[key]++;
          return value;
        };
        prototype[deleteName] = function (...args) {
          if (args[0]) metrics[key]--;
          return remove.apply(this, args);
        };
      }
    };
    wrapContext(globalThis.WebGLRenderingContext?.prototype);
    wrapContext(globalThis.WebGL2RenderingContext?.prototype);
  });
}
