import * as THREE from "three";

const STAR_COUNT = 1800;
const STAR_SEED = 8675309;

function createSeededRandom(seed = STAR_SEED) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createStars(random) {
  const positions = [];
  for (let index = 0; index < STAR_COUNT; index++) {
    const y = random() * 2 - 1,
      angle = random() * Math.PI * 2,
      radius = 300 + random() * 170,
      horizontal = Math.sqrt(1 - y * y);
    positions.push(
      Math.cos(angle) * horizontal * radius,
      y * radius,
      Math.sin(angle) * horizontal * radius,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const material = new THREE.PointsMaterial({
      color: 0xf4f7ff,
      size: 1.7,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    }),
    stars = new THREE.Points(geometry, material);
  stars.renderOrder = -10;
  return { stars, starMaterial: material };
}

function createMoon() {
  const material = new THREE.MeshStandardMaterial({
      color: 0xc8c7bf,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0,
      fog: false,
    }),
    moon = new THREE.Mesh(new THREE.SphereGeometry(1.35, 48, 32), material);
  moon.name = "Moon — 384,400 km physical distance";
  moon.receiveShadow = true;
  for (const [x, y, z, radius] of [
    [-0.55, 0.38, 1.12, 0.2],
    [0.42, 0.62, 1.05, 0.13],
    [0.58, -0.36, 1.06, 0.24],
    [-0.18, -0.52, 1.22, 0.11],
  ]) {
    const crater = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 20),
      new THREE.MeshBasicMaterial({
        color: 0x7e807d,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        fog: false,
      }),
    );
    crater.position.set(x, y, z);
    moon.add(crater);
  }
  return { moon, moonMaterial: material };
}

function createEarthTexture(landPolygons) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d"),
    ocean = context.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, "#176fb2");
  ocean.addColorStop(0.5, "#0c5595");
  ocean.addColorStop(1, "#083e74");
  context.fillStyle = ocean;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#57834b";
  for (const polygon of landPolygons) {
    context.beginPath();
    for (const ring of polygon) {
      let previousX = null;
      for (const [longitude, latitude] of ring) {
        const x = ((longitude + 180) / 360) * canvas.width,
          y = ((90 - latitude) / 180) * canvas.height;
        if (previousX == null || Math.abs(x - previousX) > canvas.width / 2)
          context.moveTo(x, y);
        else context.lineTo(x, y);
        previousX = x;
      }
      context.closePath();
    }
    context.fill("evenodd");
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createEarth(landPolygons) {
  const earthMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createEarthTexture(landPolygons),
      transparent: true,
      opacity: 0,
      fog: false,
    }),
    earthLimb = new THREE.Mesh(
      new THREE.SphereGeometry(255, 72, 40),
      earthMaterial,
    );
  earthLimb.position.set(0, -350, -55);
  const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x57c9ff,
      transparent: true,
      opacity: 0,
      side: THREE.FrontSide,
      depthWrite: false,
      fog: false,
    }),
    atmosphereShell = new THREE.Mesh(
      new THREE.SphereGeometry(260, 72, 40),
      atmosphereMaterial,
    );
  atmosphereShell.position.copy(earthLimb.position);
  return { earthLimb, earthMaterial, atmosphereShell, atmosphereMaterial };
}

function createMeteorite(position) {
  const material = new THREE.MeshStandardMaterial({
      color: 0x4d4945,
      roughness: 0.96,
      metalness: 0.18,
      emissive: 0x100d0a,
      emissiveIntensity: 0.4,
    }),
    meteorite = new THREE.Group(),
    core = new THREE.Mesh(new THREE.IcosahedronGeometry(12, 2), material);
  meteorite.name = "Kármán-line meteorite target";
  meteorite.position.copy(position);
  core.scale.set(1.15, 0.82, 0.96);
  core.rotation.set(0.4, 0.2, -0.3);
  core.castShadow = true;
  core.receiveShadow = true;
  meteorite.add(core);
  const targetRing = new THREE.Mesh(
    new THREE.TorusGeometry(17, 0.28, 10, 64),
    new THREE.MeshBasicMaterial({
      color: 0xffb957,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      fog: false,
    }),
  );
  meteorite.add(targetRing);
  return { meteorite, targetRing };
}

/**
 * Builds the precision-safe celestial render shell. Physical distances remain
 * owned by simulation telemetry; this module owns visual representation only.
 */
export function createCelestialEnvironment({
  scene,
  landPolygons,
  environmentBody,
}) {
  const root = new THREE.Group();
  root.name = "celestialEnvironment";
  const starFields = createStars(createSeededRandom()),
    moonFields = createMoon(),
    earthFields = createEarth(landPolygons),
    meteorFields = createMeteorite(environmentBody.pose.position);
  root.add(
    starFields.stars,
    moonFields.moon,
    earthFields.earthLimb,
    earthFields.atmosphereShell,
  );
  scene.add(root, meteorFields.meteorite);
  return Object.freeze({
    root,
    ...starFields,
    ...moonFields,
    ...earthFields,
    ...meteorFields,
  });
}
