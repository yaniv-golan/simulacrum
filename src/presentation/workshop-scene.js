import * as THREE from "three";
import { createWorkshopReflectionEnvironment } from "./workshop-reflection-environment.js";

export { createWorkshopPlatform } from "./workshop-platform.js";
export { createTransformGizmoController } from "./transform-gizmo-controller.js";

/**
 * Owns the renderer, camera, scene, and primary lighting presentation graph.
 * @param {{ stage?: HTMLElement, width?: number, height?: number, pixelRatio?: number }} [options]
 */
export function createWorkshopScene({
  stage,
  width = globalThis.innerWidth,
  height = globalThis.innerHeight,
  pixelRatio = globalThis.devicePixelRatio,
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ac7d2);
  scene.fog = new THREE.FogExp2(0x9ac7d2, 0.000045);
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.25, 150000),
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      logarithmicDepthBuffer: true,
    });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(pixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "region");
  renderer.domElement.setAttribute(
    "aria-label",
    "3D construction workspace. Use the visible workshop controls or keyboard shortcuts to edit and inspect the machine.",
  );
  stage?.append(renderer.domElement);
  const reflectionEnvironment = createWorkshopReflectionEnvironment({
    scene,
    renderer,
  });

  const hemisphere = new THREE.HemisphereLight(0xeaf9ff, 0x32483e, 2.4),
    ambientFill = new THREE.AmbientLight(0x88a6ca, 0.34),
    sun = new THREE.DirectionalLight(0xfff1cf, 4.2),
    moonLight = new THREE.DirectionalLight(0x93ace0, 0.35);
  sun.position.set(-25, 40, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 30,
    bottom: -30,
  });
  moonLight.position.set(30, 45, -35);
  scene.add(hemisphere, ambientFill, sun, sun.target, moonLight);
  return {
    scene,
    camera,
    renderer,
    hemisphere,
    ambientFill,
    sun,
    moonLight,
    reflectionEnvironment,
  };
}
