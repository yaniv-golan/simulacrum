/**
 * Coordinates deterministic Earth streaming and floating-origin rebasing.
 * Supplied roots and bodies only need mutable x/z positions, so this module
 * owns neither the rendering engine nor the physics engine.
 */
export function createEarthStreamingController({
  streamer,
  origin,
  focus,
  roots,
  landmark,
  physicsBodies,
  detachedParts,
  camera,
  chunkSize,
  rebuildEnvironment,
  rebaseThreshold = 2048,
}) {
  function translate(position, deltaX, deltaZ) {
    position.x -= deltaX;
    position.z -= deltaZ;
  }

  function rebase(deltaX, deltaZ) {
    if (!deltaX && !deltaZ) return;
    streamer.clear();
    origin.move(deltaX, deltaZ);
    rebuildEnvironment(origin.east(), origin.north());
    for (const root of roots())
      if (root?.position) translate(root.position, deltaX, deltaZ);
    translate(landmark, deltaX, deltaZ);
    for (const body of physicsBodies())
      translate(body.position, deltaX, deltaZ);
    for (const part of detachedParts())
      translate(part.mesh.position, deltaX, deltaZ);
    translate(camera.target, deltaX, deltaZ);
    camera.shift(deltaX, deltaZ);
  }

  function update(maxNewChunks = 3) {
    const point = focus();
    if (
      Math.abs(point.x) > rebaseThreshold ||
      Math.abs(point.z) > rebaseThreshold
    )
      rebase(
        Math.trunc(point.x / chunkSize) * chunkSize,
        Math.trunc(point.z / chunkSize) * chunkSize,
      );
    return streamer.update(
      origin.east(),
      origin.north(),
      point.x,
      point.z,
      maxNewChunks,
    );
  }

  return Object.freeze({ rebase, update });
}
