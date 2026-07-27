import * as THREE from "three";
import { componentVisualDescriptor } from "./component-visual-descriptor.js";
import { projectCanonicalComponentGeometry } from "./canonical-component-geometry-projector.js";
import { buildDecoration } from "./component-visual-builders/decoration-builders.js";
import { mats } from "./mesh-primitives.js";

function appearanceResolver(accent) {
  return ({ materialKey }) => {
    if (materialKey === "tire-rubber") return mats.rubber;
    if (
      materialKey === "steel" ||
      materialKey === "workshop-steel" ||
      materialKey === "workshop-aluminum"
    )
      return mats.steel;
    if (materialKey === "copper" || materialKey === "brass") return mats.brass;
    return accent;
  };
}

/**
 * Builds either an authored component instance or an explicit catalog preview.
 * Authored callers pass the complete part so scale/config/mechanism geometry is
 * resolved once in the model and never reapplied to the rendered root.
 */
export function componentMesh(partOrType, customColor) {
  const visualDescriptor = componentVisualDescriptor(partOrType, customColor),
    g = new THREE.Group(),
    accent = new THREE.MeshStandardMaterial({
      color: visualDescriptor.color,
      metalness: 0.7,
      roughness: 0.24,
    });
  projectCanonicalComponentGeometry({
    g,
    geometryDescriptor: visualDescriptor.geometry,
    appearanceResolver: appearanceResolver(accent),
    detailPolicy: {
      radialSegments: 28,
      flexibleRadialSegments: 8,
    },
  });
  buildDecoration({
    g,
    visualDescriptor,
    decorationContext: Object.freeze({
      portFrames: visualDescriptor.geometry.portFrames,
      bodyBoundsPartM: visualDescriptor.geometry.bodyBoundsPartM,
      featureBoundsPartM: visualDescriptor.geometry.featureBoundsPartM,
    }),
  });
  g.scale.set(1, 1, 1);
  g.userData.geometryDescriptor = visualDescriptor.geometry;
  g.userData.visualDescriptor = visualDescriptor;
  g.userData.renderResourceOwnership = "object3d-tree-v1";
  return g;
}
