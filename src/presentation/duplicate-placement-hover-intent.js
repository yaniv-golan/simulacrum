import * as THREE from "three";

function worldFaceNormal(hit) {
  if (!hit?.face?.normal || !hit.object) return null;
  const worldMatrix = hit.object.matrixWorld.clone();
  if (hit.object.isInstancedMesh && Number.isInteger(hit.instanceId)) {
    const instanceMatrix = new THREE.Matrix4();
    hit.object.getMatrixAt(hit.instanceId, instanceMatrix);
    worldMatrix.multiply(instanceMatrix);
  }
  return hit.face.normal
    .clone()
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(worldMatrix))
    .normalize()
    .toArray();
}

/** Owns the short-lived selected-face intent produced by canvas ray hits. */
export function createDuplicatePlacementHoverIntent({ selectedIds }) {
  let face = null,
    selectionKeyAtHit = null,
    pointerInside = false;
  const selectionKey = () =>
    [...selectedIds()].sort((left, right) => left - right).join(":");
  return Object.freeze({
    enter() {
      pointerInside = true;
    },
    clear() {
      pointerInside = false;
      face = null;
      selectionKeyAtHit = null;
    },
    remember(hit, partId) {
      const normalWorld = partId == null ? null : worldFaceNormal(hit);
      face = normalWorld ? { partId, normalWorld } : null;
      selectionKeyAtHit = selectionKey();
    },
    current() {
      if (
        !pointerInside ||
        !face ||
        selectionKeyAtHit !== selectionKey() ||
        !selectedIds().has(face.partId)
      )
        return null;
      return structuredClone(face);
    },
  });
}
