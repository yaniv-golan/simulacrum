import * as THREE from "three";
import { mats } from "../mesh-primitives.js";
import {
  sharePrimitiveGeometry,
  trackOwnedRenderResource,
} from "../render-resources.js";

const DETAIL_RANK = Object.freeze({ performance: 0, standard: 1, hero: 2 });

function markRecipe(object, recipe) {
  object.userData.decorativeGeometry = true;
  object.userData.decorationRecipeId = recipe.id;
  object.userData.decorativeClassification = recipe.classification;
  object.userData.decorationAnchorSource = recipe.anchorSource;
  object.userData.decorationMaximumInstanceCount = recipe.maximumInstanceCount;
  object.userData.decorationMinimumTier = recipe.minimumTier;
  object.userData.renderResourceOwnership = "shared-geometry-material-v1";
  return object;
}

function boundsMetrics({ bodyBoundsPartM }) {
  if (!bodyBoundsPartM) return null;
  const sizeM = [0, 1, 2].map(
      (axis) => bodyBoundsPartM.maximumM[axis] - bodyBoundsPartM.minimumM[axis],
    ),
    center = [0, 1, 2].map(
      (axis) =>
        (bodyBoundsPartM.maximumM[axis] + bodyBoundsPartM.minimumM[axis]) / 2,
    );
  return { sizeM, center, bounds: bodyBoundsPartM };
}

function addFasteners({ g, detailPolicy, decorationContext, recipe }) {
  const metrics = boundsMetrics(decorationContext);
  if (!metrics) return;
  const [width, height] = metrics.sizeM,
    radiusM = Math.min(0.04, Math.max(0.012, Math.min(width, height) * 0.04)),
    depthM = Math.min(0.012, metrics.sizeM[2] * 0.04),
    geometry = sharePrimitiveGeometry(
      new THREE.CylinderGeometry(
        radiusM,
        radiusM,
        depthM,
        Math.max(8, Number(detailPolicy.radialSegments || 12)),
      ),
    ),
    fasteners = markRecipe(
      new THREE.InstancedMesh(geometry, mats.steel, 4),
      recipe,
    ),
    matrix = new THREE.Matrix4(),
    rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2,
    ),
    frontZ = metrics.bounds.maximumM[2] - depthM / 2,
    xOffset = Math.max(0, width / 2 - radiusM * 2.2),
    yOffset = Math.max(0, height / 2 - radiusM * 2.2);
  [
    [-xOffset, -yOffset],
    [xOffset, -yOffset],
    [xOffset, yOffset],
    [-xOffset, yOffset],
  ].forEach(([x, y], index) => {
    matrix.compose(
      new THREE.Vector3(metrics.center[0] + x, metrics.center[1] + y, frontZ),
      rotation,
      new THREE.Vector3(1, 1, 1),
    );
    fasteners.setMatrixAt(index, matrix);
  });
  fasteners.name = `Decoration ${recipe.id}`;
  fasteners.castShadow = detailPolicy.castShadow !== false;
  fasteners.receiveShadow = detailPolicy.receiveShadow !== false;
  g.add(fasteners);
}

function addVents({ g, detailPolicy, decorationContext, recipe }) {
  const metrics = boundsMetrics(decorationContext);
  if (!metrics) return;
  const [width, height, depth] = metrics.sizeM,
    slotWidthM = Math.min(width * 0.46, 0.34),
    slotHeightM = Math.min(height * 0.055, 0.025),
    slotDepthM = Math.min(depth * 0.02, 0.008),
    vents = markRecipe(
      new THREE.InstancedMesh(
        sharePrimitiveGeometry(
          new THREE.BoxGeometry(slotWidthM, slotHeightM, slotDepthM),
        ),
        mats.rubber,
        3,
      ),
      recipe,
    ),
    matrix = new THREE.Matrix4(),
    frontZ = metrics.bounds.maximumM[2] - slotDepthM / 2;
  for (let index = 0; index < 3; index++) {
    const y = metrics.center[1] + (index - 1) * slotHeightM * 2.2;
    matrix.makeTranslation(metrics.center[0], y, frontZ);
    vents.setMatrixAt(index, matrix);
  }
  vents.name = `Decoration ${recipe.id}`;
  vents.castShadow = false;
  vents.receiveShadow = detailPolicy.receiveShadow !== false;
  g.add(vents);
}

function addLabelPlate({ g, detailPolicy, decorationContext, recipe }) {
  const metrics = boundsMetrics(decorationContext);
  if (!metrics) return;
  const [width, height, depth] = metrics.sizeM,
    labelWidthM = Math.min(width * 0.42, 0.26),
    labelHeightM = Math.min(height * 0.16, 0.08),
    labelDepthM = Math.min(depth * 0.01, 0.004),
    label = markRecipe(
      new THREE.Mesh(
        sharePrimitiveGeometry(
          new THREE.BoxGeometry(labelWidthM, labelHeightM, labelDepthM),
        ),
        mats.aluminum,
      ),
      recipe,
    );
  label.name = `Decoration ${recipe.id}`;
  label.position.set(
    metrics.center[0],
    metrics.center[1] - height * 0.22,
    metrics.bounds.maximumM[2] - labelDepthM / 2,
  );
  label.castShadow = false;
  label.receiveShadow = detailPolicy.receiveShadow !== false;
  g.add(label);
}

