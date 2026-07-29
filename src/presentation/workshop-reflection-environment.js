import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { markSharedRenderResource } from "./render-resources.js";

/** Creates one procedural, offline reflection map owned by the workshop scene. */
export function createWorkshopReflectionEnvironment({ scene, renderer }) {
  const source = new RoomEnvironment(),
    generator = new THREE.PMREMGenerator(renderer),
    target = generator.fromScene(source, 0.04, 0.1, 100),
    texture = markSharedRenderResource(target.texture);
  texture.name = "workshop-procedural-reflection-v1";
  scene.environment = texture;
  source.dispose();
  generator.dispose();

  let daylight = 1,
    spaceBlend = 0,
    performanceMode = false;
  function setLighting(nextDaylight, nextSpaceBlend) {
    daylight = THREE.MathUtils.clamp(Number(nextDaylight), 0, 1);
    spaceBlend = THREE.MathUtils.clamp(Number(nextSpaceBlend), 0, 1);
    scene.environmentIntensity = THREE.MathUtils.lerp(
      0.16 + daylight * 0.34,
      0.08,
      spaceBlend,
    );
  }
  setLighting(daylight, spaceBlend);

  function setPerformanceMode(reduced) {
    performanceMode = Boolean(reduced);
    scene.environment = performanceMode ? null : texture;
  }

  return Object.freeze({
    setLighting,
    setPerformanceMode,
    snapshot: () => ({
      kind: "procedural-pmrem-v1",
      daylight,
      spaceBlend,
      intensity: scene.environmentIntensity,
      active: !performanceMode,
    }),
    dispose() {
      if (scene.environment === texture) scene.environment = null;
      target.dispose();
    },
  });
}
