import * as THREE from "three";

function seeded(index, salt) {
  const value = Math.sin(index * 91.17 + salt * 17.31) * 43758.5453;
  return value - Math.floor(value);
}

/** Visual and procedural-audio consequences derived from physical failure energy. */
export class FailureEffects {
  constructor({ parent }) {
    this.parent = parent;
    this.active = [];
    this.audioContext = null;
    this.totalTriggered = 0;
  }

  trigger(event) {
    this.totalTriggered++;
    const origin = new THREE.Vector3(
        event.worldPosition.x,
        event.worldPosition.y,
        event.worldPosition.z,
      ),
      water = event.environment?.inWater,
      thermal = event.mode === "thermal",
      impact = event.mode === "impact",
      utilization = Math.max(1, event.load?.utilization || event.severity || 1),
      count = Math.min(120, Math.round(28 + utilization * 18)),
      color = water
        ? 0x7ff5ef
        : thermal
          ? 0xff6a2a
          : impact
            ? 0xe8c28b
            : 0xffbd45,
      geometry = new THREE.BufferGeometry(),
      positions = new Float32Array(count * 3),
      velocities = [];
    for (let index = 0; index < count; index++) {
      positions[index * 3] = origin.x;
      positions[index * 3 + 1] = origin.y;
      positions[index * 3 + 2] = origin.z;
      const azimuth = seeded(index, 1) * Math.PI * 2,
        upward = water
          ? 1.5 + seeded(index, 2) * 3
          : 0.4 + seeded(index, 2) * 2.4,
        radial =
          (0.8 + seeded(index, 3) * 3.2) *
          Math.min(2.5, Math.sqrt(utilization));
      velocities.push(
        new THREE.Vector3(
          Math.cos(azimuth) * radial,
          upward,
          Math.sin(azimuth) * radial,
        ),
      );
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
        color,
        size: thermal ? 0.18 : water ? 0.1 : 0.075,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: thermal ? THREE.NormalBlending : THREE.AdditiveBlending,
      }),
      points = new THREE.Points(geometry, material);
    points.renderOrder = 80;
    this.parent.add(points);
    this.active.push({
      kind: "particles",
      object: points,
      velocities,
      age: 0,
      life: thermal ? 2.4 : water ? 1.4 : 0.85,
      gravity: thermal ? -0.25 : water ? 6.5 : 9.8,
      drag: thermal ? 1.1 : 0.6,
    });

    const ringMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      ring = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.23, 48),
        ringMaterial,
      );
    ring.position.copy(origin);
    ring.rotation.x = -Math.PI / 2;
    this.parent.add(ring);
    this.active.push({
      kind: "ring",
      object: ring,
      age: 0,
      life: 0.55,
      expansion: 2.8 * Math.min(2.2, Math.sqrt(utilization)),
    });
    this.playImpactSound(event).catch(() => {});
  }

  async playImpactSound(event) {
    const AudioContext =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return;
    this.audioContext ||= new AudioContext();
    if (this.audioContext.state === "suspended")
      await this.audioContext.resume();
    const duration = 0.16,
      sampleRate = this.audioContext.sampleRate,
      buffer = this.audioContext.createBuffer(
        1,
        sampleRate * duration,
        sampleRate,
      ),
      data = buffer.getChannelData(0),
      severity = Math.min(1, 0.25 + (event.severity || 1) * 0.18);
    for (let index = 0; index < data.length; index++) {
      const envelope = Math.exp((-index / data.length) * 8);
      data[index] = (seeded(index, event.timeS || 1) * 2 - 1) * envelope;
    }
    const source = this.audioContext.createBufferSource(),
      filter = this.audioContext.createBiquadFilter(),
      gain = this.audioContext.createGain();
    filter.type = "lowpass";
    filter.frequency.value = event.mode === "impact" ? 420 : 1100;
    gain.gain.value = 0.12 * severity;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.audioContext.destination);
    source.start();
  }

  update(dt) {
    for (let index = this.active.length - 1; index >= 0; index--) {
      const effect = this.active[index];
      effect.age += dt;
      const progress = effect.age / effect.life;
      if (effect.kind === "particles") {
        const attribute = effect.object.geometry.getAttribute("position");
        for (
          let particle = 0;
          particle < effect.velocities.length;
          particle++
        ) {
          const velocity = effect.velocities[particle],
            drag = Math.exp(-effect.drag * dt);
          velocity.multiplyScalar(drag);
          velocity.y -= effect.gravity * dt;
          attribute.array[particle * 3] += velocity.x * dt;
          attribute.array[particle * 3 + 1] += velocity.y * dt;
          attribute.array[particle * 3 + 2] += velocity.z * dt;
        }
        attribute.needsUpdate = true;
        effect.object.material.opacity = Math.max(0, 1 - progress);
      } else {
        const scale = 1 + effect.expansion * effect.age;
        effect.object.scale.setScalar(scale);
        effect.object.material.opacity = Math.max(0, 0.8 * (1 - progress));
      }
      if (progress < 1) continue;
      this.parent.remove(effect.object);
      effect.object.geometry?.dispose();
      effect.object.material?.dispose();
      this.active.splice(index, 1);
    }
  }

  clear() {
    for (const effect of this.active) {
      this.parent.remove(effect.object);
      effect.object.geometry?.dispose();
      effect.object.material?.dispose();
    }
    this.active.length = 0;
    this.totalTriggered = 0;
  }

  snapshot() {
    return {
      activeEffects: this.active.length,
      triggeredEvents: this.totalTriggered,
    };
  }
}
