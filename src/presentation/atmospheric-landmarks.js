import * as THREE from "three";

export const CLOUD_LAYERS = [
  {
    id: "cumulus",
    baseM: 900,
    topM: 2200,
    minRadiusM: 2200,
    maxRadiusM: 7200,
    clusters: 22,
    lobes: 7,
    horizontalScaleM: 330,
    opacity: 0.28,
  },
  {
    id: "altocumulus",
    baseM: 3000,
    topM: 5600,
    minRadiusM: 5200,
    maxRadiusM: 12000,
    clusters: 16,
    lobes: 5,
    horizontalScaleM: 520,
    opacity: 0.2,
  },
  {
    id: "cirrus",
    baseM: 8000,
    topM: 11000,
    minRadiusM: 8500,
    maxRadiusM: 18000,
    clusters: 12,
    lobes: 4,
    horizontalScaleM: 950,
    opacity: 0.13,
  },
];

const smoothstep = (minimum, maximum, value) => {
  const x = THREE.MathUtils.clamp(
    (value - minimum) / (maximum - minimum),
    0,
    1,
  );
  return x * x * (3 - 2 * x);
};

/** Creates deterministic physical-scale mountain geometry and cloud layers. */
export function createAtmosphericLandmarks({ scene, fieldSurfaceY }) {
  const horizonEnvironment = new THREE.Group(),
    cloudMeshes = [];
  horizonEnvironment.name = "physicalHorizonEnvironment";
  scene.add(horizonEnvironment);

  // This annular heightfield is ordinary terrain at 9-23 km range. Its height
  // is a deterministic sum of spatial wavelengths; the silhouette therefore
  // comes from geometry and perspective, never a camera-facing backdrop.
  const angularSegments = 256,
    radialSegments = 10,
    innerRadiusM = 9000,
    outerRadiusM = 23000,
    positions = [],
    colors = [],
    indices = [],
    rockLow = new THREE.Color(0x35483c),
    rockHigh = new THREE.Color(0x77766f),
    snow = new THREE.Color(0xe7e7df);
  for (let radial = 0; radial <= radialSegments; radial++) {
    const radialT = radial / radialSegments,
      radius = THREE.MathUtils.lerp(innerRadiusM, outerRadiusM, radialT),
      ridgeEnvelope = Math.pow(Math.sin(radialT * Math.PI), 1.35);
    for (let segment = 0; segment < angularSegments; segment++) {
      const angle = (segment / angularSegments) * Math.PI * 2,
        continentalWave =
          0.52 +
          0.22 * Math.sin(angle * 3 + 0.6) +
          0.16 * Math.sin(angle * 7 - 1.1) +
          0.1 * Math.sin(angle * 17 + 2.2),
        sharpRidges = Math.pow(
          Math.abs(Math.sin(angle * 11 + Math.sin(angle * 4))),
          1.7,
        ),
        elevation =
          fieldSurfaceY +
          ridgeEnvelope * (1050 + 2100 * continentalWave + 900 * sharpRidges),
        color = rockLow
          .clone()
          .lerp(rockHigh, smoothstep(550, 2200, elevation))
          .lerp(snow, smoothstep(2450, 3300, elevation));
      positions.push(
        Math.cos(angle) * radius,
        elevation,
        Math.sin(angle) * radius,
      );
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let radial = 0; radial < radialSegments; radial++)
    for (let segment = 0; segment < angularSegments; segment++) {
      const next = (segment + 1) % angularSegments,
        a = radial * angularSegments + segment,
        b = radial * angularSegments + next,
        c = (radial + 1) * angularSegments + segment,
        d = (radial + 1) * angularSegments + next;
      indices.push(a, c, b, b, c, d);
    }
  const mountainGeometry = new THREE.BufferGeometry();
  mountainGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  mountainGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  mountainGeometry.setIndex(indices);
  mountainGeometry.computeVertexNormals();
  const mountainRange = new THREE.Mesh(
    mountainGeometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      fog: true,
      side: THREE.DoubleSide,
    }),
  );
  mountainRange.name = "Distant mountain heightfield · 9-23 km";
  mountainRange.receiveShadow = true;
  horizonEnvironment.add(mountainRange);

  let atmosphereSeed = 481516234;
  const random = () => {
    atmosphereSeed = (atmosphereSeed * 1664525 + 1013904223) >>> 0;
    return atmosphereSeed / 4294967296;
  };
  for (const layer of CLOUD_LAYERS) {
    const geometry = new THREE.SphereGeometry(1, 14, 9),
      material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: layer.opacity,
        depthWrite: false,
        fog: true,
      }),
      instances = new THREE.InstancedMesh(
        geometry,
        material,
        layer.clusters * layer.lobes,
      ),
      transform = new THREE.Object3D();
    let instance = 0;
    for (let cluster = 0; cluster < layer.clusters; cluster++) {
      const angle =
          (cluster / layer.clusters) * Math.PI * 2 +
          (random() - 0.5) * ((Math.PI * 2) / layer.clusters) * 0.55,
        radius = THREE.MathUtils.lerp(
          layer.minRadiusM,
          layer.maxRadiusM,
          random(),
        ),
        centerX = Math.cos(angle) * radius,
        centerZ = Math.sin(angle) * radius,
        centerY = THREE.MathUtils.lerp(layer.baseM, layer.topM, random());
      for (let lobe = 0; lobe < layer.lobes; lobe++) {
        const lobeAngle = random() * Math.PI * 2,
          spread = layer.horizontalScaleM * (0.15 + random() * 0.7),
          scale = layer.horizontalScaleM * (0.42 + random() * 0.7),
          cirrus = layer.id === "cirrus";
        transform.position.set(
          centerX + Math.cos(lobeAngle) * spread,
          THREE.MathUtils.clamp(
            centerY + (random() - 0.5) * (layer.topM - layer.baseM) * 0.36,
            layer.baseM,
            layer.topM,
          ),
          centerZ + Math.sin(lobeAngle) * spread,
        );
        transform.rotation.set(
          (random() - 0.5) * 0.16,
          random() * Math.PI,
          (random() - 0.5) * 0.1,
        );
        transform.scale.set(
          scale * (cirrus ? 2.8 : 1.15),
          scale * (cirrus ? 0.12 : 0.48),
          scale * (cirrus ? 0.42 : 0.92),
        );
        transform.updateMatrix();
        instances.setMatrixAt(instance, transform.matrix);
        instance++;
      }
    }
    instances.instanceMatrix.needsUpdate = true;
    instances.name = `${layer.id} cloud field · ${layer.baseM}-${layer.topM} m`;
    instances.renderOrder = -2;
    horizonEnvironment.add(instances);
    cloudMeshes.push({ mesh: instances, material, layer });
  }
  return { root: horizonEnvironment, clouds: cloudMeshes };
}
