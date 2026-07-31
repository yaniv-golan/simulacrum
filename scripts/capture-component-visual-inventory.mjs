import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import { TYPES } from "../src/model/component-catalog.js";
import { resolveComponentGeometryContractForType } from "../src/model/component-geometry-contract.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { componentAppearanceContract } from "../src/presentation/component-appearance-library.js";
import { COMPONENT_DETAIL_TIERS } from "../src/presentation/component-detail-policy.js";
import { componentMesh } from "../src/presentation/component-mesh-factory.js";
import { disposeObject3D } from "../src/presentation/render-resources.js";
import { captureWorkspaceIdentity } from "./lib/workspace-identity.mjs";
import { sameWorkspaceIdentity } from "./lib/workspace-identity.mjs";

const root = path.resolve(import.meta.dirname, "..");
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

function sumTierMetrics(tier) {
  const values = Object.values(components).map(
    (component) => component.tiers[tier],
  );
  return {
    componentCount: values.length,
    drawCalls: values.reduce((sum, value) => sum + value.drawCalls, 0),
    triangles: values.reduce((sum, value) => sum + value.triangles, 0),
    maximumPerComponent: {
      drawCalls: Math.max(...values.map((value) => value.drawCalls)),
      triangles: Math.max(...values.map((value) => value.triangles)),
      materials: Math.max(...values.map((value) => value.materials)),
      textures: Math.max(...values.map((value) => value.textures)),
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
      semanticKey: primitive.semanticKey || null,
      role: null,
    })),
    ...descriptor.physicalFeatures.map((feature) => ({
      projection: "feature",
      id: feature.id,
      materialKey: feature.materialKey,
      semanticKey: null,
      role: feature.role || null,
    })),
    ...(descriptor.runtimeGeometryContract
      ? [
          {
            projection: "runtime",
            id: descriptor.runtimeGeometryContract.styleKey,
            materialKey: descriptor.runtimeGeometryContract.materialKey,
            semanticKey: descriptor.runtimeGeometryContract.styleKey,
            role: "runtime",
          },
        ]
      : []),
  ].map((region) => ({
    ...region,
    appearance: componentAppearanceContract({
      materialKey: region.materialKey,
      semanticKey: region.semanticKey,
      role: region.role,
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

const mixedParts = ["gearbox", "cart", "humanoid", "drone", "mission"].flatMap(
    (kind) => builtInDemo(kind).blueprint.parts,
  ),
  mixedRoot = new THREE.Group();
for (const part of mixedParts)
  mixedRoot.add(componentMesh(part, undefined, "standard"));
const mixed124 = {
  ...geometryMetrics(mixedRoot),
  partCount: mixedParts.length,
  typeCounts: Object.fromEntries(
    [...new Set(mixedParts.map((part) => part.type))]
      .sort()
      .map((type) => [
        type,
        mixedParts.filter((part) => part.type === type).length,
      ]),
  ),
};
disposeObject3D(mixedRoot);

const performancePath = path.resolve(
    process.env.COMPONENT_VISUAL_PERFORMANCE_EVIDENCE ||
      "artifacts/release-performance-current.json",
  ),
  budgetPath = path.join(root, "scripts/baselines/release-0.1.0.json"),
  [
    packageJson,
    packageLock,
    sourceIdentity,
    performanceEvidence,
    performanceBudget,
  ] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "package-lock.json")),
    captureWorkspaceIdentity(root, ["artifacts", "dist", "packages/core/dist"]),
    readFile(performancePath, "utf8").then(JSON.parse),
    readFile(budgetPath, "utf8").then(JSON.parse),
  ]);
if (!sameWorkspaceIdentity(sourceIdentity, performanceEvidence.source))
  throw new Error(
    "component visual inventory and performance evidence came from different working trees",
  );

const artifact = {
  schemaVersion: 1,
  evidenceClasses: Object.freeze({
    descriptor: "deterministic-model-descriptor",
    projection: "renderer-specific-non-browser-projection",
    timing: "release-performance-budget-qualified",
    environment: "node-host-only",
  }),
  identity: {
    source: sourceIdentity,
    node: process.version,
    packageManager: packageJson.packageManager,
    applicationVersion: packageJson.version,
    packageLockSha256: crypto
      .createHash("sha256")
      .update(packageLock)
      .digest("hex"),
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model || "unknown",
    detailPolicyVersion: 1,
  },
  catalogTypeCount: Object.keys(components).length,
  baselines: {
    closeUpHero: sumTierMetrics("hero"),
    mixed124,
    releasePerformance: {
      source: performanceEvidence.source,
      environment: performanceEvidence.environment,
      summary: performanceEvidence.summary,
      budget: performanceBudget.budgets,
      errors: performanceEvidence.errors,
    },
  },
  components,
};
if (artifact.baselines.mixed124.partCount !== 124)
  throw new Error(
    `expected the released-machine mix to contain 124 parts, received ${artifact.baselines.mixed124.partCount}`,
  );
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  path.join(path.dirname(outputPath), "performance-budget.json"),
  `${JSON.stringify(artifact.baselines.releasePerformance, null, 2)}\n`,
);
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(
  `component visual inventory captured (${artifact.catalogTypeCount} types at ${outputPath})`,
);
