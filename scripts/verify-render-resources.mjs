import * as THREE from "three";
import { assert } from "./lib/assert.mjs";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { LargeAssemblyBatcher } from "../src/presentation/large-assembly-batcher.js";
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
assert.ok(
  beam.children.length === 1,
  `beam draw surface count regressed to ${beam.children.length}`,
);
const secondBeam = componentMesh("beam");
assert.equal(
  beam.children[0].geometry,
  secondBeam.children[0].geometry,
  "component primitives must reuse immutable geometry",
);
disposeObject3D(beam);
disposeObject3D(secondBeam);
assert.ok(sharedRenderResourceStats().primitiveGeometries >= 1);

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
parts[0].mesh.position.x = 17;
batcher.update();
const instanceTransform = new THREE.Matrix4(),
  position = new THREE.Vector3();
batchMesh.getMatrixAt(0, instanceTransform);
position.setFromMatrixPosition(instanceTransform);
assert.ok(Math.abs(position.x - 17) < 1e-6, "batch transform became stale");
batcher.dispose();
assert.ok(parts.every((part) => part.mesh.visible));
for (const part of parts) disposeObject3D(part.mesh);

console.log("render resource ownership and component instancing passed");
