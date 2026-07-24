import * as THREE from "three";

/** Returns the authored part identity from ordinary or instanced ray hits. */
export function partIdForCameraHit(hit) {
  return (
    hit?.object?.userData?.partIds?.[hit.instanceId] ??
    hit?.object?.userData?.partId ??
    null
  );
}

/** Captures only bounded camera values needed by model-owned placement. */
export function placementIntentForCamera(camera, target) {
  camera.updateMatrixWorld(true);
  const rightWorld = new THREE.Vector3()
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .normalize();
  return {
    positionWorldM: camera.position.toArray(),
    targetWorldM: target.toArray(),
    rightWorld: rightWorld.toArray(),
    constructionUpWorld: [0, 1, 0],
  };
}
