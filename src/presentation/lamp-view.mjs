import * as THREE from 'three';
/** Illustrative scene intensity scale, independent of model luminous flux. */
export const LAMP_DISPLAY_SCALE = 0.01;
/** Completed optical values only. No electrical or control decisions live here. */
export function createLampView() {
  const group = new THREE.Group();
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.038, 24),
    new THREE.MeshStandardMaterial({
      color: 0x999999,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 0.3,
    }),
  );
  lens.position.z = 0.0402;
  const light = new THREE.SpotLight(0xffffff, 0, 12, 0.52, 0, 2);
  light.position.set(0, 0, 0.045);
  // Shadow casting is a presentation budget applied through applyShadowBudget; the
  // graphics level owns it, never the lamp's telemetry. Three derives the shadow
  // camera's fov and far from the cone; its default 0.5 m near plane would clip every
  // nearby part, so the near plane is set once here.
  light.castShadow = false;
  light.shadow.camera.near = 0.02;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.normalBias = 0.01;
  // A lamp that emits nothing shadows nothing: skip its depth pass until it is lit.
  light.shadow.autoUpdate = false;
  const target = new THREE.Object3D();
  target.position.z = 1;
  light.target = target;
  group.add(lens, light, target);
  return {
    group,
    lens,
    light,
    update(completed) {
      const flux = completed?.luminousFluxLm ?? 0;
      const angle = completed?.beamSpread ?? 0.52;
      const color = completed?.color ?? 0xffffff;
      light.color.setHex(color);
      lens.material.emissive.setHex(color);
      light.angle = angle;
      // Hard-cone angular integral is 2pi(1-cos theta); Three.power uses a fixed pi.
      light.intensity = (flux * LAMP_DISPLAY_SCALE) / (2 * Math.PI * (1 - Math.cos(angle)));
      lens.material.emissiveIntensity = flux / 250;
      group.userData.lampFlux = flux;
      light.shadow.autoUpdate = light.intensity > 0 && color !== 0;
    },
    /** Presentation budget: size 0 disables casting. Releases any previous depth target
     * and, while casting, requests exactly one reallocation pass regardless of lit state. */
    applyShadowBudget(size) {
      const shadow = light.shadow;
      const cast = size > 0;
      const changed = cast !== light.castShadow || (cast && shadow.mapSize.width !== size);
      if (!changed) return false;
      light.castShadow = cast;
      if (cast) shadow.mapSize.set(size, size);
      shadow.dispose();
      shadow.map = null;
      shadow.mapPass = null;
      if (cast) shadow.needsUpdate = true;
      return true;
    },
    dispose() {
      lens.geometry.dispose();
      lens.material.dispose();
      light.dispose();
    },
  };
}
