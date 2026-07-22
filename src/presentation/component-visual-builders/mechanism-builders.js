import * as THREE from "three";
import { instances, mats, mesh } from "../mesh-primitives.js";

export function gearShape(radius, teeth, color) {
  const g = new THREE.Group(),
    mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.76,
      roughness: 0.24,
    });
  const core = mesh(
    new THREE.CylinderGeometry(radius * 0.72, radius * 0.72, 0.22, 32),
    mat,
    [0, 0, 0],
    [],
    g,
  );
  core.rotation.x = Math.PI / 2;
  instances(
    new THREE.BoxGeometry(radius * 0.22, 0.2, radius * 0.12),
    mat,
    Array.from({ length: teeth }, (_, index) => {
      const angle = (index / teeth) * Math.PI * 2;
      return {
        position: [Math.cos(angle) * radius, Math.sin(angle) * radius, 0],
        rotation: [0, 0, angle],
      };
    }),
    g,
  );
  mesh(
    new THREE.TorusGeometry(radius * 0.2, 0.09, 10, 24),
    new THREE.MeshStandardMaterial({
      color: 0x27363a,
      metalness: 0.9,
      roughness: 0.18,
    }),
    [0, 0, 0],
    [],
    g,
  );
  return g;
}

export function addCanonicalMechanismMeshes(group, descriptor, accent) {
  for (const primitive of descriptor.collisionPrimitives) {
    const material =
        primitive.contactRole === "tire-envelope" ? mats.rubber : accent,
      orientation = Array.isArray(primitive.orientation)
        ? new THREE.Quaternion(...primitive.orientation)
        : new THREE.Quaternion();
    let geometry;
    if (primitive.kind === "box")
      geometry = new THREE.BoxGeometry(...primitive.size);
    else {
      geometry = new THREE.CylinderGeometry(
        primitive.radius,
        primitive.radius,
        primitive.length,
        32,
      );
      const axisOrientation = new THREE.Quaternion();
      if (primitive.axis[0] === 1)
        axisOrientation.setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -Math.PI / 2,
        );
      else if (primitive.axis[2] === 1)
        axisOrientation.setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.PI / 2,
        );
      orientation.multiply(axisOrientation);
    }
    const object = mesh(
      geometry,
      material,
      primitive.position || [0, 0, 0],
      [],
      group,
    );
    object.quaternion.copy(orientation);
  }
}

export function buildSpurGear({ visualDescriptor }) {
  const gear = gearShape(
    visualDescriptor.radius,
    visualDescriptor.teeth,
    visualDescriptor.color,
  );
  mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.38, 24),
    mats.steel,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    gear,
  );
  instances(
    new THREE.CylinderGeometry(0.055, 0.055, 0.28, 12),
    mats.dark,
    Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2;
      return {
        position: [
          Math.cos(angle) * visualDescriptor.radius * 0.43,
          Math.sin(angle) * visualDescriptor.radius * 0.43,
          0,
        ],
        rotation: [Math.PI / 2, 0, 0],
      };
    }),
    gear,
  );
  return gear;
}

export function buildLever({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 1.35, 18),
    mats.steel,
    [0, 0.12, 0],
    [0, 0, -0.32],
    g,
  );
  mesh(new THREE.SphereGeometry(0.22, 24, 16), accent, [-0.22, 0.79, 0], [], g);
  mesh(
    new THREE.CylinderGeometry(0.28, 0.32, 0.22, 24),
    mats.dark,
    [0.21, -0.55, 0],
    [],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.72, 18),
    mats.brass,
    [0.21, -0.55, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
}

export function buildCanonicalMechanism({ g, geometryDescriptor, accent }) {
  const deformationRoot = new THREE.Group();
  deformationRoot.userData.mechanismDeformationRoot = true;
  g.userData.mechanismDeformationRoot = deformationRoot;
  g.add(deformationRoot);
  addCanonicalMechanismMeshes(deformationRoot, geometryDescriptor, accent);
}
