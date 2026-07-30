import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { componentAppearanceProfile } from "../src/presentation/component-appearance-library.js";
import { ComponentDetailController } from "../src/presentation/component-detail-controller.js";
import { componentDetailTier } from "../src/presentation/component-detail-policy.js";
import { LargeAssemblyBatcher } from "../src/presentation/large-assembly-batcher.js";
import { prepareArticulatedFootVisual } from "../src/presentation/articulated-foot-visual.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { installWorkshopRuntimeLoop } from "../src/application/workshop-runtime-loop.js";
import {
  disposeObject3D,
  isSharedRenderResource,
  markSharedRenderResource,
  sharePrimitiveGeometry,
  sharedRenderResourceStats,
} from "../src/presentation/render-resources.js";

const first = sharePrimitiveGeometry(new THREE.BoxGeometry(1, 2, 3));
const duplicate = sharePrimitiveGeometry(new THREE.BoxGeometry(1, 2, 3));
assert.equal(first, duplicate, "identical primitive geometry must be shared");
assert.equal(isSharedRenderResource(first), true);

const sharedMaterial = markSharedRenderResource(
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  ),
  ownedMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 }),
  ownedGeometry = new THREE.ExtrudeGeometry(new THREE.Shape(), {
    depth: 0.1,
  }),
  group = new THREE.Group(),
  sharedMesh = new THREE.Mesh(first, sharedMaterial),
  ownedMesh = new THREE.Mesh(ownedGeometry, ownedMaterial);
let sharedMaterialDisposals = 0,
  sharedGeometryDisposals = 0,
  ownedMaterialDisposals = 0,
  ownedGeometryDisposals = 0;
sharedMaterial.addEventListener("dispose", () => sharedMaterialDisposals++);
first.addEventListener("dispose", () => sharedGeometryDisposals++);
ownedMaterial.addEventListener("dispose", () => ownedMaterialDisposals++);
ownedGeometry.addEventListener("dispose", () => ownedGeometryDisposals++);
group.add(sharedMesh, ownedMesh);
disposeObject3D(group);
assert.equal(sharedMaterialDisposals, 0, "shared material was released");
assert.equal(sharedGeometryDisposals, 0, "shared geometry was released");
assert.equal(ownedMaterialDisposals, 1, "owned material must be released once");
assert.equal(ownedGeometryDisposals, 1, "owned geometry must be released once");

const instanced = new THREE.InstancedMesh(first, sharedMaterial, 2);
let instancedDisposals = 0;
instanced.addEventListener("dispose", () => instancedDisposals++);
disposeObject3D(instanced);
assert.equal(
  instancedDisposals,
  1,
  "instanced GPU attributes require an object-level disposal",
);

const light = new THREE.SpotLight(),
  shadowMap = new THREE.WebGLRenderTarget(8, 8),
  shadowMapPass = new THREE.WebGLRenderTarget(8, 8),
  lightGroup = new THREE.Group();
let shadowMapDisposals = 0,
  shadowMapPassDisposals = 0;
shadowMap.addEventListener("dispose", () => shadowMapDisposals++);
shadowMapPass.addEventListener("dispose", () => shadowMapPassDisposals++);
light.shadow.map = shadowMap;
light.shadow.mapPass = shadowMapPass;
lightGroup.add(light);
disposeObject3D(lightGroup);
assert.equal(shadowMapDisposals, 1, "owned light shadow map must be released");
assert.equal(
  shadowMapPassDisposals,
  1,
  "owned light shadow blur target must be released",
);

const beam = componentMesh("beam");
const beamBody = beam.getObjectByProperty("name", "Canonical body body"),
  secondBeam = componentMesh("beam"),
  secondBeamBody = secondBeam.getObjectByProperty(
    "name",
    "Canonical body body",
  );
assert.ok(beamBody, "beam omitted its one canonical body primitive");
assert.deepEqual(beam.userData.geometryProjection.bodyPrimitiveIds, ["body"]);
assert.equal(
  beamBody.geometry,
  secondBeamBody.geometry,
  "component primitives must reuse immutable geometry",
);
disposeObject3D(beam);
disposeObject3D(secondBeam);
assert.ok(sharedRenderResourceStats().primitiveGeometries >= 1);

