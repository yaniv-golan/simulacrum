import * as THREE from "three";
import { bolt, mats, mesh } from "../mesh-primitives.js";

export function buildPropellantTank({ g, accent }) {
  mesh(new THREE.CapsuleGeometry(0.53, 1.25, 12, 28), accent, [0, 0, 0], [], g);
  for (const y of [-0.62, 0.62])
    mesh(
      new THREE.TorusGeometry(0.55, 0.055, 12, 32),
      mats.steel,
      [0, y, 0],
      [Math.PI / 2, 0, 0],
      g,
    );
  mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 0.24, 18),
    mats.brass,
    [0, -1.17, 0],
    [],
    g,
  );
  mesh(
    new THREE.TorusGeometry(0.15, 0.025, 10, 24),
    mats.dark,
    [0, -1.3, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  for (const x of [-0.4, 0.4])
    mesh(new THREE.BoxGeometry(0.1, 2.15, 0.12), mats.dark, [x, 0, 0], [], g);
}

export function buildRcsCluster({ g, accent }) {
  mesh(new THREE.BoxGeometry(0.7, 0.38, 0.7), accent, [0, 0, 0], [], g);
  mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.52, 20),
    mats.dark,
    [0, 0, 0],
    [0, 0, Math.PI / 2],
    g,
  );
  const rcsNozzles =
    /** @type {Array<[number, number, [number, number, number]]>} */ ([
      [0.43, 0, [0, 0, -Math.PI / 2]],
      [-0.43, 0, [0, 0, Math.PI / 2]],
      [0, 0.43, [Math.PI / 2, 0, 0]],
      [0, -0.43, [-Math.PI / 2, 0, 0]],
    ]);
  for (const [x, z, rotation] of rcsNozzles)
    mesh(
      new THREE.CylinderGeometry(0.08, 0.14, 0.22, 16),
      mats.copper,
      [x, 0, z],
      rotation,
      g,
    );
  for (const x of [-0.24, 0.24])
    for (const z of [-0.24, 0.24]) bolt(g, x, 0.22, z, "y");
}

export function buildPressureNozzle({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.31, 0.43, 0.7, 28),
    accent,
    [0, 0.16, 0],
    [],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.21, 0.48, 0.5, 28),
    mats.copper,
    [0, -0.44, 0],
    [],
    g,
  );
  mesh(
    new THREE.TorusGeometry(0.36, 0.055, 12, 28),
    mats.steel,
    [0, -0.05, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    mesh(
      new THREE.BoxGeometry(0.38, 0.06, 0.22),
      mats.steel,
      [Math.cos(a) * 0.35, 0.22, Math.sin(a) * 0.35],
      [0, -a, 0],
      g,
    );
  }
}

export function buildFixedPitchRotor({ g, accent, geometryDescriptor }) {
  const rotor = geometryDescriptor.rotor,
    hubThicknessM = rotor.hubThicknessM,
    hubRadiusM = rotor.hubRadiusM,
    bladeSpanM = rotor.radiusM - hubRadiusM,
    bladeCenterM = hubRadiusM + bladeSpanM / 2;
  mesh(
    new THREE.CylinderGeometry(hubRadiusM, hubRadiusM, hubThicknessM, 28),
    mats.steel,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  for (let index = 0; index < rotor.bladeCount; index++) {
    const angle = (index / rotor.bladeCount) * Math.PI * 2,
      blade = mesh(
        new THREE.BoxGeometry(bladeSpanM, rotor.bladeChordM, 0.018),
        accent,
        [Math.cos(angle) * bladeCenterM, Math.sin(angle) * bladeCenterM, 0],
        [0, 0, angle],
        g,
      );
    blade.rotateX((rotor.handedness * 4 * Math.PI) / 180);
  }
}
