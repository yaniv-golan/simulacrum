import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bolt, instances, mats, mesh } from "../mesh-primitives.js";
import { markSharedRenderResource } from "../render-resources.js";

const beamGeometryCache = new Map();

export function coloredGeometry(
  geometry,
  color,
  position,
  rotation = [0, 0, 0],
) {
  const vertexColor = new THREE.Color(color),
    colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let index = 0; index < colors.length; index += 3) {
    colors[index] = vertexColor.r;
    colors[index + 1] = vertexColor.g;
    colors[index + 2] = vertexColor.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return geometry;
}

export function beamGeometry(accentColor, cache = true) {
  const colorKey = new THREE.Color(accentColor).getHexString();
  if (cache && beamGeometryCache.has(colorKey))
    return beamGeometryCache.get(colorKey);
  const geometries = [
      coloredGeometry(
        new THREE.BoxGeometry(2.4, 0.34, 0.34),
        accentColor,
        [0, 0, 0],
      ),
      coloredGeometry(
        new THREE.BoxGeometry(2.1, 0.11, 0.36),
        mats.dark.color,
        [0, 0.12, 0],
      ),
    ],
    beamXs = Array.from({ length: 4 }, (_, index) => -0.95 + index * 0.48);
  for (const x of beamXs) {
    geometries.push(
      coloredGeometry(
        new THREE.CylinderGeometry(0.09, 0.09, 0.38, 18),
        mats.dark.color,
        [x, 0, 0],
        [Math.PI / 2, 0, 0],
      ),
      coloredGeometry(
        new THREE.TorusGeometry(0.09, 0.018, 8, 18),
        mats.steel.color,
        [x, 0, 0.19],
      ),
    );
  }
  const geometry = mergeGeometries(geometries, false);
  for (const source of geometries) source.dispose();
  if (cache) {
    markSharedRenderResource(geometry);
    beamGeometryCache.set(colorKey, geometry);
  }
  return geometry;
}

export function buildBeam({ g, accent, visualDescriptor }) {
  mesh(
    beamGeometry(visualDescriptor.color, visualDescriptor.customColor === null),
    accent,
    [0, 0, 0],
    [],
    g,
  );
}

export function buildPlate({ g, accent }) {
  mesh(new THREE.BoxGeometry(2.4, 0.16, 2.4), accent, [0, 0, 0], [], g);
  mesh(
    new THREE.BoxGeometry(2.08, 0.07, 2.08),
    mats.dark,
    [0, 0.115, 0],
    [],
    g,
  );
  instances(
    new THREE.CylinderGeometry(0.07, 0.07, 0.2, 14),
    mats.steel,
    [-0.9, 0, 0.9].flatMap((x) =>
      [-0.9, 0, 0.9].map((z) => ({ position: [x, 0.12, z] })),
    ),
    g,
  );
}

export function buildCargo({ g, accent }) {
  mesh(new THREE.BoxGeometry(1.2, 0.9, 1.1), accent, [0, 0, 0], [], g);
  mesh(new THREE.BoxGeometry(1.08, 0.04, 0.98), mats.dark, [0, 0.47, 0], [], g);
  for (const x of [-0.55, 0.55])
    for (const z of [-0.5, 0.5]) {
      mesh(
        new THREE.BoxGeometry(0.12, 1.02, 0.12),
        mats.dark,
        [x, 0, z],
        [],
        g,
      );
      bolt(g, x, 0.47, z, "y");
    }
  for (const z of [-0.28, 0.28])
    mesh(
      new THREE.BoxGeometry(1.28, 0.12, 0.08),
      mats.steel,
      [0, 0.1, z],
      [],
      g,
    );
  mesh(
    new THREE.BoxGeometry(0.58, 0.28, 0.025),
    new THREE.MeshStandardMaterial({
      color: 0xe9e1c9,
      roughness: 0.72,
      metalness: 0.05,
    }),
    [0, 0.08, 0.565],
    [],
    g,
  );
  for (const x of [-0.44, 0.44])
    mesh(
      new THREE.TorusGeometry(0.1, 0.025, 9, 20, Math.PI),
      mats.steel,
      [x, 0.49, 0],
      [Math.PI / 2, 0, 0],
      g,
    );
}

export function buildNosecone({ g, accent }) {
  mesh(new THREE.ConeGeometry(0.46, 1.28, 32, 6), accent, [0, 0.04, 0], [], g);
  mesh(
    new THREE.CylinderGeometry(0.49, 0.49, 0.13, 32),
    mats.dark,
    [0, -0.64, 0],
    [],
    g,
  );
  mesh(
    new THREE.SphereGeometry(0.075, 18, 12),
    mats.ceramic,
    [0, 0.7, 0],
    [],
    g,
  );
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    bolt(g, Math.cos(a) * 0.4, -0.58, Math.sin(a) * 0.4, "y");
  }
}

export function buildHeatShield({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.48, 0.58, 0.3, 36, 4),
    accent,
    [0, 0, 0],
    [],
    g,
  );
  mesh(
    new THREE.SphereGeometry(0.54, 36, 12, 0, Math.PI * 2, 0, Math.PI / 3),
    new THREE.MeshStandardMaterial({
      color: 0x2a2523,
      roughness: 0.92,
      metalness: 0.02,
    }),
    [0, 0.08, 0],
    [],
    g,
  );
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    bolt(g, Math.cos(angle) * 0.45, -0.14, Math.sin(angle) * 0.45, "y");
  }
}

export function buildFin({ g, accent }) {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.52);
  shape.lineTo(0, 0.52);
  shape.lineTo(0.72, -0.52);
  shape.closePath();
  const finGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.12,
    bevelEnabled: true,
    bevelSize: 0.025,
    bevelThickness: 0.02,
    bevelSegments: 2,
  });
  finGeometry.translate(-0.05, 0, -0.06);
  mesh(finGeometry, accent, [0, 0, 0], [], g);
  mesh(new THREE.BoxGeometry(0.16, 1.08, 0.2), mats.dark, [-0.03, 0, 0], [], g);
}