assert.equal(
  componentAppearanceProfile({ materialKey: "workshop-steel" }),
  "steel",
);
assert.equal(
  componentAppearanceProfile({ materialKey: "workshop-aluminum" }),
  "aluminum",
);
assert.equal(
  componentAppearanceProfile({ materialKey: "tire-rubber" }),
  "rubber",
);
assert.equal(
  componentAppearanceProfile({ materialKey: "nylon-rope" }),
  "nylon",
);
assert.equal(
  componentAppearanceProfile({
    materialKey: "generic-structure",
    aerothermal: { material: { ablative: true } },
  }),
  "ablative",
);
assert.equal(
  componentAppearanceProfile({
    materialKey: "generic-structure",
    semanticKey: "rotor-blade",
    customColor: null,
  }),
  "composite",
);
assert.equal(
  componentAppearanceProfile({ materialKey: "generic-structure" }),
  "paint",
);
assert.throws(
  () => componentAppearanceProfile({ materialKey: "unknown-material" }),
  /Unsupported component appearance/,
);

const wheel = componentMesh("wheel"),
  wheelBody = wheel.getObjectByProperty("name", "Canonical body tire-envelope"),
  wheelBounds = new THREE.Box3()
    .setFromObject(wheel)
    .getSize(new THREE.Vector3());
assert.equal(wheelBody.geometry.type, "LatheGeometry");
assert.equal(wheelBody.castShadow, true);
assert.equal(wheelBody.receiveShadow, true);
assert.ok(Math.abs(wheelBounds.x - 1.3) < 1e-6);
assert.ok(Math.abs(wheelBounds.y - 1.3) < 1e-6);
assert.ok(Math.abs(wheelBounds.z - 0.42) < 1e-6);
disposeObject3D(wheel);

const scaledRoundPart = (id, type, scale) => {
    const authored = {
      id,
      type,
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale,
      config: componentDefaults(type),
    };
    return componentMesh(authored);
  },
  scaledReservoir = scaledRoundPart(880, "airreservoir", {
    x: 1.7,
    y: 0.65,
    z: 1.25,
  }),
  scaledReceiver = scaledRoundPart(881, "receiver", {
    x: 0.8,
    y: 1.4,
    z: 1.1,
  }),
  scaledReservoirBody = scaledReservoir.getObjectByProperty(
    "name",
    "Canonical body reservoir-body",
  ),
  scaledReceiverBody = scaledReceiver.getObjectByProperty(
    "name",
    "Canonical body receiver-body",
  );
assert.notEqual(
  scaledReservoirBody.geometry,
  scaledReceiverBody.geometry,
  "differently scaled elliptic cylinders collided in the shared cache",
);
for (const root of [scaledReservoir, scaledReceiver]) {
  const rendered = new THREE.Box3()
      .setFromObject(root)
      .getSize(new THREE.Vector3())
      .toArray(),
    bounds = root.userData.geometryDescriptor.bodyBoundsPartM,
    expected = bounds.maximumM.map(
      (maximum, axis) => maximum - bounds.minimumM[axis],
    );
  rendered.forEach((value, axis) =>
    assert.ok(
      Math.abs(value - expected[axis]) <= 1e-6,
      `scaled round part rendered the wrong envelope on axis ${axis}`,
    ),
  );
}
disposeObject3D(scaledReservoir);
disposeObject3D(scaledReceiver);

assert.equal(
  componentDetailTier({
    currentTier: "standard",
    projectedDiameterPx: 270,
    partCount: 1,
  }),
  "hero",
);
assert.equal(
  componentDetailTier({
    currentTier: "hero",
    projectedDiameterPx: 190,
    partCount: 1,
  }),
  "hero",
  "hero tier did not retain its exit hysteresis",
);
assert.equal(
  componentDetailTier({
    currentTier: "standard",
    projectedDiameterPx: 20,
    partCount: 1,
  }),
  "performance",
);
assert.equal(
  componentDetailTier({
    currentTier: "performance",
    projectedDiameterPx: 40,
    partCount: 1,
  }),
  "performance",
  "performance tier did not retain its exit hysteresis",
);

const detailCamera = new THREE.PerspectiveCamera(42, 1, 0.25, 1000),
  detailRoot = componentMesh("beam"),
  detailPart = { id: 900, mesh: detailRoot, ambientHeatBindings: null },
  detailController = new ComponentDetailController();
