import * as THREE from "three";
import { bolt, mats, mesh } from "./mesh-primitives.js";
import { disposeObject3D } from "./render-resources.js";

/**
 * Replaces a symmetric plate mesh with a directional heel, sole, and toe.
 * The +Z toe direction matches the articulated controller's forward axis.
 *
 * @template {{ mesh: THREE.Group }} T
 * @param {T} part
 * @returns {T}
 */
export function prepareArticulatedFootVisual(part) {
  disposeObject3D(part.mesh, { remove: false });
  part.mesh.clear();
  part.mesh.scale.set(1, 1, 1);
  part.mesh.userData.visualDetailPolicy = "authored-fixed-v1";
  part.mesh.userData.visualDetailTier = "standard";
  mesh(
    new THREE.BoxGeometry(0.38, 0.1, 0.72),
    mats.rubber,
    [0, -0.05, 0.02],
    [],
    part.mesh,
  );
  mesh(
    new THREE.BoxGeometry(0.34, 0.12, 0.42),
    mats.dark,
    [0, 0.035, -0.08],
    [],
    part.mesh,
  );
  mesh(
    new THREE.BoxGeometry(0.44, 0.13, 0.27),
    mats.steel,
    [0, 0.025, 0.29],
    [],
    part.mesh,
  );
  mesh(
    new THREE.BoxGeometry(0.46, 0.09, 0.075),
    mats.brass,
    [0, 0.025, 0.465],
    [],
    part.mesh,
  );
  mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.2, 18),
    mats.steel,
    [0, 0.11, -0.18],
    [],
    part.mesh,
  );
  for (const x of [-0.13, 0.13]) {
    bolt(part.mesh, x, 0.105, 0.27, "y");
    bolt(part.mesh, x, 0.105, -0.08, "y");
  }
  return part;
}
