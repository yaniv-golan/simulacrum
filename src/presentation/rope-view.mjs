import * as THREE from 'three';
/** Retained piecewise-linear rope geometry from completed physical node centres.
 * Cylinders have no simulated collision surface; the inspector states that domain. */
export function createRopeView(scene) {
  const entries = new Map(),
    axis = new THREE.Vector3(0, 1, 0);
  function remove(entry) {
    scene.remove(entry.group);
    entry.geometry.dispose();
    entry.material.dispose();
  }
  return {
    update(rows) {
      const keep = new Set();
      for (const row of rows) {
        keep.add(row.id);
        let entry = entries.get(row.id);
        if (entry && entry.meshes.length !== row.points.length - 1) {
          remove(entry);
          entries.delete(row.id);
          entry = null;
        }
        if (!entry) {
          const group = new THREE.Group(),
            geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1),
            material = new THREE.MeshStandardMaterial({ color: 0xc79a62, roughness: 0.9 });
          const meshes = row.points.slice(1).map(() => {
            const mesh = new THREE.Mesh(geometry, material);
            group.add(mesh);
            return mesh;
          });
          entry = { group, geometry, material, meshes };
          entries.set(row.id, entry);
          scene.add(group);
        }
        entry.material.emissive.setHex(row.selected ? 0x473018 : 0);
        entry.meshes.forEach((mesh, i) => {
          const a = new THREE.Vector3(...row.points[i]),
            b = new THREE.Vector3(...row.points[i + 1]),
            d = b.clone().sub(a),
            length = d.length();
          mesh.visible = length > 1e-12;
          mesh.position.copy(a).add(b).multiplyScalar(0.5);
          mesh.scale.set(row.diameter / 2, length, row.diameter / 2);
          if (length > 1e-12) mesh.quaternion.setFromUnitVectors(axis, d.divideScalar(length));
          mesh.updateMatrixWorld(true);
        });
      }
      for (const [id, entry] of entries)
        if (!keep.has(id)) {
          remove(entry);
          entries.delete(id);
        }
    },
    readRenderedEndpoints() {
      return [...entries].flatMap(([id, entry]) =>
        entry.meshes.map((mesh, index) => {
          mesh.updateMatrixWorld(true);
          return {
            id,
            index,
            a: mesh.localToWorld(new THREE.Vector3(0, -0.5, 0)).toArray(),
            b: mesh.localToWorld(new THREE.Vector3(0, 0.5, 0)).toArray(),
          };
        }),
      );
    },
    dispose() {
      for (const entry of entries.values()) remove(entry);
      entries.clear();
    },
  };
}
