import * as THREE from "three";

const MAX_MARKS = 192,
  MAX_PARTICLES = 96,
  MARK_SPACING_M = 0.32,
  SOFT_MATERIALS = new Set([
    "compacted-soil",
    "short-grass",
    "loose-gravel",
    "dry-sand",
    "saturated-mud",
  ]),
  DUST_MATERIALS = new Set([
    "compacted-soil",
    "short-grass",
    "loose-gravel",
    "dry-sand",
  ]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function firstSupportMaterial(wheel) {
  return (
    wheel.supportMaterialKeys?.[0] || wheel.contactMaterialKeys?.[0] || null
  );
}

/** Maps authoritative contact telemetry to an optional presentation effect. */
export function testSiteContactEffectKind(wheel, speedMps) {
  if (!wheel?.touching) return Object.freeze({ mark: null, particle: null });
  const materialKey = firstSupportMaterial(wheel),
    speed = Math.abs(finite(speedMps)),
    slip = Math.hypot(
      finite(wheel.longitudinalSlipMPerS),
      finite(wheel.lateralSlipMPerS),
    ),
    utilization = finite(wheel.frictionEllipseUtilization),
    sinking = finite(wheel.surfaceSinkageM) >= 0.004,
    skidding = slip >= 0.45 || utilization >= 0.78,
    wet = wheel.inPond || materialKey === "wet-asphalt";
  return Object.freeze({
    mark: wet
      ? "wet-track"
      : sinking && SOFT_MATERIALS.has(materialKey)
        ? "rut"
        : skidding
          ? "skid"
          : null,
    particle:
      wet && speed >= 0.5
        ? "spray"
        : DUST_MATERIALS.has(materialKey) && speed >= 1 && (skidding || sinking)
          ? "dust"
          : null,
  });
}

function makeMaterials() {
  const material = (color, opacity) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
  return Object.freeze({
    skid: material(0x111413, 0.56),
    rut: material(0x38291b, 0.48),
    "wet-track": material(0x89b9c6, 0.3),
    dust: material(0xbba47c, 0.72),
    spray: material(0xcdefff, 0.78),
  });
}

function deterministicScatter(seed) {
  return {
    x: Math.sin(seed * 12.9898) * 0.14,
    y: 0.09 + Math.abs(Math.sin(seed * 4.1414)) * 0.18,
    z: Math.cos(seed * 7.233) * 0.14,
  };
}

/**
 * Renders bounded, telemetry-driven Test Reserve contact detail. It never feeds
 * simulation state and reuses a fixed pool of Three.js objects.
 */
export function createTestSiteContactEffects({
  parent,
  partById,
  reducedMotion = () =>
    Boolean(
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    ),
}) {
  const root = new THREE.Group(),
    markGeometry = new THREE.PlaneGeometry(0.24, 0.72),
    particleGeometry = new THREE.SphereGeometry(0.055, 5, 4),
    materials = makeMaterials(),
    marks = Array.from({ length: MAX_MARKS }, () => {
      const mesh = new THREE.Mesh(markGeometry, materials.skid);
      mesh.rotation.order = "YXZ";
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 2;
      root.add(mesh);
      return mesh;
    }),
    particles = Array.from({ length: MAX_PARTICLES }, () => {
      const mesh = new THREE.Mesh(particleGeometry, materials.dust);
      mesh.visible = false;
      mesh.userData.lifeS = 0;
      root.add(mesh);
      return mesh;
    }),
    lastMarkByPart = new Map(),
    lastParticleAtByPart = new Map(),
    worldPosition = new THREE.Vector3(),
    worldQuaternion = new THREE.Quaternion(),
    forward = new THREE.Vector3();
  let markCursor = 0,
    particleCursor = 0,
    lastTimeS = null;
  root.name = "test-site-contact-effects";
  parent.add(root);

  function updateParticles(timeS) {
    const dt = Math.min(0.1, Math.max(0, timeS - (lastTimeS ?? timeS)));
    lastTimeS = timeS;
    if (!dt) return;
    for (const particle of particles) {
      if (!particle.visible) continue;
      particle.userData.lifeS -= dt;
      if (particle.userData.lifeS <= 0) {
        particle.visible = false;
        continue;
      }
      particle.position.addScaledVector(particle.userData.velocity, dt);
      particle.userData.velocity.y -= 1.8 * dt;
      particle.scale.multiplyScalar(Math.max(0.86, 1 - dt * 0.8));
    }
  }

  function emitMark(kind, wheel, position, heading) {
    const previous = lastMarkByPart.get(wheel.partId);
    if (
      previous &&
      Math.hypot(position.x - previous.x, position.z - previous.z) <
        MARK_SPACING_M
    )
      return;
    lastMarkByPart.set(wheel.partId, { x: position.x, z: position.z });
    const mark = marks[markCursor++ % marks.length];
    mark.material = materials[kind];
    mark.position.set(position.x, finite(wheel.groundY) + 0.026, position.z);
    mark.rotation.set(-Math.PI / 2, heading, 0);
    const sinkScale = 1 + Math.min(0.7, finite(wheel.surfaceSinkageM) * 6);
    mark.scale.set(sinkScale, sinkScale, sinkScale);
    mark.visible = true;
  }

  function emitParticle(kind, wheel, position, speedMps, timeS) {
    const previousTime = lastParticleAtByPart.get(wheel.partId) ?? -Infinity;
    if (timeS - previousTime < 0.08) return;
    lastParticleAtByPart.set(wheel.partId, timeS);
    const particle = particles[particleCursor++ % particles.length],
      scatter = deterministicScatter(particleCursor + wheel.partId * 17),
      lifeS = kind === "spray" ? 0.55 : 0.8;
    particle.material = materials[kind];
    particle.position.set(
      position.x + scatter.x,
      finite(wheel.groundY) + scatter.y,
      position.z + scatter.z,
    );
    particle.scale.setScalar(kind === "spray" ? 1 : 1.35);
    particle.userData.lifeS = lifeS;
    particle.userData.velocity = new THREE.Vector3(
      scatter.x * 4,
      kind === "spray" ? 1.1 + Math.abs(speedMps) * 0.08 : 0.45,
      scatter.z * 4,
    );
    particle.visible = true;
  }

  function present(snapshot) {
    const timeS = finite(snapshot?.time);
    updateParticles(timeS);
    const allowParticles = !reducedMotion();
    for (const assembly of snapshot?.systems?.mobility?.assemblies || []) {
      for (const wheel of assembly.wheelStates || []) {
        const part = partById(wheel.partId);
        if (!part?.mesh) continue;
        const kind = testSiteContactEffectKind(wheel, assembly.signedSpeed);
        if (!kind.mark && !kind.particle) continue;
        part.mesh.getWorldPosition(worldPosition);
        part.mesh.getWorldQuaternion(worldQuaternion);
        forward.set(0, 0, 1).applyQuaternion(worldQuaternion);
        const heading = Math.atan2(forward.x, forward.z);
        if (kind.mark) emitMark(kind.mark, wheel, worldPosition, heading);
        if (kind.particle && allowParticles)
          emitParticle(
            kind.particle,
            wheel,
            worldPosition,
            assembly.signedSpeed,
            timeS,
          );
      }
    }
  }

  function clear() {
    lastMarkByPart.clear();
    lastParticleAtByPart.clear();
    lastTimeS = null;
    for (const mark of marks) mark.visible = false;
    for (const particle of particles) {
      particle.visible = false;
      particle.userData.lifeS = 0;
    }
  }

  function snapshot() {
    return Object.freeze({
      capacity: Object.freeze({ marks: MAX_MARKS, particles: MAX_PARTICLES }),
      visibleMarks: marks.filter(({ visible }) => visible).length,
      visibleParticles: particles.filter(({ visible }) => visible).length,
    });
  }

  return Object.freeze({ clear, present, snapshot });
}
