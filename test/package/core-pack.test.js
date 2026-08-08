import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createBrowserTest } from "../../scripts/lib/browser-test.mjs";
import { CHECKPOINT_STATE_OWNER_IDS } from "../../src/model/mechanism-artifact-identity.js";

const root = path.resolve(import.meta.dirname, "../.."),
  artifactRoot = path.join(root, "artifacts", "core-pack-test"),
  packRoot = path.join(artifactRoot, "pack"),
  fixtureRoot = path.join(artifactRoot, "fixture"),
  browserRoot = path.join(fixtureRoot, "browser"),
  browserDist = path.join(artifactRoot, "browser-dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

await fs.rm(artifactRoot, { recursive: true, force: true });
await fs.mkdir(packRoot, { recursive: true });

run(process.execPath, ["scripts/build-core-package.mjs"]);
run("npm", [
  "pack",
  "./packages/core",
  "--ignore-scripts",
  "--pack-destination",
  packRoot,
]);

const tarballName = (await fs.readdir(packRoot)).find((file) =>
    file.endsWith(".tgz"),
  ),
  tarball = path.join(packRoot, tarballName || "missing.tgz"),
  packedFiles = run("tar", ["-tzf", tarball]).trim().split("\n");
assert.ok(tarballName, "npm pack did not create a tarball");
assert.ok(packedFiles.includes("package/dist/index.js"));
assert.ok(packedFiles.includes("package/dist/index.d.ts"));
assert.ok(packedFiles.includes("package/dist/licenses/THIRD_PARTY_NOTICES.md"));
assert.ok(packedFiles.includes("package/dist/licenses/three-LICENSE"));
assert.ok(packedFiles.includes("package/dist/licenses/typescript-LICENSE.txt"));
assert.ok(packedFiles.includes("package/SEMVER.md"));
assert.equal(
  packedFiles.some((file) => file.includes("/src/")),
  false,
  "core pack leaked repository source instead of the reviewed artifact",
);

await fs.mkdir(browserRoot, { recursive: true });
await fs.writeFile(
  path.join(fixtureRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "simulacrum-core-clean-install-fixture",
      private: true,
      type: "module",
    },
    null,
    2,
  )}\n`,
);
run(
  "npm",
  [
    "install",
    tarball,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
  ],
  { cwd: fixtureRoot },
);

const sourcePackage = JSON.parse(
    await fs.readFile(
      path.join(root, "packages", "core", "package.json"),
      "utf8",
    ),
  ),
  installedPackage = JSON.parse(
    await fs.readFile(
      path.join(
        fixtureRoot,
        "node_modules",
        "@yaniv-golan",
        "simulacrum-core",
        "package.json",
      ),
      "utf8",
    ),
  );
assert.equal(installedPackage.name, "@yaniv-golan/simulacrum-core");
assert.equal(installedPackage.version, sourcePackage.version);
assert.equal(installedPackage.private, undefined);
assert.equal(installedPackage.exports["."].types, "./dist/index.d.ts");
const installedSemver = await fs.readFile(
  path.join(
    fixtureRoot,
    "node_modules",
    "@yaniv-golan",
    "simulacrum-core",
    "SEMVER.md",
  ),
  "utf8",
);
assert.match(
  installedSemver,
  new RegExp(`\\b${CHECKPOINT_STATE_OWNER_IDS.length}-owner\\b`),
  "packed SEMVER owner count contradicts the authoritative checkpoint contract",
);

await fs.writeFile(
  path.join(fixtureRoot, "node-smoke.mjs"),
  `import {
  AssemblyModel,
  BodyRegistry,
  compileAssembly,
  componentDefaults,
  MassPropertyCommitSystem,
  reconstructTreeCutWrenches,
  rigidClusterCutFramesWorld,
  SimulationSession,
  TelemetrySystem,
  TYPES,
} from "@yaniv-golan/simulacrum-core";

