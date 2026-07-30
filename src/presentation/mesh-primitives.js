import * as THREE from "three";
import {
  markSharedRenderResource,
  sharePrimitiveGeometry,
} from "./render-resources.js";

function roughnessTexture() {
  const size = 8,
    data = new Uint8Array(size * size * 4);
  for (let index = 0; index < size * size; index++) {
    const x = index % size,
      y = Math.floor(index / size),
      value = 176 + ((x * 29 + y * 47 + x * y * 7) % 48);
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(
    data,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "deterministic-micro-roughness-v1";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.needsUpdate = true;
  return markSharedRenderResource(texture);
}

export const sharedSurfaceTextures = Object.freeze({
  microRoughness: roughnessTexture(),
});

export const mats = {
  steel: new THREE.MeshStandardMaterial({
    color: 0x8fa3a8,
    metalness: 0.9,
    roughness: 0.3,
    roughnessMap: sharedSurfaceTextures.microRoughness,
  }),
  aluminum: new THREE.MeshStandardMaterial({
    color: 0xb8c5c7,
    metalness: 0.78,
    roughness: 0.42,
    roughnessMap: sharedSurfaceTextures.microRoughness,
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
    roughnessMap: sharedSurfaceTextures.microRoughness,
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
  nylon: new THREE.MeshStandardMaterial({
    color: 0x8c775a,
    metalness: 0.02,
    roughness: 0.76,
    roughnessMap: sharedSurfaceTextures.microRoughness,
  }),
  composite: new THREE.MeshStandardMaterial({
    color: 0x273236,
    metalness: 0.08,
    roughness: 0.48,
    roughnessMap: sharedSurfaceTextures.microRoughness,
  }),
  ablative: new THREE.MeshStandardMaterial({
    color: 0x30231f,
    metalness: 0,
    roughness: 0.91,
    roughnessMap: sharedSurfaceTextures.microRoughness,
  }),
};
for (const [name, material] of Object.entries(mats)) {
  material.name = `catalog-${name}`;
  markSharedRenderResource(material);
}
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
