import { CYLINDER_SEGMENTS } from '../model/geometry.mjs';
import * as THREE from 'three';
/** Geometry-only reconstruction from canonical primitive dimensions. */
export function createPrimitiveGeometry({ kind, halfExtents: [x, y, z] }) {
  return kind === 'sphere'
    ? new THREE.SphereGeometry(x, 32, 24)
    : kind === 'cylinder'
      ? new THREE.CylinderGeometry(y, y, x * 2, CYLINDER_SEGMENTS).rotateZ(-Math.PI / 2)
      : new THREE.BoxGeometry(x * 2, y * 2, z * 2);
}