const model = new AssemblyModel();
const registry = new BodyRegistry({ parts: [] });
if (typeof MassPropertyCommitSystem.prototype.reconstructAfterCheckpointOwners !== "undefined" ||
    typeof MassPropertyCommitSystem.prototype.planCheckpointMassProperties !== "undefined")
  throw new Error("packed Core leaked checkpoint-coordinator mass operations");
try {
  registry.setMassProperties("caller-owned", { massKg: 99 });
  throw new Error("packed BodyRegistry retained public mass mutation authority");
} catch (error) {
  if (error?.code !== "MASS_PROPERTY_OWNER_REQUIRED") throw error;
}
const compiled = compileAssembly(
  JSON.stringify({
    revision: 1,
    parts: [
      { id: 1, type: "beam", pos: [0, 0, 0], orientation: [0, 0, 0, 1], config: componentDefaults("beam") },
      { id: 2, type: "beam", pos: [2.4, 0, 0], orientation: [0, 0, 0, 1], config: componentDefaults("beam") },
    ],
    connections: [{
      id: "fixed-joint",
      a: 1,
      b: 2,
      kind: "mechanical",
      portA: "B",
      portB: "A",
      capacity: { ultimateForceN: 24000, ultimateTorqueNm: 6000 },
    }],
  }),
  JSON.stringify(TYPES),
);
const fixed = compiled.constraints.find((constraint) => constraint.kind === "fixed");
if (fixed?.attachmentFrameA?.positionWorldM?.[0] !== 1.2)
  throw new Error("packed compiler omitted fixed attachment frame A");
if (fixed?.attachmentFrameB?.positionWorldM?.[0] !== 1.2)
  throw new Error("packed compiler omitted fixed attachment frame B");
if (fixed?.failureAttachments?.map((attachment) => attachment.connectionId).join(",") !== "fixed-joint,fixed-joint")
  throw new Error("packed compiler omitted fixed attachment failure ownership");
const cluster = compiled.rigidClusters[0];
if (cluster?.kind !== "fixed-rigid-cluster-v1" || cluster.memberPartIds.join(",") !== "1,2")
  throw new Error("packed compiler omitted rigid-cluster ownership");
if (cluster.cutWrenchTopology.kind !== "tree-newton-euler-cuts-v1" || cluster.cutWrenchTopology.cuts.length !== 1)
  throw new Error("packed compiler omitted the unique fixed-tree cut");
if (typeof reconstructTreeCutWrenches !== "function" || typeof rigidClusterCutFramesWorld !== "function")
  throw new Error("packed Core omitted the public rigid-cluster oracle");
const rootBody = compiled.bodies.find((body) => body.id === cluster.rootBodyId);
if (rigidClusterCutFramesWorld(cluster, JSON.stringify({
  positionWorldM: rootBody.position,
  orientationWorld: rootBody.orientation,
})).length !== 1)
  throw new Error("packed Core rigid-cluster frame oracle is unavailable");
