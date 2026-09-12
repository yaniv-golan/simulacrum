import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Cosmetic surface response only. These are not density, contact or strength values.
// Bare aluminium is satin; steel has a tighter highlight; rubber is nonmetallic.
export function materialFinish(material) {
  const finishes = {
    aluminium: { color: 0xb6bfc3, metalness: 0.72, roughness: 0.48 },
    steel: { color: 0x89959f, metalness: 0.9, roughness: 0.28 },
    rubber: { color: 0x25292c, metalness: 0, roughness: 0.88 },
  };
  return { ...finishes[material] };
}

// Finish categories describe only the visible coating. A painted steel body
// remains steel in the authored model, including when its coating hides the metal.
export function createSurfaceMaterial(material, { paint } = {}) {
  const finish =
    paint === undefined
      ? materialFinish(material)
      : {
          color: paint,
          metalness: 0,
          roughness: 0.58,
        };
  const pixels = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const grain = ((x * 73 + y * 151 + x * y * 17) % 31) / 30;
      const brushed = paint === undefined && material === 'aluminium';
      const value = Math.round(235 + 20 * (brushed ? ((y * 13) % 17) / 16 : grain));
      pixels.set([value, value, value, 255], (y * 64 + x) * 4);
    }
  // Roughness variation adds brushing/moulded surface grain without changing
  // silhouettes, normals, clearances, collision geometry or authored properties.
  const texture = new THREE.DataTexture(pixels, 64, 64);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  const result = new THREE.MeshStandardMaterial({ ...finish, roughnessMap: texture });
  result.addEventListener('dispose', () => texture.dispose());
  return result;
}

// A small studio reflection field gives metals readable highlights in every consumer.
// The caller owns the returned render target and must dispose it with its renderer.
export function createFinishEnvironment(renderer) {
  const room = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(room, 0.04);
  } finally {
    room.dispose();
    generator.dispose();
  }
}

export function createPortHardware(port, ports, halfExtents) {
  const group = new THREE.Group();
  group.position.fromArray(port.position);
  // Electrical rotations encode authored frames, not housing face normals. Find
  // the surface geometrically; never reinterpret input/output as a spatial axis.
  const axis = port.position.reduce(
    (best, value, i) =>
      Math.abs(value / halfExtents[i]) > Math.abs(port.position[best] / halfExtents[best])
        ? i
        : best,
    0,
  );
  const normal = new THREE.Vector3();
  normal.setComponent(axis, Math.sign(port.position[axis]) || 1);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  const nearest = Math.min(
    Infinity,
    ...ports
      .filter((other) => other !== port)
      .map((other) =>
        new THREE.Vector3(...port.position).distanceTo(new THREE.Vector3(...other.position)),
      ),
  );
  // One aperture per endpoint, with a conservative envelope even in dense banks.
  const radius = Math.min(0.007, nearest * 0.22, ...halfExtents.map((v) => v * 0.45));
  const add = (geometry, options, z) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial(options));
    mesh.position.z = z;
    // Decoration cannot enlarge or replace the existing part picking surface.
    mesh.raycast = () => {};
    group.add(mesh);
    return mesh;
  };
  const power = port.kind === 'power';
  add(
    new THREE.CylinderGeometry(radius, radius, radius * 0.4, power ? 6 : 16).rotateX(Math.PI / 2),
    { color: 0x232b30, roughness: 0.8, metalness: 0 },
    radius * 0.2,
  );
  add(
    new THREE.RingGeometry(radius * 0.54, radius * 0.88, power ? 6 : 20),
    { color: power ? 0xc59a55 : 0x699d99, roughness: 0.45, metalness: 0.3 },
    radius * 0.405,
  );
  add(
    new THREE.CircleGeometry(radius * 0.53, 20),
    { color: 0x10161a, roughness: 0.95, metalness: 0 },
    radius * 0.41,
  );
  add(
    new THREE.RingGeometry(radius * 0.24, radius * 0.36, 16),
    { color: 0xc3bfae, roughness: 0.3, metalness: 0.8 },
    radius * 0.42,
  );
  // Retain the exact former bead's hit volume without rendering it. Endpoint
  // authoring still uses the existing port rows and authored connection positions.
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(0.007, 12, 8),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.quaternion.copy(group.quaternion).invert();
  group.add(hit);
  return group;
}

// Authoring highlights retain the existing target semantics; only the visible cue shrinks.
export function portCueRadius(port, ports) {
  return Math.min(
    0.012,
    ...ports
      .filter((other) => other !== port)
      .map(
        (other) =>
          new THREE.Vector3(...port.position).distanceTo(new THREE.Vector3(...other.position)) *
          0.4,
      ),
  );
}