function addTireSidewallRings({ g, detailPolicy, visualDescriptor, recipe }) {
  const tire = visualDescriptor.geometry.bodyPrimitives.find(
    ({ geometry }) => geometry.kind === "rounded-wheel-v1",
  );
  if (!tire) return;
  const ringRadiusM = tire.geometry.radiusM * 0.82,
    ringWireM = Math.min(0.012, tire.geometry.shoulderRadiusM * 0.15),
    geometry = sharePrimitiveGeometry(
      new THREE.TorusGeometry(
        ringRadiusM - ringWireM,
        ringWireM,
        Math.max(6, Number(detailPolicy.springWireSegments || 8)),
        Math.max(12, Number(detailPolicy.radialSegments || 24)),
      ),
    );
  for (const sign of [-1, 1]) {
    const ring = markRecipe(new THREE.Mesh(geometry, mats.rubber), recipe);
    ring.name = `Decoration ${recipe.id}`;
    ring.position.z = sign * tire.geometry.widthM * 0.43;
    ring.castShadow = false;
    ring.receiveShadow = detailPolicy.receiveShadow !== false;
    g.add(ring);
  }
}

function addHeadlightDecoration({ g, visualDescriptor, detailPolicy }) {
  const recipe = {
      id: "headlight-emitter-v1",
      classification: "decorative-emissive-lens-v1",
      anchorSource: "canonical-lamp-body-front-face-v1",
      maximumInstanceCount: 1,
      minimumTier: "performance",
    },
    glowMaterial = trackOwnedRenderResource(
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
  glow.position.set(0, 0, -0.169);
  glow.rotation.y = Math.PI;
  glow.userData.decorativeGeometry = true;
  glow.userData.headlightBulb = true;
  markRecipe(glow, recipe);
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

const BOX_FASTENER_TYPES = new Set([
    "beam",
    "plate",
    "cargo",
    "lever",
    "battery",
    "computer",
    "powerbus",
    "aircompressor",
    "pneumaticvalve",
    "tirepressureprobe",
  ]),
  VENT_TYPES = new Set([
    "battery",
    "computer",
    "powerbus",
    "aircompressor",
    "pneumaticvalve",
  ]),
  LABEL_TYPES = new Set([
    "battery",
    "computer",
    "powerbus",
    "aircompressor",
    "airreservoir",
    "pneumaticvalve",
    "receiver",
    "navsensor",
    "rangesensor",
    "imu",
    "contactsensor",
    "thermalprobe",
    "pressureprobe",
    "tirepressureprobe",
  ]),
  CLASSIFIED_RECIPES = Object.freeze([
    Object.freeze({
      id: "recessed-fasteners-v1",
      classification: "decorative-fastener-v1",
      anchorSource: "canonical-body-bounds-front-face-v1",
      maximumInstanceCount: 4,
      minimumTier: "standard",
      appliesTo: BOX_FASTENER_TYPES,
      build: addFasteners,
    }),
    Object.freeze({
      id: "enclosure-vents-v1",
      classification: "decorative-vent-v1",
      anchorSource: "canonical-body-bounds-front-face-v1",
      maximumInstanceCount: 3,
      minimumTier: "hero",
      appliesTo: VENT_TYPES,
      build: addVents,
    }),
    Object.freeze({
      id: "equipment-label-plate-v1",
      classification: "decorative-label-v1",
      anchorSource: "canonical-body-bounds-front-face-v1",
      maximumInstanceCount: 1,
      minimumTier: "standard",
      appliesTo: LABEL_TYPES,
      build: addLabelPlate,
    }),
    Object.freeze({
      id: "tire-sidewall-rings-v1",
      classification: "decorative-sidewall-marking-v1",
      anchorSource: "canonical-rounded-wheel-envelope-v1",
      maximumInstanceCount: 2,
      minimumTier: "standard",
      appliesTo: new Set(["wheel"]),
      build: addTireSidewallRings,
    }),
  ]);

/** Adds classified non-physical trim without touching canonical roots. */
export function buildDecoration({
  g,
  visualDescriptor,
  detailPolicy = {},
  decorationContext,
}) {
  DECORATION_BUILDERS.get(visualDescriptor.type)?.({
    g,
    visualDescriptor,
    detailPolicy,
  });
  for (const recipe of CLASSIFIED_RECIPES) {
    if (
      !recipe.appliesTo.has(visualDescriptor.type) ||
      DETAIL_RANK[
        /** @type {{id?:"performance"|"standard"|"hero"}} */ (detailPolicy)
          .id || "standard"
      ] < DETAIL_RANK[recipe.minimumTier]
    )
      continue;
    recipe.build({
      g,
      visualDescriptor,
      detailPolicy,
      decorationContext,
      recipe,
    });
  }
}
