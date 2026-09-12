import * as THREE from 'three';

// Surface printing only: the original body and shaft own every physical boundary.
// No animation or operational reading is inferred by these manufacturing finishes.
const CLEAR = [0, 0, 0, 0];
const INK = [49, 61, 68, 255];
const METAL = [157, 171, 179, 255];
const ACCENT = [221, 174, 96, 255];
const SIZE = 256;

function faceTexture(sample) {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++)
      pixels.set(
        sample(((x + 0.5) / SIZE) * 2 - 1, ((y + 0.5) / SIZE) * 2 - 1),
        (y * SIZE + x) * 4,
      );
  const texture = new THREE.DataTexture(pixels, SIZE, SIZE);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function ring(r, center, width) {
  return Math.abs(r - center) < width;
}

function sideFinish(servo) {
  return (u, v) => {
    // Closed end-cover seams and printed ribs, never cut-out ventilation holes.
    if (Math.abs(v) > 0.86 || Math.abs(u) > 0.9) return METAL;
    if (Math.abs(u - (servo ? 0.62 : 0.46)) < 0.025) return INK;
    if (u < (servo ? 0.44 : 0.28) && Math.abs(v) < 0.65) {
      if (Math.abs((((v + 1) * 7) % 1) - 0.5) < 0.09) return METAL;
    }
    if (u > 0.65 && Math.abs(v) < 0.5) return servo ? ACCENT : INK;
    return CLEAR;
  };
}

function endFinish(u, v) {
  const r = Math.hypot(u, v);
  // A flush bearing-cover finish around the existing shaft; the centre is solid.
  if (ring(r, 0.57, 0.065) || ring(r, 0.76, 0.018)) return METAL;
  if (Math.max(Math.abs(u), Math.abs(v)) > 0.9) return INK;
  return CLEAR;
}

function seatFinish(carriage) {
  return (u, v) => {
    const r = Math.hypot(u, v);
    if (ring(r, carriage ? 0.51 : 0.57, 0.045)) return METAL;
    if (ring(r, carriage ? 0.64 : 0.72, 0.025)) return INK;
    // Guide has a fixed crosswise seat mark; carriage has paired travel chevrons.
    if (!carriage && Math.abs(v) > 0.82 && Math.abs(v) < 0.9 && Math.abs(u) < 0.72) return ACCENT;
    if (carriage && Math.abs(u) > 0.76 && Math.abs(u) < 0.88 && Math.abs(v) < 0.64) return ACCENT;
    return CLEAR;
  };
}

function wheelFinish(u, v) {
  const r = Math.hypot(u, v);
  // Paint zones on the solid sidewall, not an independent metal insert or a bore.
  if (r < 0.31) return METAL;
  if (ring(r, 0.34, 0.025)) return INK;
  if (ring(r, 0.78, 0.017) || ring(r, 0.89, 0.008)) return METAL;
  // One asymmetric mark follows the parent's actual wheel transform.
  if (Math.hypot(u, v - 0.62) < 0.06) return ACCENT;
  return CLEAR;
}

// Printed powered-slide identifier around the shared central Slide/Power socket.
// This is a flat emblem, not a rail, opening or moving actuator housing.
function poweredSlideFinish(u, v) {
  if (Math.hypot(u, v) < 0.2) return CLEAR;
  if (Math.max(Math.abs(u), Math.abs(v)) > 0.89) return METAL;
  const x = Math.abs(u);
  if (x > 0.38 && x < 0.82) {
    if (Math.abs(Math.abs(v) - 0.57) < 0.025) return INK;
    // Two mirrored lightning marks distinguish powered drive from a spring seat.
    if (v > -0.4 && v < 0.4 && Math.abs(x - (0.6 - v * 0.28)) < 0.035) return ACCENT;
    if (Math.abs(v) < 0.035 && x > 0.48 && x < 0.72) return ACCENT;
  }
  return CLEAR;
}

export function createMechanicalDetails({ type, halfExtents, parameters }) {
  if (
    ![
      'poweredMotor',
      'poweredHinge',
      'springGuide',
      'springCarriage',
      'gripWheel',
      'linearActuator',
    ].includes(type)
  )
    return null;
  const [hx, hy, hz] = halfExtents;
  const group = new THREE.Group();
  group.name = 'mechanical-surface-finishes';
  function add(name, geometry, position, normal, sample) {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        map: faceTexture(sample),
        transparent: true,
        alphaTest: 0.05,
        roughness: 0.6,
        metalness: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    mesh.name = name;
    mesh.position.fromArray(position);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal));
    mesh.raycast = () => {};
    group.add(mesh);
  }
  if (type === 'poweredMotor' || type === 'poweredHinge') {
    const servo = type === 'poweredHinge';
    for (const sign of [-1, 1])
      add(
        'housing-cover',
        new THREE.PlaneGeometry(hx * 1.96, hy * 1.96),
        [0, 0, sign * (hz + 0.0004)],
        [0, 0, sign],
        sideFinish(servo),
      );
    if (servo)
      add(
        'output-cover',
        new THREE.PlaneGeometry(hx * 1.96, hz * 1.96),
        [0, hy + 0.0004, 0],
        [0, 1, 0],
        endFinish,
      );
    else
      add(
        'output-cover',
        new THREE.PlaneGeometry(hz * 1.96, hy * 1.96),
        [hx + 0.0004, 0, 0],
        [1, 0, 0],
        endFinish,
      );
  } else if (type === 'linearActuator') {
    add(
      'powered-slide-mark',
      new THREE.PlaneGeometry(hx * 1.96, hz * 1.96),
      [0, hy + 0.0004, 0],
      [0, 1, 0],
      poweredSlideFinish,
    );
  } else if (type === 'gripWheel') {
    // Dimensions are already resolved by the canonical primitive owner, including diameter.
    const radius = Math.min(hy, hz) * 0.97;
    for (const sign of [-1, 1])
      add(
        'wheel-sidewall',
        new THREE.CircleGeometry(radius, 48),
        [sign * (hx + 0.0004), 0, 0],
        [sign, 0, 0],
        wheelFinish,
      );
  } else {
    const carriage = type === 'springCarriage';
    const sign = carriage ? -1 : 1;
    add(
      carriage ? 'moving-spring-seat' : 'fixed-spring-seat',
      new THREE.PlaneGeometry(hx * 1.96, hz * 1.96),
      [0, sign * (hy + 0.0004), 0],
      [0, sign, 0],
      seatFinish(carriage),
    );
  }
  return group;
}
