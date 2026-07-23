import * as THREE from "three";
import { bolt, instances, mats, mesh } from "../mesh-primitives.js";

export function buildMotor({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.43, 0.43, 0.78, 28),
    accent,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.12, 28),
    mats.dark,
    [0, 0, -0.44],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.48, 0.48, 0.12, 28),
    mats.dark,
    [0, 0, 0.44],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.48, 24),
    mats.steel,
    [0, 0, 0.68],
    [Math.PI / 2, 0, 0],
    g,
  );
  instances(
    new THREE.BoxGeometry(0.045, 0.12, 0.55),
    mats.steel,
    Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2;
      return {
        position: [Math.cos(angle) * 0.43, Math.sin(angle) * 0.43, 0],
        rotation: [0, 0, angle],
      };
    }),
    g,
  );
  mesh(new THREE.BoxGeometry(0.34, 0.18, 0.3), mats.dark, [0, 0.47, 0], [], g);
  mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.18, 12),
    mats.copper,
    [-0.09, 0.6, 0],
    [],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.18, 12),
    mats.glass,
    [0.09, 0.6, 0],
    [],
    g,
  );
}

export function buildGyroscope({ g, accent }) {
  mesh(
    new THREE.TorusGeometry(0.28, 0.09, 16, 36),
    accent,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.4, 20),
    mats.steel,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.TorusGeometry(0.19, 0.025, 10, 30),
    mats.glass,
    [0, 0, 0.12],
    [],
    g,
  );
}

export function buildInertialSensor({ g, accent }) {
  mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), mats.dark, [0, 0, 0], [], g);
  mesh(new THREE.BoxGeometry(0.42, 0.03, 0.42), accent, [0, 0.095, 0], [], g);
  for (const [x, z] of [
    [-0.15, -0.15],
    [0.15, -0.15],
    [-0.15, 0.15],
    [0.15, 0.15],
  ])
    mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.08, 12),
      mats.brass,
      [x, 0.13, z],
      [],
      g,
    );
  mesh(
    new THREE.BoxGeometry(0.16, 0.05, 0.16),
    mats.glass,
    [0, 0.135, 0],
    [],
    g,
  );
}

export function buildLogicComputer({ g, accent }) {
  mesh(new THREE.BoxGeometry(0.82, 0.3, 0.92), mats.dark, [0, 0, 0], [], g);
  mesh(new THREE.BoxGeometry(0.7, 0.035, 0.7), accent, [0, 0.17, 0], [], g);
  instances(
    new THREE.BoxGeometry(0.055, 0.045, 0.055),
    mats.glass,
    Array.from({ length: 5 }, (_, xIndex) => -0.26 + xIndex * 0.13).flatMap(
      (x) =>
        Array.from({ length: 4 }, (_, zIndex) => ({
          position: [x, 0.21, -0.25 + zIndex * 0.13],
        })),
    ),
    g,
  );
  instances(
    new THREE.BoxGeometry(0.04, 0.18, 0.08),
    mats.brass,
    Array.from({ length: 7 }, (_, index) => ({
      position: [-0.33 + index * 0.11, 0, 0.49],
    })),
    g,
  );
}

export function buildRangeSensor({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.2, 0.23, 0.5, 24),
    mats.dark,
    [0, 0, 0],
    [],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.035, 24),
    mats.glass,
    [0, 0.27, 0],
    [],
    g,
  );
  mesh(
    new THREE.TorusGeometry(0.15, 0.026, 12, 28),
    accent,
    [0, 0.255, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  for (const x of [-0.13, 0.13])
    mesh(
      new THREE.BoxGeometry(0.06, 0.12, 0.08),
      mats.brass,
      [x, -0.25, 0],
      [],
      g,
    );
}

export function buildRotationSensor({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.28, 24),
    accent,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.31, 24),
    mats.glass,
    [0, 0, 0.03],
    [Math.PI / 2, 0, 0],
    g,
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    mesh(
      new THREE.BoxGeometry(0.035, 0.12, 0.04),
      mats.dark,
      [Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.18],
      [0, 0, a],
      g,
    );
  }
}

