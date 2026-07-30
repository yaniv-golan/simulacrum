import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import { TYPES } from "../src/model/component-catalog.js";
import { resolveComponentGeometryContractForType } from "../src/model/component-geometry-contract.js";
import { componentAppearanceProfile } from "../src/presentation/component-appearance-library.js";
import { COMPONENT_DETAIL_TIERS } from "../src/presentation/component-detail-policy.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { disposeObject3D } from "../src/presentation/render-resources.js";

const outputPath = path.resolve(
  process.env.COMPONENT_VISUAL_INVENTORY ||
    "artifacts/component-visual-realism/component-inventory.json",
);

function geometryMetrics(root) {
  const materials = new Set(),
    textures = new Set();
  let drawCalls = 0,
    triangles = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    drawCalls++;
    const geometry = object.geometry,
      triangleCount = geometry.index
        ? geometry.index.count / 3
        : (geometry.attributes.position?.count || 0) / 3;
    triangles += triangleCount * (object.isInstancedMesh ? object.count : 1);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material))
        if (value?.isTexture) textures.add(value);
    }
  });
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    drawCalls,
    triangles,
    materials: materials.size,
    textures: textures.size,
    renderedBoundsM: {
      minimumM: bounds.min.toArray(),
      maximumM: bounds.max.toArray(),
    },
  };
}

const components = {};
for (const type of Object.keys(TYPES).sort()) {
  const descriptor = resolveComponentGeometryContractForType(type),
    tiers = {};
  for (const tier of Object.keys(COMPONENT_DETAIL_TIERS)) {
    const root = componentMesh(type, undefined, tier);
    tiers[tier] = geometryMetrics(root);
    disposeObject3D(root);
  }
  const regions = [
    ...descriptor.bodyPrimitives.map((primitive) => ({
      projection: "body",
      id: primitive.id,
      materialKey: primitive.materialKey,
      semanticKey: primitive.semanticKey,
    })),
    ...descriptor.physicalFeatures.map((feature) => ({
      projection: "feature",
      id: feature.id,
      materialKey: feature.materialKey,
      semanticKey: feature.role,
    })),
    ...(descriptor.runtimeGeometryContract
      ? [
          {
            projection: "runtime",
            id: descriptor.runtimeGeometryContract.styleKey,
            materialKey: descriptor.runtimeGeometryContract.materialKey,
            semanticKey: descriptor.runtimeGeometryContract.styleKey,
          },
        ]
      : []),
  ].map((region) => ({
    ...region,
    expectedAppearanceProfile: componentAppearanceProfile({
      materialKey: region.materialKey,
      semanticKey: region.semanticKey,
      aerothermal: descriptor.aerothermal,
    }),
  }));
  components[type] = {
    geometryClass: descriptor.geometryClass,
    bodyKinds: descriptor.bodyPrimitives.map(({ geometry }) => geometry.kind),
    collisionKinds: descriptor.collisionPrimitives.map(
      ({ geometry }) => geometry.kind,
    ),
    primitiveCounts: {
      body: descriptor.bodyPrimitives.length,
      collision: descriptor.collisionPrimitives.length,
      features: descriptor.physicalFeatures.length,
    },
    bounds: {
      body: descriptor.bodyBoundsPartM,
      collision: descriptor.collisionBoundsPartM,
      feature: descriptor.featureBoundsPartM,
      selection: descriptor.selectionBoundsPartM,
      overall: descriptor.overallPhysicalBoundsPartM,
    },
    portFrames: descriptor.portFrames,
    physicalFeatures: descriptor.physicalFeatures,
    deformation: descriptor.deformationContract,
    approximations: descriptor.provenance.approximations,
    regions,
    tiers,
  };
}

const artifact = {
  schemaVersion: 1,
  evidenceClass: "deterministic-model-descriptor-and-render-projection",
  identity: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model || "unknown",
    detailPolicyVersion: 1,
  },
  catalogTypeCount: Object.keys(components).length,
  components,
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(
  `component visual inventory captured (${artifact.catalogTypeCount} types at ${outputPath})`,
);
