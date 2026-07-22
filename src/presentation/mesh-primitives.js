import * as THREE from "three";
import {
  markSharedRenderResource,
  sharePrimitiveGeometry,
} from "./render-resources.js";
export const mats = {
  steel: new THREE.MeshStandardMaterial({
    color: 0x8fa3a8,
    metalness: 0.9,
    roughness: 0.2,
  }),
  dark: new THREE.MeshStandardMaterial({
    color: 0x182529,
    metalness: 0.75,
    roughness: 0.26,
  }),
  rubber: new THREE.MeshStandardMaterial({
    color: 0x12191b,
    metalness: 0.05,
    roughness: 0.82,
  }),
  brass: new THREE.MeshStandardMaterial({
    color: 0xc89538,
    metalness: 0.82,
    roughness: 0.22,
  }),
  copper: new THREE.MeshStandardMaterial({
    color: 0xb85d32,
    metalness: 0.7,
    roughness: 0.28,
  }),
  ceramic: new THREE.MeshStandardMaterial({
    color: 0xdbe7e5,
    metalness: 0.12,
    roughness: 0.38,
  }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x62d9c2,
    emissive: 0x17483f,
    emissiveIntensity: 1,
    metalness: 0.15,
    roughness: 0.12,
  }),
};
for (const material of Object.values(mats)) markSharedRenderResource(material);
export function mesh(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], parent) {
  const m = new THREE.Mesh(sharePrimitiveGeometry(geo), mat);
  m.position.set(pos[0] || 0, pos[1] || 0, pos[2] || 0);
  m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  (parent || new THREE.Group()).add(m);
  return m;
}

/** Creates one draw call for repeated details within a selectable component. */
export function instances(geo, mat, transforms, parent) {
  const geometry = sharePrimitiveGeometry(geo),
    result = new THREE.InstancedMesh(geometry, mat, transforms.length),
    matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion(),
    scale = new THREE.Vector3(),
    euler = new THREE.Euler();
  transforms.forEach((transform, index) => {
    const [x = 0, y = 0, z = 0] = transform.position || [],
      [rx = 0, ry = 0, rz = 0] = transform.rotation || [],
      [sx = 1, sy = 1, sz = 1] = transform.scale || [];
    position.set(x, y, z);
    euler.set(rx, ry, rz);
    quaternion.setFromEuler(euler);
    scale.set(sx, sy, sz);
    result.setMatrixAt(index, matrix.compose(position, quaternion, scale));
  });
  result.instanceMatrix.needsUpdate = true;
  result.computeBoundingBox();
  result.computeBoundingSphere();
  result.castShadow = true;
  result.receiveShadow = true;
  parent.add(result);
  return result;
}
export function bolt(parent, x, y, z, axis = "z") {
  const rotation =
    axis === "z"
      ? [Math.PI / 2, 0, 0]
      : axis === "x"
        ? [0, 0, Math.PI / 2]
        : [0, 0, 0];
  const m = mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 0.045, 12),
    mats.steel,
    [x, y, z],
    rotation,
    parent,
  );
  return m;
}