const session = new SimulationSession({ systems: [new TelemetrySystem()] });
session.start(model.snapshot());
session.stepFixed();
if (session.telemetry().tick !== 1) throw new Error("telemetry did not advance");
session.dispose();
console.log("clean Node import passed");
`,
);
assert.match(
  run(process.execPath, ["node-smoke.mjs"], { cwd: fixtureRoot }),
  /clean Node import passed/,
);

await fs.cp(
  path.join(root, "examples", "core-extensions"),
  path.join(fixtureRoot, "core-extensions"),
  { recursive: true },
);
assert.match(
  run(process.execPath, ["core-extensions/run-all.mjs"], {
    cwd: fixtureRoot,
  }),
  /all twelve public core extension examples passed/,
);

await fs.writeFile(
  path.join(fixtureRoot, "type-smoke.mts"),
  `import {
  AssemblyModel,
  COMPONENT_GEOMETRY_SCHEMA_VERSION,
  compileAssembly,
  geometryDescriptorForType,
  MultibodyRuntime,
  reconstructTreeCutWrenches,
  rigidClusterCutFramesWorld,
  SimulationSession,
  startMultibodyRuntime,
  validateGeometryDescriptorOrThrow,
  type BodyPrimitiveV1,
  type GeometryDescriptorV2,
  type GeometryBoundsV1,
  type PhysicalFeatureV1,
  type PortFrameV2,
  type RigidClusterAttachmentFrameV1,
  type RigidClusterCutV1,
  type RigidClusterDescriptorV1,
  type RigidClusterExternalWrenchV1,
  type RigidClusterMemberStateV1,
} from "@yaniv-golan/simulacrum-core";
type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;
type RigidRootIdIsConcrete = AssertFalse<IsAny<RigidClusterDescriptorV1["rootPartId"]>>;
type RigidCutParentIdIsConcrete = AssertFalse<IsAny<RigidClusterCutV1["parentPartId"]>>;
type RigidAttachmentPortIsConcrete = AssertFalse<IsAny<RigidClusterAttachmentFrameV1["portId"]>>;
type RigidMemberIdIsConcrete = AssertFalse<IsAny<RigidClusterMemberStateV1["partId"]>>;
type RigidExternalIdIsConcrete = AssertFalse<IsAny<RigidClusterExternalWrenchV1["partId"]>>;
const serializedCatalog: NonNullable<Parameters<typeof compileAssembly>[1]> = "{}";
const runtimeCatalog: NonNullable<ConstructorParameters<typeof MultibodyRuntime>[0]["catalog"]> = "{}";
const startupCatalog: NonNullable<Parameters<typeof startMultibodyRuntime>[1]["catalog"]> = "{}";
// @ts-expect-error public compilation does not accept caller-owned catalog objects
const invalidCompiledCatalog: Parameters<typeof compileAssembly>[1] = {};
// @ts-expect-error public runtime construction does not accept caller-owned catalog objects
const invalidRuntimeCatalog: ConstructorParameters<typeof MultibodyRuntime>[0]["catalog"] = {};
// @ts-expect-error public runtime startup does not accept caller-owned catalog objects
const invalidStartupCatalog: Parameters<typeof startMultibodyRuntime>[1]["catalog"] = {};
const model = new AssemblyModel();
const revision: number = model.revision;
const session = new SimulationSession();
const steps: number = session.stepFixed();
const descriptor: GeometryDescriptorV2 = geometryDescriptorForType("beam");
const validated: GeometryDescriptorV2 = validateGeometryDescriptorOrThrow(descriptor);
const frame: PortFrameV2 | undefined = descriptor.portFrames.A;
const primitive: BodyPrimitiveV1 | undefined = descriptor.bodyPrimitives[0];
const geometryClass: GeometryDescriptorV2["geometryClass"] = descriptor.geometryClass;
const feature: PhysicalFeatureV1 | undefined = descriptor.physicalFeatures[0];
const selectionBounds: GeometryBoundsV1 | null = descriptor.selectionBoundsPartM;
const collisionBounds: GeometryBoundsV1 | null = descriptor.collisionBoundsPartM;
declare const compiledAssembly: ReturnType<typeof compileAssembly>;
const rigidCluster: RigidClusterDescriptorV1 | undefined = compiledAssembly.rigidClusters[0];
const rigidCut: RigidClusterCutV1 | undefined = rigidCluster?.cutWrenchTopology.cuts[0];
const rigidMassSourceBodyId: string | undefined =
  rigidCluster?.massProperties.memberMassPropertySources[0]?.bodyId;
const endpointMassSourcePartId: string | number | undefined =
  rigidCluster?.massProperties.memberMassPropertySources[0]?.massProperties
    .endpointPointMasses?.[0]?.sourcePartId;
const publicCutOracle: typeof reconstructTreeCutWrenches =
  reconstructTreeCutWrenches;
const publicFrameOracle: typeof rigidClusterCutFramesWorld =
  rigidClusterCutFramesWorld;
const serializedCutInput: Parameters<typeof reconstructTreeCutWrenches>[1] =
  "{}";
const serializedCutFrameInput: Parameters<
  typeof rigidClusterCutFramesWorld
