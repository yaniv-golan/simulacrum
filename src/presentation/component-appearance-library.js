import * as THREE from "three";
import { mats, sharedSurfaceTextures } from "./mesh-primitives.js";
import { trackOwnedRenderResource } from "./render-resources.js";

const MATERIAL_PROFILES = Object.freeze({
  "tire-rubber": "rubber",
  "workshop-aluminum": "aluminum",
  "workshop-steel": "steel",
  steel: "steel",
  "nylon-rope": "nylon",
});

/** Resolves only canonical appearance inputs; component type is never dispatch. */
export function componentAppearanceProfile({
  materialKey,
  semanticKey,
  role,
  customColor,
  aerothermal,
}) {
  if (aerothermal?.material?.ablative === true) return "ablative";
  if (semanticKey === "rotor-blade" && customColor == null) return "composite";
  if (MATERIAL_PROFILES[materialKey]) return MATERIAL_PROFILES[materialKey];
  if (materialKey === "generic-structure") return "paint";
  throw new Error(
    `Unsupported component appearance ${String(materialKey)}:${String(semanticKey)}:${String(role)}`,
  );
}

function createPaintMaterial(color) {
  const material = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.58,
    roughness: 0.38,
    roughnessMap: sharedSurfaceTextures.microRoughness,
  });
  material.name = `component-paint-${color.toString(16).padStart(6, "0")}`;
  return trackOwnedRenderResource(material, "componentColorMaterials");
}

/** Creates a bounded resolver: shared catalog finishes plus one lazy paint material. */
export function createComponentAppearanceResolver(visualDescriptor) {
  let paintMaterial = null;
  return (appearance) => {
    const profile = componentAppearanceProfile({
      ...appearance,
      customColor: visualDescriptor.customColor,
      aerothermal: visualDescriptor.geometry.aerothermal,
    });
    if (profile !== "paint") return mats[profile];
    paintMaterial ||= createPaintMaterial(visualDescriptor.color);
    return paintMaterial;
  };
}
