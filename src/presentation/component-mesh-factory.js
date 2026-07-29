import * as THREE from "three";
import { componentVisualDescriptor } from "./component-visual-descriptor.js";
import { createComponentAppearanceResolver } from "./component-appearance-library.js";
import { COMPONENT_DETAIL_TIERS } from "./component-detail-policy.js";
import { projectCanonicalComponentGeometry } from "./canonical-component-geometry-projector.js";
import { buildDecoration } from "./component-visual-builders/decoration-builders.js";
import { disposeObject3D } from "./render-resources.js";

const VISUAL_USER_DATA_KEYS = Object.freeze([
  "flexibleLineVisual",
  "geometryProjection",
  "mechanismDeformationRoot",
  "mechanismDeformationRoots",
]);

function clearVisualChildren(g) {
  disposeObject3D(g, { remove: false });
  g.clear();
  for (const key of VISUAL_USER_DATA_KEYS) delete g.userData[key];
}

export function rebuildComponentVisual(g, detailTier = "standard") {
  const visualDescriptor = g.userData.visualDescriptor,
    detailPolicy = COMPONENT_DETAIL_TIERS[detailTier];
  if (!visualDescriptor)
    throw new Error("Component visual root has no immutable descriptor");
  if (!detailPolicy)
    throw new Error(`Unknown component detail tier ${String(detailTier)}`);
  clearVisualChildren(g);
  projectCanonicalComponentGeometry({
    g,
    geometryDescriptor: visualDescriptor.geometry,
    appearanceResolver: createComponentAppearanceResolver(visualDescriptor),
    detailPolicy,
  });
  buildDecoration({
    g,
    visualDescriptor,
    detailPolicy,
    decorationContext: Object.freeze({
      portFrames: visualDescriptor.geometry.portFrames,
      bodyBoundsPartM: visualDescriptor.geometry.bodyBoundsPartM,
      featureBoundsPartM: visualDescriptor.geometry.featureBoundsPartM,
    }),
  });
  g.userData.visualDetailTier = detailTier;
  const partId = g.userData.partId;
  if (partId != null) g.traverse((object) => (object.userData.partId = partId));
  return g;
}

/**
 * Builds either an authored component instance or an explicit catalog preview.
 * Authored callers pass the complete part so scale/config/mechanism geometry is
 * resolved once in the model and never reapplied to the rendered root.
 */
export function componentMesh(
  partOrType,
  customColor,
  detailTier = "standard",
) {
  const visualDescriptor = componentVisualDescriptor(partOrType, customColor),
    g = new THREE.Group();
  g.scale.set(1, 1, 1);
  g.userData.geometryDescriptor = visualDescriptor.geometry;
  g.userData.visualDescriptor = visualDescriptor;
  g.userData.renderResourceOwnership = "object3d-tree-v1";
  return rebuildComponentVisual(g, detailTier);
}
