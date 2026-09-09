import * as THREE from 'three';
/** Decorative captured coils: no turn colliders. All endpoints come from displayed
 * completed body transforms. Fixed wire thickness; one retained buffer per connection. */
export function createSpringView(scene) {
  const entries = new Map(),
    up = new THREE.Vector3(0, 1, 0),
    direction = new THREE.Vector3();
  const samples = 128,
    sides = 6,
    turns = 8,
    radius = 0.042,
    wire = 0.0025;
  function create() {
    const geometry = new THREE.BufferGeometry(),
      positions = new Float32Array((samples + 1) * (sides + 1) * 3),
      indices = [];
    for (let i = 0; i < samples; i++)
      for (let j = 0; j < sides; j++) {
        const a = i * (sides + 1) + j,
          b = a + sides + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: 0xa6b7bf, metalness: 0.8, roughness: 0.28 }),
    );
    mesh.castShadow = true;
    const gauge = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffcf80 }),
    );
    gauge.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
    mesh.add(gauge);
    scene.add(mesh);
    return { mesh, gauge, length: NaN };
  }
  function update(rows) {
    const keep = new Set();
    for (const row of rows) {
      keep.add(row.id);
      let entry = entries.get(row.id);
      if (!entry) {
        entry = create();
        entries.set(row.id, entry);
      }
      const { mesh, gauge } = entry;
      gauge.visible = !!row.selected && !!row.settings;
      if (gauge.visible) {
        const p = gauge.geometry.attributes.position;
        [row.settings.minLength, row.settings.restLength, row.settings.maxLength].forEach(
          (y, i) => {
            p.setXYZ(i * 2, 0.057, y, 0);
            p.setXYZ(i * 2 + 1, i === 1 ? 0.082 : 0.072, y, 0);
          },
        );
        p.needsUpdate = true;
        gauge.geometry.computeBoundingSphere();
      }
      direction.subVectors(row.b, row.a);
      const length = direction.length();
      mesh.visible = length > 0.001;
      if (!mesh.visible) continue;
      mesh.position.copy(row.a);
      mesh.quaternion.setFromUnitVectors(up, direction.normalize());
      mesh.material.color.setHex(row.selected ? 0xffcf80 : 0xa6b7bf);
      if (entry.length !== length) {
        const p = mesh.geometry.attributes.position.array;
        for (let i = 0; i <= samples; i++) {
          const t = i / samples,
            theta = t * turns * Math.PI * 2,
            cos = Math.cos(theta),
            sin = Math.sin(theta),
            pitch = length / (turns * Math.PI * 2),
            norm = Math.hypot(radius, pitch);
          for (let j = 0; j <= sides; j++) {
            const angle = (j / sides) * Math.PI * 2,
              a = wire * Math.cos(angle),
              b = wire * Math.sin(angle),
              o = (i * (sides + 1) + j) * 3;
            p[o] = radius * cos + a * cos - (b * sin * pitch) / norm;
            p[o + 1] = wire + t * (length - 2 * wire) + (b * radius) / norm;
            p[o + 2] = radius * sin + a * sin + (b * cos * pitch) / norm;
          }
        }
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingSphere();
        entry.length = length;
      }
    }
    for (const [id, entry] of entries)
      if (!keep.has(id)) {
        release(entry);
        entries.delete(id);
      }
  }
  function release({ mesh, gauge }) {
    gauge.geometry.dispose();
    gauge.material.dispose();
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  return {
    update,
    dispose() {
      for (const entry of entries.values()) release(entry);
      entries.clear();
    },
  };
}