detailRoot.userData.partId = detailPart.id;
detailCamera.position.set(0, 0, 100);
detailController.update({
  parts: [detailPart],
  camera: detailCamera,
  viewportHeightPx: 720,
  running: false,
  selectedIds: new Set([detailPart.id]),
});
assert.equal(detailRoot.userData.visualDetailTier, "performance");
detailCamera.position.set(0, 0, 4);
detailController.update({
  parts: [detailPart],
  camera: detailCamera,
  viewportHeightPx: 720,
  running: true,
  selectedIds: new Set([detailPart.id]),
});
assert.equal(detailRoot.userData.visualDetailTier, "performance");
assert.equal(detailController.snapshot().pendingTransitions, 1);
detailController.update({
  parts: [detailPart],
  camera: detailCamera,
  viewportHeightPx: 720,
  running: false,
  selectedIds: new Set([detailPart.id]),
});
assert.equal(detailRoot.userData.visualDetailTier, "hero");
assert.equal(detailRoot.userData.partId, detailPart.id);
assert.ok(
  detailRoot.children.every((child) => child.userData.partId === detailPart.id),
  "detail rebuild lost child picking identity",
);
disposeObject3D(detailRoot);

const footPart = { id: 901, mesh: componentMesh("plate") };
prepareArticulatedFootVisual(footPart);
const authoredFootChildren = [...footPart.mesh.children];
detailController.update({
  parts: [footPart],
  camera: detailCamera,
  viewportHeightPx: 720,
  running: false,
  selectedIds: new Set([footPart.id]),
});
assert.deepEqual(
  footPart.mesh.children,
  authoredFootChildren,
  "detail selection replaced the authored articulated foot",
);
assert.equal(
  detailController.snapshot().selected[0].reason,
  "projection:authored-fixed",
);
disposeObject3D(footPart.mesh);

const rope = componentMesh("rope"),
  ropeVisual = rope.userData.flexibleLineVisual;
assert.ok(ropeVisual, "Rope must declare a bounded flexible-line visual");
assert.equal(ropeVisual.maximumEdgeCount, 64);
assert.equal(ropeVisual.runtime.isInstancedMesh, true);
assert.equal(ropeVisual.runtime.count, 0);
assert.equal(ropeVisual.runtime.frustumCulled, false);
assert.equal(
  ropeVisual.runtime.geometry.parameters.height,
  1,
  "runtime segments must scale one reusable unit tube",
);
let ropeRuntimeGeometryDisposals = 0,
  ropeRuntimeMeshDisposals = 0;
ropeVisual.runtime.geometry.addEventListener(
  "dispose",
  () => ropeRuntimeGeometryDisposals++,
);
ropeVisual.runtime.addEventListener(
  "dispose",
  () => ropeRuntimeMeshDisposals++,
);
disposeObject3D(rope);
assert.equal(ropeRuntimeGeometryDisposals, 1);
assert.equal(ropeRuntimeMeshDisposals, 1);

const machine = new THREE.Group(),
  parts = Array.from({ length: 129 }, (_, index) => {
    const part = {
      id: index + 1,
      type: "beam",
      customColor: null,
      config: { color: 0x668fa3 },
      mesh: componentMesh("beam"),
    };
    part.mesh.position.x = index * 0.1;
    machine.add(part.mesh);
    return part;
  }),
  batcher = new LargeAssemblyBatcher({ machine });
batcher.sync(parts);
assert.deepEqual(batcher.snapshot(), {
  active: true,
  batches: 1,
  instances: 129,
});
assert.ok(parts.every((part) => !part.mesh.visible));
const batchMesh = machine.getObjectByName("largeAssemblyBeamBatch");
assert.equal(
  batchMesh.userData.partIds[41],
  42,
  "batch picking map lost the authoritative part ID",
);
assert.deepEqual(
  [
    batchMesh.geometry.parameters.width,
    batchMesh.geometry.parameters.height,
    batchMesh.geometry.parameters.depth,
  ],
  parts[0].mesh.userData.geometryDescriptor.bodyPrimitives[0].geometry
    .fullSizeM,
  "batch geometry diverged from the canonical beam primitive",
);
assert.equal(
  batchMesh.material.color.getHex(),
  parts[0].mesh.userData.visualDescriptor.color,
  "batch material diverged from the canonical beam appearance",
);
parts[0].mesh.position.x = 17;
batcher.update();
const instanceTransform = new THREE.Matrix4(),
  position = new THREE.Vector3();