export function buildContactSensor({ g, accent }) {
  mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mats.dark, [0, 0, 0], [], g);
  mesh(new THREE.BoxGeometry(0.38, 0.07, 0.38), accent, [0, -0.095, 0], [], g);
  for (const [x, z] of [
    [-0.17, -0.17],
    [0.17, -0.17],
    [-0.17, 0.17],
    [0.17, 0.17],
  ])
    mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.09, 12),
      mats.brass,
      [x, 0.08, z],
      [],
      g,
    );
}

export function buildThermalProbe({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.58, 18),
    mats.steel,
    [0, 0, 0],
    [],
    g,
  );
  mesh(new THREE.SphereGeometry(0.16, 20, 14), accent, [0, 0.31, 0], [], g);
  mesh(new THREE.BoxGeometry(0.34, 0.16, 0.3), mats.dark, [0, -0.3, 0], [], g);
}

export function buildPressureProbe({ g, accent }) {
  mesh(
    new THREE.CylinderGeometry(0.07, 0.14, 0.72, 20),
    accent,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  mesh(
    new THREE.TorusGeometry(0.16, 0.04, 12, 24),
    mats.dark,
    [0, 0, 0.16],
    [],
    g,
  );
  mesh(
    new THREE.SphereGeometry(0.045, 14, 10),
    mats.glass,
    [0, 0, -0.38],
    [],
    g,
  );
}

export function buildLoadCell({ g, accent }) {
  mesh(new THREE.BoxGeometry(0.58, 0.2, 0.58), mats.dark, [0, 0, 0], [], g);
  mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.26, 24),
    accent,
    [0, 0, 0],
    [],
    g,
  );
  mesh(
    new THREE.TorusGeometry(0.21, 0.035, 12, 28),
    mats.brass,
    [0, 0.14, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  for (const x of [-0.22, 0.22])
    for (const z of [-0.22, 0.22]) bolt(g, x, 0.13, z, "y");
}

export function buildHeadlight({ g, accent, visualDescriptor }) {
  mesh(
    new THREE.CylinderGeometry(0.19, 0.23, 0.28, 24),
    mats.dark,
    [0, 0, 0],
    [Math.PI / 2, 0, 0],
    g,
  );
  const bulbMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe8ae,
      emissive: 0xffb22e,
      emissiveIntensity: 0.08,
      metalness: 0.12,
      roughness: 0.16,
    }),
    bulb = mesh(
      new THREE.CylinderGeometry(0.145, 0.145, 0.04, 24),
      bulbMaterial,
      [0, 0, -0.17],
      [Math.PI / 2, 0, 0],
      g,
    );
  bulb.userData.headlightBulb = true;
  const light = new THREE.SpotLight(0xffd8a3, 0, 30, Math.PI / 8, 0.55, 2),
    target = new THREE.Object3D();
  light.position.set(0, 0, -0.2);
  target.position.set(0, -0.45, -11.5);
  // Shadow render targets are allocated only while the lamp is physically on.
  // Idle headlights otherwise retain two 1024² GPU textures per blueprint
  // reload despite producing no light.
  light.castShadow = false;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.25;
  light.shadow.camera.far = 30;
  light.shadow.bias = -0.00018;
  light.shadow.normalBias = 0.018;
  light.shadow.radius = 2;
  light.target = target;
  light.userData.headlightLight = true;
  light.userData.lumens = visualDescriptor.lumens;
  light.userData.powerWatts = visualDescriptor.powerWatts;
  g.add(light, target);
  mesh(new THREE.BoxGeometry(0.3, 0.12, 0.18), accent, [0, -0.23, 0.05], [], g);
}

export function buildBattery({ g, accent }) {
  mesh(new THREE.BoxGeometry(0.72, 0.95, 0.54), accent, [0, 0, 0], [], g);
  mesh(new THREE.BoxGeometry(0.62, 0.08, 0.45), mats.dark, [0, 0.52, 0], [], g);
  mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.12, 16),
    mats.copper,
    [-0.18, 0.6, 0],
    [],
    g,
  );
  mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.12, 16),
    mats.steel,
    [0.18, 0.6, 0],
    [],
    g,
  );
  for (let y = -0.28; y <= 0.29; y += 0.18)
    mesh(new THREE.BoxGeometry(0.76, 0.035, 0.58), mats.dark, [0, y, 0], [], g);
}
