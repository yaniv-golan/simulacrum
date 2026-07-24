import * as THREE from "three";
import { WORKSHOP_PLATFORM_SIZE_M } from "../model/authoring-space-policy.js";

/** Builds the editor platform and scene groups without simulation ownership. */
export function createWorkshopPlatform({ scene }) {
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(
      WORKSHOP_PLATFORM_SIZE_M,
      0.5,
      WORKSHOP_PLATFORM_SIZE_M,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x26393c,
      roughness: 0.62,
      metalness: 0.35,
    }),
  );
  floor.position.y = -0.25;
  floor.receiveShadow = true;

  const foundation = new THREE.Mesh(
    new THREE.BoxGeometry(46, 0.15, 46),
    new THREE.MeshStandardMaterial({
      color: 0x777b76,
      roughness: 0.92,
      metalness: 0.04,
    }),
  );
  foundation.position.y = -0.575;
  foundation.castShadow = true;
  foundation.receiveShadow = true;

  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(
      new THREE.BoxGeometry(
        WORKSHOP_PLATFORM_SIZE_M,
        0.52,
        WORKSHOP_PLATFORM_SIZE_M,
      ),
    ),
    new THREE.LineBasicMaterial({
      color: 0x78e1c8,
      transparent: true,
      opacity: 0.95,
    }),
  );
  rim.position.y = -0.24;

  const grid = new THREE.GridHelper(
    WORKSHOP_PLATFORM_SIZE_M,
    WORKSHOP_PLATFORM_SIZE_M,
    0x72bcae,
    0x405b5b,
  );
  grid.position.y = 0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.38;

  const machine = new THREE.Group(),
    wires = new THREE.Group(),
    effects = new THREE.Group(),
    cameraTarget = new THREE.Vector3(0, 1.2, 0);
  scene.add(floor, foundation, rim, grid, machine, wires, effects);
  return Object.freeze({ floor, machine, wires, effects, cameraTarget });
}
