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
  light.castShadow = false;
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
    },
    dispose() {
      lens.geometry.dispose();
      lens.material.dispose();
      light.dispose();
    },
  };
}