>[1] = "{}";
// @ts-expect-error public cut-wrench reconstruction rejects caller-owned objects
const invalidCutInput: Parameters<typeof reconstructTreeCutWrenches>[1] = {};
// @ts-expect-error public cut-frame reconstruction rejects caller-owned objects
const invalidCutFrameInput: Parameters<typeof rigidClusterCutFramesWorld>[1] =
  {};
let attachmentPositionX: number | undefined,
  failureSide: "A" | "B" | undefined;
for (const compiledConstraint of compiledAssembly.constraints) {
  if (
    "attachmentFrameA" in compiledConstraint &&
    "failureAttachments" in compiledConstraint
  ) {
    attachmentPositionX = compiledConstraint.attachmentFrameA?.positionWorldM[0];
    failureSide = compiledConstraint.failureAttachments?.[0]?.side;
  }
}
if (primitive?.geometry.kind === "box-v1") {
  const width: number = primitive.geometry.fullSizeM[0];
  void width;
}
const schemaVersion: 2 = COMPONENT_GEOMETRY_SCHEMA_VERSION;
// @ts-expect-error descriptor v2 removed the ambiguous dimensions alias
descriptor.dimensions;
// @ts-expect-error primitive kinds are a closed union
const invalidPrimitiveKind: BodyPrimitiveV1["geometry"]["kind"] = "mesh-v1";
void revision;
void steps;
void validated;
void frame;
void geometryClass;
void feature;
void selectionBounds;
void collisionBounds;
void attachmentPositionX;
void failureSide;
void rigidCluster;
void rigidCut;
void rigidMassSourceBodyId;
void schemaVersion;
void invalidPrimitiveKind;
void serializedCatalog;
void runtimeCatalog;
void startupCatalog;
void invalidCompiledCatalog;
void invalidRuntimeCatalog;
void invalidStartupCatalog;
void serializedCutInput;
void serializedCutFrameInput;
void invalidCutInput;
void invalidCutFrameInput;
const rigidIdentityTypesAreConcrete: [
  RigidRootIdIsConcrete,
  RigidCutParentIdIsConcrete,
  RigidAttachmentPortIsConcrete,
  RigidMemberIdIsConcrete,
  RigidExternalIdIsConcrete,
] = [false, false, false, false, false];
void rigidIdentityTypesAreConcrete;
`,
);
await fs.writeFile(
  path.join(fixtureRoot, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        types: [],
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ["type-smoke.mts"],
    },
    null,
    2,
  )}\n`,
);
run(
  process.execPath,
  [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
  { cwd: fixtureRoot },
);

await fs.writeFile(
  path.join(browserRoot, "index.html"),
  `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Core browser smoke</title></head>
  <body>
    <output id="result">LOADING</output>
    <script type="module">
      import { AssemblyModel, standardAtmosphere } from "@yaniv-golan/simulacrum-core";
      const model = new AssemblyModel();
      const atmosphere = standardAtmosphere(0);
      document.querySelector("#result").textContent =
        model.snapshot().parts.length === 0 && atmosphere.density > 1
          ? "CORE_BROWSER_OK"
          : "CORE_BROWSER_FAILED";
    </script>
  </body>
</html>
`,
);
run(
  process.execPath,
  [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "build",
    browserRoot,
    "--base",
    "./",
    "--outDir",
    browserDist,
    "--emptyOutDir",
  ],
  { cwd: fixtureRoot },
);

const { browser, page, baseUrl } = await createBrowserTest();
try {
  const relativeBrowserPath = path
    .relative(root, path.join(browserDist, "index.html"))
    .split(path.sep)
    .join("/");
  await page.goto(`${baseUrl.replace(/\/$/, "")}/${relativeBrowserPath}`);
  await page.waitForFunction(
    () => document.querySelector("#result")?.textContent !== "LOADING",
  );
  assert.equal(await page.locator("#result").textContent(), "CORE_BROWSER_OK");
} finally {
  await browser.close();
}

console.log(
  "core package API baseline, tarball, declarations, clean Node install, and browser bundle passed",
);
