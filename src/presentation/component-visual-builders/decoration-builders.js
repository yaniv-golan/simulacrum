import * as THREE from "three";
import { trackOwnedRenderResource } from "../render-resources.js";

function addHeadlightDecoration({ g, visualDescriptor, detailPolicy }) {
  const glowMaterial = trackOwnedRenderResource(
      new THREE.MeshStandardMaterial({
        color: 0xffe8ae,
        emissive: 0xffb22e,
        emissiveIntensity: 0.08,
        metalness: 0.12,
        roughness: 0.16,
      }),
      "componentDecorationMaterials",
    ),
    glow = new THREE.Mesh(
      new THREE.CircleGeometry(
        0.145,
        Math.max(12, Number(detailPolicy.radialSegments || 24)),
      ),
      glowMaterial,
    ),
    light = new THREE.SpotLight(0xffd8a3, 0, 30, Math.PI / 8, 0.55, 2),
    target = new THREE.Object3D();
  glow.position.set(0, 0, -0.171);
  glow.rotation.y = Math.PI;
  glow.userData.decorativeGeometry = true;
  glow.userData.headlightBulb = true;
  glow.castShadow = detailPolicy.castShadow !== false;
  glow.receiveShadow = detailPolicy.receiveShadow !== false;
  light.position.set(0, 0, -0.2);
  target.position.set(0, -0.45, -11.5);
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
  g.add(glow, light, target);
}

const DECORATION_BUILDERS = new Map([["headlight", addHeadlightDecoration]]);

/** Adds classified non-physical trim without touching canonical roots. */
export function buildDecoration({
  g,
  visualDescriptor,
  detailPolicy = {},
  decorationContext: _decorationContext,
}) {
  DECORATION_BUILDERS.get(visualDescriptor.type)?.({
    g,
    visualDescriptor,
    detailPolicy,
  });
}