batchMesh.getMatrixAt(0, instanceTransform);
position.setFromMatrixPosition(instanceTransform);
assert.ok(Math.abs(position.x - 17) < 1e-6, "batch transform became stale");

const scaledMachine = new THREE.Group(),
  scaledAuthoring = {
    id: 1001,
    type: "beam",
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1.8, y: 0.6, z: 1.3 },
    config: componentDefaults("beam"),
  },
  scaledPart = {
    ...scaledAuthoring,
    mesh: componentMesh(scaledAuthoring),
  },
  scaledBatcher = new LargeAssemblyBatcher({
    machine: scaledMachine,
    threshold: 0,
    minimumGroupSize: 1,
  });
scaledMachine.add(scaledPart.mesh);
scaledBatcher.sync([scaledPart]);
const scaledBatch = scaledMachine.getObjectByName("largeAssemblyBeamBatch"),
  scaledCanonicalSize =
    scaledPart.mesh.userData.geometryDescriptor.bodyPrimitives[0].geometry
      .fullSizeM;
assert.deepEqual(
  [
    scaledBatch.geometry.parameters.width,
    scaledBatch.geometry.parameters.height,
    scaledBatch.geometry.parameters.depth,
  ],
  scaledCanonicalSize,
  "batch geometry ignored authored independent-axis scale",
);
scaledBatcher.dispose();
disposeObject3D(scaledPart.mesh);
batcher.dispose();
assert.ok(parts.every((part) => part.mesh.visible));
for (const part of parts) disposeObject3D(part.mesh);

const beforeColorChurn = sharedRenderResourceStats(),
  colored = Array.from({ length: 64 }, (_, color) =>
    componentMesh("beam", (color * 2654435761) & 0xffffff),
  ),
  duringColorChurn = sharedRenderResourceStats();
assert.equal(
  duringColorChurn.owned.componentColorMaterials,
  (beforeColorChurn.owned.componentColorMaterials || 0) + colored.length,
);
assert.equal(duringColorChurn.baseMaterials, beforeColorChurn.baseMaterials);
assert.equal(duringColorChurn.sharedTextures, beforeColorChurn.sharedTextures);
for (const object of colored) disposeObject3D(object);
assert.equal(
  sharedRenderResourceStats().owned.componentColorMaterials || 0,
  beforeColorChurn.owned.componentColorMaterials || 0,
  "unique custom colors leaked object-owned materials",
);

const presentationOrder = [];
let scheduledFrame = null;
const runtimeLoop = installWorkshopRuntimeLoop({
  target: {
    requestAnimationFrame(callback) {
      scheduledFrame = callback;
      return 1;
    },
    cancelAnimationFrame() {},
  },
  simulation: {
    simulate: () => presentationOrder.push("simulate"),
    updateFailure: () => presentationOrder.push("failure"),
    elapsed: () => 1,
  },
  presentation: {
    streamEarth: () => presentationOrder.push("earth"),
    updateExploded: () => presentationOrder.push("exploded"),
    updateEnvironment: () => presentationOrder.push("environment"),
    updateWater: () => presentationOrder.push("water"),
    updateCamera: () => presentationOrder.push("camera"),
    updateDetail: () => presentationOrder.push("detail"),
    updateBatch: () => presentationOrder.push("batch"),
    render: () => presentationOrder.push("render"),
  },
  diagnostics: () => ({}),
  now: () => 0,
});
runtimeLoop.advanceTime(16.667);
assert.deepEqual(presentationOrder.slice(-6), [
  "environment",
  "water",
  "camera",
  "detail",
  "batch",
  "render",
]);
presentationOrder.length = 0;
scheduledFrame(16.667);
assert.deepEqual(presentationOrder.slice(-6), [
  "environment",
  "water",
  "camera",
  "detail",
  "batch",
  "render",
]);
runtimeLoop.dispose();

const finalStats = sharedRenderResourceStats();
assert.equal(finalStats.owned.componentColorMaterials || 0, 0);
assert.equal(finalStats.owned.batchColorMaterials || 0, 0);

console.log("render resource ownership and component instancing passed");
