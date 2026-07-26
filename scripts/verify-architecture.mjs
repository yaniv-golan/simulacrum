import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";

const root = path.resolve(import.meta.dirname, "..");
const simulationRoot = path.join(root, "src", "simulation");

async function filesBelow(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(target)));
    else if (entry.name.endsWith(".js")) files.push(target);
  }
  return files;
}

const files = await filesBelow(simulationRoot);
assert.ok(files.length > 0, "simulation modules must exist");
for (const file of files) {
  const source = await fs.readFile(file, "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:document|window)\b|querySelector|\$\(/,
    `${file} accesses presentation APIs`,
  );
  assert.doesNotMatch(
    source,
    /state\.demo\b/,
    `${file} dispatches physics by demo identity`,
  );
  assert.doesNotMatch(
    source,
    /\b(?:meteorPosition|meteorDistance|targetReached|groupStates)\b/,
    `${file} restored mission-target state inside simulation`,
  );
  assert.doesNotMatch(
    source,
    /\b(?:flightRuntime|ComponentFlightRuntime|flightStarted|launched|multirotor|statusDetail|flightStatus|missionStatus)\b/,
    `${file} restored broad flight or presentation-owned mission state`,
  );
  assert.doesNotMatch(
    source,
    /(?:\.mesh\b|classList|textContent|from\s+["']three["']|from\s+["'][^"']*presentation)/,
    `${file} depends on rendering or UI state`,
  );
  if (!file.endsWith(path.join("simulation", "cannon-world-adapter.js")))
    assert.doesNotMatch(
      source,
      /\b(?:this\.)?world\.step\s*\(/,
      `${file} bypasses the sole Cannon integration boundary`,
    );
  if (!file.endsWith(path.join("systems", "rigid-body-system.js")))
    assert.doesNotMatch(
      source,
      /worldAdapter\.integrate\s*\(|adapter\.integrate\s*\(/,
      `${file} invokes integration outside RigidBodySystem`,
    );
}

const numericFallbackOwners = [
  ...(await filesBelow(path.join(root, "src", "model"))),
  ...(await filesBelow(path.join(root, "src", "scripting"))),
  ...files,
];
for (const file of numericFallbackOwners) {
  if (file.endsWith(path.join("model", "finite-or.js"))) continue;
  const source = await fs.readFile(file, "utf8");
  assert.doesNotMatch(
    source,
    /Number\.isFinite\(Number\(\w+\)\)\s*\?\s*Number\(\w+\)\s*:\s*\w+/,
    `${file} duplicates the shared runtime finite fallback policy`,
  );
}

const physicalAssemblySystemSource = await fs.readFile(
  path.join(
    root,
    "src",
    "simulation",
    "systems",
    "physical-assembly-system.js",
  ),
  "utf8",
);
assert.doesNotMatch(
  physicalAssemblySystemSource,
  /\b(?:flightRuntime|ComponentFlightRuntime)\b/,
  "physical assembly telemetry must not initialize or own a flight runtime",
);

const physicalFlightModelSource = await fs.readFile(
  path.join(root, "src", "simulation", "physical-flight-model.js"),
  "utf8",
);
assert.doesNotMatch(
  physicalFlightModelSource,
  /runGraph\.connections\s*\(|\b(?:connection\.a|connection\.b)\b/,
  "physical-flight owners must consume canonical PhysicalAssemblyIndex identity rather than traverse connectivity privately",
);

const mainSource = await fs.readFile(path.join(root, "src", "main.js"), "utf8"),
  mainLines = mainSource.trim().split(/\r?\n/).length;
assert.ok(
  mainLines <= 300,
  `src/main.js must stay below 300 lines; found ${mainLines}`,
);
assert.doesNotMatch(
  mainSource,
  /\b(?:document|window)\b|querySelector|new\s+(?:World|Scene|WebGLRenderer)\b/,
  "src/main.js must contain startup wiring only",
);

const componentMeshFactorySource = await fs.readFile(
    path.join(root, "src", "presentation", "component-mesh-factory.js"),
    "utf8",
  ),
  componentMeshFactoryLines = componentMeshFactorySource
    .trim()
    .split(/\r?\n/).length;
assert.ok(
  componentMeshFactoryLines <= 120,
  `component mesh factory exceeded 120 lines; found ${componentMeshFactoryLines}`,
);
assert.doesNotMatch(
  componentMeshFactorySource,
  /\b(?:else\s+if|switch)\b|\btype\s*===|\bt\.(?:mechanism|teeth)\b/,
  "component mesh factory restored catalog-type dispatch instead of visual-kind registration",
);
const visualDescriptorSource = await fs.readFile(
  path.join(root, "src", "presentation", "component-visual-descriptor.js"),
  "utf8",
);
assert.doesNotMatch(
  visualDescriptorSource,
  /from\s+["'](?:three|cannon-es)["']|\b(?:document|window)\b/,
  "component visual descriptors must remain engine-neutral and DOM-free",
);
for (const file of await filesBelow(
  path.join(root, "src", "presentation", "component-visual-builders"),
)) {
  const source = await fs.readFile(file, "utf8");
  assert.doesNotMatch(
    source,
    /from\s+["'][^"']*(?:model|simulation|application)[^"']*["']|\b(?:document|window)\b/,
    `${path.relative(root, file)} crossed the descriptor-only visual-builder boundary`,
  );
}

const assemblyModelSource = await fs.readFile(
  path.join(root, "src", "model", "assembly-model.js"),
  "utf8",
);
assert.doesNotMatch(
  assemblyModelSource,
  /\.mesh\b|from\s+["']three["']|\b(?:document|window)\b/,
  "AssemblyModel must stay independent of rendering and UI runtimes",
);
for (const relativePath of [
  "src/model/primitives.js",
  "src/model/ports.js",
  "src/model/component-resolver.js",
  "src/model/geometry-descriptors.js",
  "src/model/assembly-compiler.js",
  "src/model/assembly-compiler-bodies.js",
  "src/model/assembly-compiler-capabilities.js",
  "src/model/assembly-compiler-constraints.js",
  "src/model/assembly-compiler-context.js",
  "src/model/assembly-compiler-finalize.js",
  "src/model/assembly-compiler-force-elements.js",
  "src/model/assembly-compiler-mass-properties.js",
  "src/model/assembly-compiler-shared.js",
  "src/model/assembly-compiler-topology.js",
  "src/model/blueprint-decoder.js",
  "src/model/mechanism-artifacts.js",
  "src/model/mechanism-authored-components.js",
  "src/model/actuator-contracts.js",
  "src/model/controller-bindings.js",
  "src/model/controller-policy.js",
  "src/model/control-program-ir.js",
  "src/model/finite-or.js",
  "src/simulation/run-assembly-graph.js",
  "src/simulation/body-registry.js",
  "src/simulation/simulation-context.js",
]) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:document|window|localStorage|sessionStorage)\b|from\s+["'](?:three|cannon-es|\.\.\/presentation|\.\.\/simulation)/,
    `${relativePath} crossed the reusable model boundary`,
  );
}
const compilerCoordinatorSource = await fs.readFile(
    path.join(root, "src", "model", "assembly-compiler.js"),
    "utf8",
  ),
  compilerCoordinatorLines = compilerCoordinatorSource
    .trim()
    .split(/\r?\n/).length,
  compilerCoordinatorBranches = (
    compilerCoordinatorSource.match(/\b(?:if|for|while|case)\b|&&|\|\|/g) || []
  ).length;
assert.ok(
  compilerCoordinatorLines <= 120,
  `assembly compiler coordinator exceeded 120 lines; found ${compilerCoordinatorLines}`,
);
assert.ok(
  compilerCoordinatorBranches <= 15,
  `assembly compiler coordinator exceeded complexity guard; found ${compilerCoordinatorBranches} branches`,
);
for (const relativePath of [
  "src/scripting/controller-runtime-manager.js",
  "src/scripting/controller-compilers.js",
  "src/scripting/typescript-control-compiler.js",
  "src/scripting/control-ir-wat.js",
  "src/scripting/wat-control-compiler.js",
]) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:document|window|localStorage|sessionStorage)\b|querySelector|classList|textContent|from\s+["'][^"']*(?:application|presentation)/,
    `${relativePath} crossed the reusable controller boundary`,
  );
  assert.doesNotMatch(
    source,
    /\bnew\s+Function\b|\beval\s*\(|\bnew\s+Worker\b|createObjectURL|\bBlob\b|setTimeout/,
    `${relativePath} regained dynamic JavaScript or asynchronous controller execution`,
  );
}
const storageSources = await Promise.all(
  (await filesBelow(path.join(root, "src"))).map(async (file) => ({
    file,
    source: await fs.readFile(file, "utf8"),
  })),
);
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\bFlightTruthAdapter\b|standalone-flight|shared-body-flight-view/,
    `${path.relative(root, file)} introduced an alternate flight truth adapter`,
  );
for (const { file, source } of storageSources) {
  if (file.endsWith(path.join("application", "browser-storage.js"))) continue;
  assert.doesNotMatch(
    source,
    /\blocalStorage\b|storage\.storage\b/,
    `${path.relative(root, file)} bypasses BrowserStorage`,
  );
}
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\b(?:poweredBattery|poweredControllerFor|poweredScriptControllersFor|globalCommand|controlConflicts|targetControlConflicts)\b|state\.commands\b/,
    `${path.relative(root, file)} restored a deleted parallel power or command authority`,
  );
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\bstate\.(?:mode|tool|cameraTool|selected|selectedIds|placing|connectFrom|connectPort|workspaceFocus)\b/,
    `${path.relative(root, file)} bypasses nested editor or UI state`,
  );
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\b(?:RoverRuntime|roverRuntime|beforeRoverIntegration|afterRoverIntegration|onRoverContact|hasRoverAssembly|hasArticulatedAssembly)\b/,
    `${path.relative(root, file)} restored the deleted compound rover body owner`,
  );
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\b(?:ArticulatedHumanoidRuntime|humanoidRuntime|articulatedRuntime|createHumanoidRig|destroyHumanoidRig)\b/,
    `${path.relative(root, file)} restored the deleted Atlas-specific body owner`,
  );
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\b(?:stanceLock|contactHeight|swingFoot\.applyForce)\b/,
    `${path.relative(root, file)} restored hidden humanoid contact or locomotion forces`,
  );
for (const { file, source } of storageSources)
  assert.doesNotMatch(
    source,
    /\b(?:FlightRuntime|RigidBodyAerothermalRuntime|stepIntegration|coupleFlightForce|flightRigidBodyPose|startGeneralMultibodyRuntime)\b/,
    `${path.relative(root, file)} restored a deleted flight pose owner or coupling adapter`,
  );
for (const generatedValidator of [
  "portable-machine-wire-validators",
  "share-wire-validators",
  "mechanism-artifact-wire-validators",
]) {
  const generatedValidatorSource = await fs.readFile(
    path.join(root, "src", "model", "generated", `${generatedValidator}.js`),
    "utf8",
  );
  assert.doesNotMatch(
    generatedValidatorSource,
    /^\s*import\b|\bAjv\w*\b|\bfrom\s+["']ajv(?:\/|["'])/m,
    `generated ${generatedValidator} module must remain standalone`,
  );
}
const failureAnalysisSource = (
  await Promise.all(
    ["failure-analysis.js", "failure-event-extractors.js"].map((file) =>
      fs.readFile(path.join(root, "src", "model", file), "utf8"),
    ),
  )
).join("\n");
assert.doesNotMatch(
  failureAnalysisSource,
  /\b(?:document|window)\b|from\s+["']three["']|\.mesh\b/,
  "failure analysis must remain a DOM-free immutable read model",
);
assert.doesNotMatch(
  failureAnalysisSource,
  /state\.demo\b|dispatchEvent|\.step(?:Fixed)?\s*\(/,
  "failure analysis must never dispatch on a demo or advance physics",
);
assert.doesNotMatch(
  failureAnalysisSource,
  /systems\??\.(?:flight|rover)|\b(?:flight|rover)\??\.(?:connections|parts|detachedParts|inWater|lastImpact)/,
  "failure analysis must consume universal bodies and run-graph state",
);
const challengeLabSource = (
  await Promise.all(
    [
      "challenge-lab.js",
      "challenge-evaluators.js",
      "challenge-reference-controls.js",
      "challenge-score.js",
    ].map((file) => fs.readFile(path.join(root, "src", "model", file), "utf8")),
  )
).join("\n");
assert.doesNotMatch(
  challengeLabSource,
  /\b(?:document|window|bestCandidate)\b|from\s+["']three["']|state\.demo\b|systems\??\.(?:rover|articulated)/,
  "challenge evaluation must remain a DOM-free capability model",
);
for (const relativePath of [
  "src/model/physical-components.js",
  "src/model/controller-debugger.js",
  "src/model/sensor-contracts.js",
  "src/model/visual-logic.js",
  "src/simulation/controller-sensors.js",
  "src/model/share-packages.js",
  "src/model/share-library.js",
  "src/model/share-codec.js",
]) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:document|window)\b|from\s+["']three["']|\.mesh\b|state\.demo\b/,
    `${relativePath} must remain reusable and presentation-independent`,
  );
}
const appSource = await fs.readFile(
  path.join(root, "src", "application", "simulacrum-app.js"),
  "utf8",
);
const appLines = appSource.trim().split(/\r?\n/).length;
assert.ok(
  appLines < 300,
  `application coordinator must continue shrinking; found ${appLines} lines`,
);
const appImportCount = (appSource.match(/^import\s/gm) || []).length,
  appBranchCount = (appSource.match(/\b(?:if|for|while|case)\b|&&|\|\|/g) || [])
    .length,
  appFunctionCount = (appSource.match(/\bfunction\b|=>/g) || []).length;
assert.ok(
  appImportCount <= 8,
  `application coordinator dependency ratchet failed; found ${appImportCount}`,
);
assert.ok(
  appBranchCount <= 4,
  `application coordinator branch ratchet failed; found ${appBranchCount}`,
);
assert.ok(
  appFunctionCount <= 32,
  `application coordinator function ratchet failed; found ${appFunctionCount}`,
);
assert.match(
  appSource,
  /createWorkshopControllerComposition[\s\S]*createWorkshopExperienceComposition/,
  "controller and learning-center use cases must remain extracted",
);
assert.doesNotMatch(
  appSource,
  /function\s+(?:compileWat|compileTypeScript|compileVisual|renderLearningCenter|renderDiscoveryCoach|runLearningAction|captureBuildState|restoreBuildState|refreshHistoryUI|loadDemo|startChallenge|updateChallenge|setTimeOfDay|setWindEnabled|updateEnvironmentVisuals)\b/,
  "application coordinator reabsorbed an extracted controller or learning use case",
);
assert.match(
  appSource,
  /createWorkshopBuildComposition/,
  "build persistence and history transactions must remain extracted",
);
const buildPersistenceSource = await fs.readFile(
  path.join(root, "src", "application", "build-persistence-subsystem.js"),
  "utf8",
);
const workshopBuildCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-build-composition.js"),
  "utf8",
);
assert.ok(
  workshopBuildCompositionSource.trim().split(/\r?\n/).length <= 130,
  "workshop build composition exceeded bounded adapter ownership",
);
assert.doesNotMatch(
  workshopBuildCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop build composition crossed into demo dispatch or simulation ownership",
);
assert.ok(
  buildPersistenceSource.trim().split(/\r?\n/).length <= 190,
  "build persistence composition exceeded bounded ownership",
);
assert.doesNotMatch(
  buildPersistenceSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "build persistence composition crossed into ambient DOM or simulation",
);
const buildHistorySource = await fs.readFile(
  path.join(root, "src", "application", "build-history-feature.js"),
  "utf8",
);
assert.doesNotMatch(
  buildHistorySource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo\b/,
  "build history crossed into DOM presentation or demo dispatch",
);
assert.ok(
  buildHistorySource.trim().split(/\r?\n/).length <= 240,
  "build history exceeded bounded use-case ownership",
);
const demoChallengeSource = await fs.readFile(
  path.join(root, "src", "application", "demo-challenge-feature.js"),
  "utf8",
);
assert.doesNotMatch(
  demoChallengeSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|new\s+(?:SimulationSession|ComponentFlightRuntime)|state\.demo\b/,
  "demo/challenge use case crossed into DOM or physics dispatch",
);
assert.ok(
  demoChallengeSource.trim().split(/\r?\n/).length <= 320,
  "demo/challenge use case exceeded bounded ownership",
);
const environmentPresentationSource = await fs.readFile(
  path.join(root, "src", "presentation", "environment-presentation.js"),
  "utf8",
);
assert.ok(
  environmentPresentationSource.trim().split(/\r?\n/).length <= 180,
  "environment presentation exceeded bounded ownership",
);
assert.doesNotMatch(
  appSource,
  /\b(?:ShareLibrary|normalizeSharePackage|persistShareLibrary|alternateSaved|alternateRemoved)\b|STORAGE_KEYS\.share(?:Packages|Social|Origins|Tombstones)/,
  "application coordinator reabsorbed Blueprint Exchange domain or persistence policy",
);
const cameraInteractionSource = await fs.readFile(
  path.join(root, "src", "presentation", "camera-interaction-controller.js"),
  "utf8",
);
assert.ok(
  cameraInteractionSource.trim().split(/\r?\n/).length <= 500,
  "camera interaction controller exceeded bounded ownership",
);
assert.doesNotMatch(
  cameraInteractionSource,
  /applyEditorAction|state\.parts|state\.selected|state\.running|function\s+(?:connect|selectPart|addPart)\b/,
  "camera interaction controller crossed into assembly/editor mutation",
);
const workshopPointerSource = await fs.readFile(
  path.join(root, "src", "presentation", "workshop-pointer-controller.js"),
  "utf8",
);
assert.ok(
  workshopPointerSource.trim().split(/\r?\n/).length <= 225,
  "workshop pointer controller exceeded bounded gesture ownership",
);
assert.doesNotMatch(
  workshopPointerSource,
  /applyEditorAction|state\.(?:parts|connections|selected|placing)|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop pointer controller crossed into editor state or simulation",
);
const workshopUiSource = await fs.readFile(
  path.join(root, "src", "presentation", "workshop-ui-presenter.js"),
  "utf8",
);
assert.ok(
  workshopUiSource.trim().split(/\r?\n/).length <= 110,
  "workshop UI presenter exceeded shared-chrome ownership",
);
assert.doesNotMatch(
  workshopUiSource,
  /\b(?:document|window)\b|querySelector|state\.|new\s+(?:World|SimulationSession|CANNON\.)/,
  "workshop UI presenter crossed into DOM lookup, application state, or simulation",
);
const editorSelectionSource = await fs.readFile(
  path.join(root, "src", "application", "editor-selection-feature.js"),
  "utf8",
);
const capabilityReaderSource = await fs.readFile(
  path.join(root, "src", "application", "assembly-capability-reader.js"),
  "utf8",
);
assert.ok(
  capabilityReaderSource.trim().split(/\r?\n/).length <= 100,
  "assembly capability reader exceeded bounded query ownership",
);
assert.doesNotMatch(
  capabilityReaderSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo|new\s+(?:World|SimulationSession|CANNON\.)/,
  "assembly capability reader crossed into presentation, demo dispatch, or simulation ownership",
);
const assemblyWorkspaceSource = await fs.readFile(
  path.join(root, "src", "application", "assembly-workspace.js"),
  "utf8",
);
assert.ok(
  assemblyWorkspaceSource.trim().split(/\r?\n/).length <= 180,
  "assembly workspace exceeded bounded adapter ownership",
);
assert.doesNotMatch(
  assemblyWorkspaceSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo|new\s+(?:World|SimulationSession|CANNON\.)/,
  "assembly workspace crossed into DOM, demo dispatch, or simulation ownership",
);
const workshopAssemblyFeatureSource = await fs.readFile(
  path.join(
    root,
    "src",
    "application",
    "workshop-assembly-feature-subsystem.js",
  ),
  "utf8",
);
for (const [file, maximumLines, label] of [
  ["workshop-assembly-composition.js", 100, "assembly adapter"],
  ["workshop-controller-composition.js", 50, "controller adapter"],
  ["workshop-mode-controller.js", 30, "mode controller"],
]) {
  const source = await fs.readFile(
    path.join(root, "src", "application", file),
    "utf8",
  );
  assert.ok(
    source.trim().split(/\r?\n/).length <= maximumLines,
    `workshop ${label} exceeded bounded ownership`,
  );
  assert.doesNotMatch(
    source,
    /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
    `workshop ${label} crossed into demo dispatch or simulation integration`,
  );
}
assert.ok(
  workshopAssemblyFeatureSource.trim().split(/\r?\n/).length <= 220,
  "workshop assembly-feature composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopAssemblyFeatureSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop assembly-feature composition crossed into ambient DOM or simulation",
);
const workshopShellSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-shell-subsystem.js"),
  "utf8",
);
assert.ok(
  workshopShellSource.trim().split(/\r?\n/).length <= 100,
  "workshop shell exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopShellSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop shell crossed into demo dispatch or simulation ownership",
);
const workshopRuntimeCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-runtime-composition.js"),
  "utf8",
);
assert.ok(
  workshopRuntimeCompositionSource.trim().split(/\r?\n/).length <= 130,
  "workshop runtime composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopRuntimeCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop runtime composition crossed into demo dispatch or simulation ownership",
);
const workshopInputCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-input-composition.js"),
  "utf8",
);
assert.ok(
  workshopInputCompositionSource.trim().split(/\r?\n/).length <= 110,
  "workshop input composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopInputCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop input composition crossed into demo dispatch or simulation ownership",
);
const workshopRunCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-run-composition.js"),
  "utf8",
);
const workshopUiCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-ui-composition.js"),
  "utf8",
);
const workshopEditorStageCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-editor-stage-composition.js"),
  "utf8",
);
const workshopExperienceCompositionSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-experience-composition.js"),
  "utf8",
);
assert.ok(
  workshopExperienceCompositionSource.trim().split(/\r?\n/).length <= 100,
  "workshop experience composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopExperienceCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop experience composition crossed into demo dispatch or simulation integration",
);
assert.ok(
  workshopEditorStageCompositionSource.trim().split(/\r?\n/).length <= 200,
  "workshop editor/stage composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopEditorStageCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop editor/stage composition crossed into demo dispatch or simulation integration",
);
assert.ok(
  workshopUiCompositionSource.trim().split(/\r?\n/).length <= 80,
  "workshop UI composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopUiCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop UI composition crossed into demo dispatch or simulation ownership",
);
assert.ok(
  workshopRunCompositionSource.trim().split(/\r?\n/).length <= 280,
  "workshop run composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopRunCompositionSource,
  /state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop run composition crossed into demo-based physics or direct integration",
);
const debugReadModelSource = await fs.readFile(
  path.join(root, "src", "application", "debug-read-model-feature.js"),
  "utf8",
);
assert.ok(
  debugReadModelSource.trim().split(/\r?\n/).length <= 240,
  "debug read-model feature exceeded bounded projection ownership",
);
assert.doesNotMatch(
  debugReadModelSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "debug read-model feature crossed into DOM or simulation mutation",
);
const controllerSubsystemSource = await fs.readFile(
  path.join(root, "src", "application", "controller-subsystem.js"),
  "utf8",
);
assert.ok(
  controllerSubsystemSource.trim().split(/\r?\n/).length <= 100,
  "controller subsystem exceeded bounded composition ownership",
);
assert.doesNotMatch(
  controllerSubsystemSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo|new\s+(?:Worker|Blob|Function)|eval\s*\(/,
  "controller subsystem crossed into DOM, demo dispatch, or dynamic execution",
);
const workshopControllerWorkspaceSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-controller-workspace.js"),
  "utf8",
);
assert.ok(
  workshopControllerWorkspaceSource.trim().split(/\r?\n/).length <= 100,
  "workshop controller workspace exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopControllerWorkspaceSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:Worker|Blob|Function|World|SimulationSession)|eval\s*\(/,
  "workshop controller workspace crossed into ambient DOM, demo dispatch, or dynamic execution",
);
const controlSurfaceSource = await fs.readFile(
  path.join(root, "src", "application", "control-surface-subsystem.js"),
  "utf8",
);
assert.ok(
  controlSurfaceSource.trim().split(/\r?\n/).length <= 120,
  "control-surface composition exceeded bounded ownership",
);
assert.doesNotMatch(
  controlSurfaceSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "control-surface composition crossed into ambient DOM or simulation",
);
const editorInputSource = await fs.readFile(
  path.join(root, "src", "application", "editor-input-subsystem.js"),
  "utf8",
);
assert.ok(
  editorInputSource.trim().split(/\r?\n/).length <= 170,
  "editor input composition exceeded bounded ownership",
);
assert.doesNotMatch(
  editorInputSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)/,
  "editor input composition crossed into ambient DOM or simulation",
);
const workshopUseCaseSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-use-case-subsystem.js"),
  "utf8",
);
assert.ok(
  workshopUseCaseSource.trim().split(/\r?\n/).length <= 175,
  "workshop use-case composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopUseCaseSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop use-case composition crossed into ambient DOM or simulation",
);
const earthStreamingSource = await fs.readFile(
  path.join(root, "src", "application", "earth-streaming-controller.js"),
  "utf8",
);
assert.ok(
  earthStreamingSource.trim().split(/\r?\n/).length <= 80,
  "Earth streaming controller exceeded floating-origin ownership",
);
assert.doesNotMatch(
  earthStreamingSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["'](?:three|cannon-es)/,
  "Earth streaming controller crossed into DOM, global state, or engine ownership",
);
const workshopPhysicsSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-physics-world.js"),
  "utf8",
);
assert.ok(
  workshopPhysicsSource.trim().split(/\r?\n/).length <= 100,
  "workshop physics-world construction exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopPhysicsSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["']three/,
  "workshop physics-world construction crossed into presentation or global state",
);
const workshopStateSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-state.js"),
  "utf8",
);
assert.ok(
  workshopStateSource.trim().split(/\r?\n/).length <= 120,
  "workshop state factory exceeded bounded initialization ownership",
);
assert.doesNotMatch(
  workshopStateSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)/,
  "workshop state factory crossed into DOM or simulation ownership",
);
const worldPresentationSource = await fs.readFile(
  path.join(root, "src", "application", "world-presentation-subsystem.js"),
  "utf8",
);
assert.ok(
  worldPresentationSource.trim().split(/\r?\n/).length <= 210,
  "world presentation composition exceeded bounded ownership",
);
assert.doesNotMatch(
  worldPresentationSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession)/,
  "world presentation composition crossed into ambient DOM or demo physics dispatch",
);
const workshopPlatformSource = await fs.readFile(
  path.join(root, "src", "presentation", "workshop-platform.js"),
  "utf8",
);
assert.ok(
  workshopPlatformSource.trim().split(/\r?\n/).length <= 70,
  "workshop platform exceeded bounded scene ownership",
);
assert.doesNotMatch(
  workshopPlatformSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["']cannon-es/,
  "workshop platform crossed into DOM, global state, or physics ownership",
);
const transformGizmoSource = await fs.readFile(
  path.join(root, "src", "presentation", "transform-gizmo-controller.js"),
  "utf8",
);
assert.ok(
  transformGizmoSource.trim().split(/\r?\n/).length <= 100,
  "transform gizmo controller exceeded bounded interaction ownership",
);
assert.doesNotMatch(
  transformGizmoSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["']cannon-es|new\s+(?:World|SimulationSession)/,
  "transform gizmo controller crossed into DOM, global state, or simulation",
);
const transformGizmoOperationSource = await fs.readFile(
  path.join(root, "src", "presentation", "transform-gizmo-operation.js"),
  "utf8",
);
assert.ok(
  transformGizmoOperationSource.trim().split(/\r?\n/).length <= 140,
  "transform gizmo operation exceeded bounded transaction ownership",
);
assert.doesNotMatch(
  transformGizmoOperationSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["']cannon-es|new\s+(?:World|SimulationSession)/,
  "transform gizmo operation crossed into DOM, global state, or simulation",
);
const transformControlsDomAdapterSource = await fs.readFile(
  path.join(root, "src", "presentation", "transform-controls-dom-adapter.js"),
  "utf8",
);
assert.ok(
  transformControlsDomAdapterSource.trim().split(/\r?\n/).length <= 90,
  "transform controls DOM adapter exceeded bounded lifecycle ownership",
);
assert.doesNotMatch(
  transformControlsDomAdapterSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["']cannon-es|new\s+(?:World|SimulationSession)/,
  "transform controls DOM adapter crossed into globals, state, or simulation",
);
const transformGizmoTargetProjectionSource = await fs.readFile(
  path.join(
    root,
    "src",
    "presentation",
    "transform-gizmo-target-projection.js",
  ),
  "utf8",
);
assert.ok(
  transformGizmoTargetProjectionSource.trim().split(/\r?\n/).length <= 80,
  "transform gizmo target projection exceeded bounded read ownership",
);
assert.doesNotMatch(
  transformGizmoTargetProjectionSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.|from\s+["']cannon-es|new\s+(?:World|SimulationSession)/,
  "transform gizmo target projection crossed into DOM, state, or simulation",
);
assert.ok(
  editorSelectionSource.trim().split(/\r?\n/).length <= 260,
  "editor selection feature exceeded bounded ownership",
);
assert.doesNotMatch(
  editorSelectionSource,
  /state\.parts|state\.connections|new\s+(?:SimulationSession|CANNON\.)|\.step\s*\(/,
  "editor selection feature crossed into global state or simulation",
);
const editorConnectionSource = await fs.readFile(
  path.join(root, "src", "application", "editor-connection-feature.js"),
  "utf8",
);
assert.ok(
  editorConnectionSource.trim().split(/\r?\n/).length <= 500,
  "editor connection feature exceeded bounded ownership",
);
assert.doesNotMatch(
  editorConnectionSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.parts|state\.connections|new\s+(?:SimulationSession|CANNON\.)|\.step\s*\(/,
  "editor connection feature crossed into global UI state or simulation",
);
const editorPresentationSubsystemSource = await fs.readFile(
  path.join(root, "src", "application", "editor-presentation-subsystem.js"),
  "utf8",
);
assert.ok(
  editorPresentationSubsystemSource.trim().split(/\r?\n/).length <= 180,
  "editor presentation subsystem exceeded bounded composition ownership",
);
assert.doesNotMatch(
  editorPresentationSubsystemSource,
  /\b(?:document|window)\b|querySelector|state\.demo|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "editor presentation subsystem crossed into DOM lookup, demo dispatch, or simulation",
);
const workshopEditorPresentationSource = await fs.readFile(
  path.join(
    root,
    "src",
    "application",
    "workshop-editor-presentation-subsystem.js",
  ),
  "utf8",
);
assert.ok(
  workshopEditorPresentationSource.trim().split(/\r?\n/).length <= 180,
  "workshop editor-presentation composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopEditorPresentationSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)|\.step\s*\(/,
  "workshop editor-presentation composition crossed into ambient DOM or simulation",
);
const componentInspectorSource = await fs.readFile(
  path.join(root, "src", "presentation", "component-inspector-controller.js"),
  "utf8",
);
assert.ok(
  componentInspectorSource.trim().split(/\r?\n/).length <= 430,
  "component inspector controller exceeded bounded ownership",
);
assert.doesNotMatch(
  componentInspectorSource,
  /state\.parts|state\.connections|new\s+(?:SimulationSession|CANNON\.)|\.step\s*\(/,
  "component inspector crossed into global state or simulation",
);
const explodedViewSource = await fs.readFile(
  path.join(root, "src", "presentation", "exploded-view-controller.js"),
  "utf8",
);
assert.ok(
  explodedViewSource.trim().split(/\r?\n/).length <= 200,
  "exploded-view controller exceeded bounded ownership",
);
assert.doesNotMatch(
  explodedViewSource,
  /state\.parts|state\.connections|new\s+(?:SimulationSession|CANNON\.)|\.step\s*\(/,
  "exploded-view controller crossed into global state or simulation",
);
const directControlSource = await fs.readFile(
  path.join(root, "src", "application", "direct-control-feature.js"),
  "utf8",
);
assert.ok(
  directControlSource.trim().split(/\r?\n/).length <= 420,
  "direct-control feature exceeded bounded ownership",
);
assert.doesNotMatch(
  directControlSource,
  /state\.parts|state\.connections|new\s+(?:SimulationSession|CANNON\.)|\.step\s*\(/,
  "direct-control feature crossed into global state or simulation",
);
const assemblyEditorSource = await fs.readFile(
  path.join(root, "src", "application", "assembly-editor-feature.js"),
  "utf8",
);
assert.ok(
  assemblyEditorSource.trim().split(/\r?\n/).length <= 360,
  "assembly editor feature exceeded bounded ownership",
);
assert.doesNotMatch(
  assemblyEditorSource,
  /state\.parts|state\.connections|new\s+(?:SimulationSession|CANNON\.)|\.step\s*\(/,
  "assembly editor crossed into global state or simulation",
);
for (const [relativePath, maximumLines] of Object.entries({
  "src/application/keyboard-shortcut-controller.js": 240,
  "src/application/workshop-runtime-loop.js": 130,
  "src/presentation/simulation-telemetry-presenter.js": 275,
  "src/presentation/tutorial-controller.js": 150,
  "src/presentation/workshop-command-controller.js": 190,
})) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  assert.ok(
    source.trim().split(/\r?\n/).length <= maximumLines,
    `${relativePath} exceeded bounded ownership`,
  );
  assert.doesNotMatch(
    source,
    /@(?:param|type|returns?)\s*\{[^}]*\b(?:any|Function)\b/,
    `${relativePath} contains an untyped boundary`,
  );
}
for (const relativePath of [
  "src/application/build-history-feature.js",
  "src/application/controller-editor-feature.js",
  "src/application/controller-lifecycle-feature.js",
  "src/application/demo-challenge-feature.js",
  "src/application/simulation-lifecycle-feature.js",
]) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /@(?:param|type|returns?)\s*\{[^}]*\b(?:any|Function)\b/,
    `${relativePath} contains an untyped boundary`,
  );
}
assert.doesNotMatch(
  appSource,
  /function\s+(?:zoomCamera|frameSelection|toggleCameraFollow|setAxisView|setCameraTool|resetView|showSelection|showHover|selectPart|updateSelectionVisuals|snapConnection|connectionValid|drawWires|meshPitchDistance|propertiesFor|renderInspector|setExplodedView|updateExplodedView|applyDriveInput|cartControl)\b/,
  "application coordinator reabsorbed extracted editor presentation ownership",
);
assert.match(
  appSource,
  /createWorkshopRunComposition/,
  "simulation lifecycle use case must remain extracted",
);
const simulationLifecycleSource = await fs.readFile(
    path.join(root, "src", "application", "simulation-lifecycle-feature.js"),
    "utf8",
  ),
  simulationSystemCompositionSource = await fs.readFile(
    path.join(root, "src", "application", "simulation-system-composition.js"),
    "utf8",
  );
assert.match(
  simulationSystemCompositionSource,
  /new\s+PowerSystem\(\)[\s\S]*new\s+SignalSystem\(\)[\s\S]*new\s+CommandRoutingSystem\(\)[\s\S]*new\s+CommandReceiverSystem\(\)[\s\S]*new\s+MechanismSystem\(\)/,
  "production systems must resolve power, signals, target-scoped commands, and physical receivers before actuators",
);
assert.doesNotMatch(
  simulationLifecycleSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo\b/,
  "simulation lifecycle crossed into DOM presentation or demo dispatch",
);
assert.ok(
  simulationLifecycleSource.trim().split(/\r?\n/).length <= 400,
  "simulation lifecycle exceeded bounded use-case ownership",
);
const simulationRuntimeStateSource = await fs.readFile(
  path.join(root, "src", "application", "simulation-runtime-state.js"),
  "utf8",
);
assert.ok(
  simulationRuntimeStateSource.trim().split(/\r?\n/).length <= 30,
  "simulation runtime state exceeded bounded ownership",
);
assert.doesNotMatch(
  simulationRuntimeStateSource,
  /\b(?:document|window)\b|querySelector|classList|textContent|state\.demo\b|from\s+["'](?:three|cannon-es)["']/,
  "simulation runtime state crossed into DOM, demo dispatch, or engine ownership",
);
const workshopSimulationSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-simulation-subsystem.js"),
  "utf8",
);
assert.ok(
  workshopSimulationSource.trim().split(/\r?\n/).length <= 90,
  "workshop simulation composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopSimulationSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)/,
  "workshop simulation composition crossed into ambient DOM or demo physics dispatch",
);
const workshopRuntimeSubsystemSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-runtime-subsystem.js"),
  "utf8",
);
assert.ok(
  workshopRuntimeSubsystemSource.trim().split(/\r?\n/).length <= 100,
  "workshop runtime composition exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopRuntimeSubsystemSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.demo\s*===|new\s+(?:World|SimulationSession|CANNON\.)/,
  "workshop runtime composition crossed into ambient DOM or demo physics dispatch",
);
const workshopStageFoundationSource = await fs.readFile(
  path.join(root, "src", "application", "workshop-stage-foundation.js"),
  "utf8",
);
assert.ok(
  workshopStageFoundationSource.trim().split(/\r?\n/).length <= 70,
  "workshop stage foundation exceeded bounded ownership",
);
assert.doesNotMatch(
  workshopStageFoundationSource,
  /(?<![-/])\b(?:document|window)\.|querySelector|classList|textContent|state\.|state\.demo|new\s+SimulationSession|\.step\s*\(/,
  "workshop stage foundation crossed into ambient DOM or live simulation",
);
assert.doesNotMatch(
  appSource,
  /function\s+createAtmosphericLandmarks\b|\b(?:roughnessLengthM|frictionVelocity|visualAtmosphericDensity)\b/,
  "application coordinator reabsorbed atmospheric presentation or wind-field policy",
);
assert.doesNotMatch(
  appSource,
  /function\s+createFieldEnvironment\b|function\s+terrainTexture\b|\bgrassBladeCount\b/,
  "application coordinator reabsorbed authored-field construction",
);
const localFieldFeatureSource = await fs.readFile(
  path.join(root, "src", "application", "local-field-feature.js"),
  "utf8",
);
assert.doesNotMatch(
  localFieldFeatureSource,
  /state\.demo\b|from\s+["'][^"']*simulacrum-app|querySelector|classList|textContent/,
  "local field feature must remain reusable composition without game or UI state",
);
for (const relativePath of [
  "src/application/share-exchange-service.js",
  "src/application/share-exchange-repository.js",
]) {
  const source = await fs.readFile(path.join(root, relativePath), "utf8");
  assert.doesNotMatch(
    source,
    /\b(?:document|window|localStorage|sessionStorage|navigator|location|history)\b|querySelector|classList|textContent|from\s+["'][^"']*presentation/,
    `${relativePath} must remain independent of DOM, browser globals, and presentation`,
  );
}
const exchangePresenterSource = await fs.readFile(
  path.join(root, "src", "presentation", "blueprint-exchange.js"),
  "utf8",
);
assert.doesNotMatch(
  exchangePresenterSource,
  /from\s+["'][^"']*(?:model\/share-|application\/share-)|\b(?:ShareLibrary|createSharePackage|normalizeSharePackage|localStorage|storage\.)\b/,
  "Blueprint Exchange presenter must render view models and emit intents only",
);
const mechanismSource = await fs.readFile(
  path.join(root, "src", "simulation", "systems", "mechanism-system.js"),
  "utf8",
);
assert.doesNotMatch(
  mechanismSource,
  /Math\.sin\s*\(\s*context\.time|spinDelta|axialScale|scaleY|jointAngle|\.(?:phase)\s*=/,
  "mechanism system retained illustrative or phase-copy animation",
);
assert.doesNotMatch(
  appSource,
  /simulateMissionPhysics|simulateComponentResolvedFlight|simulateRigidBodyAerothermal|applyAssemblyImpactLoad|stepPoweredFlight|stepCoupledPhysicalWorld|demoVelocity|demoLaunched/,
  "application coordinator retained an obsolete physics implementation",
);
assert.doesNotMatch(
  appSource,
  /attachScriptWorker|\.worker\b|\.start\(\)|watchdogMs|controllerRuntimeManager\.(?:attach|tick)\(\s*state\.scriptControllerId/,
  "application coordinator regained worker timing or selection-scoped controller execution",
);
assert.doesNotMatch(
  appSource,
  /challenge\.id\s*===|activeChallenge\s*===/,
  "challenge evaluation dispatches on challenge identity",
);
assert.doesNotMatch(
  appSource,
  /simulationSession(?:\?|)\.context/,
  "presentation must consume SimulationSession.telemetry(), not mutable context",
);
assert.doesNotMatch(
  appSource,
  /new\s+THREE\.(?:Scene|PerspectiveCamera|WebGLRenderer)/,
  "scene construction belongs in presentation modules",
);
const styleEntry = await fs.readFile(
  path.join(root, "src", "style.css"),
  "utf8",
);
assert.match(
  styleEntry,
  /styles\/remote-camera\.css/,
  "panel-level stylesheet boundaries are missing",
);
const templateEntry = await fs.readFile(
  path.join(root, "src", "presentation", "ui-template.js"),
  "utf8",
);
assert.match(
  templateEntry,
  /templates\/workshop-panels\.js[\s\S]*createWorkshopPanels/,
  "workshop HTML was not split into panel-level presentation modules",
);
assert.ok(
  templateEntry.trim().split(/\r?\n/).length <= 20,
  "UI template entry must remain a small composition root",
);
for (const compositionPath of [
  "src/presentation/templates/workshop-panels.js",
  "src/presentation/templates/learning-panels.js",
  "src/presentation/templates/overlays.js",
]) {
  const source = await fs.readFile(path.join(root, compositionPath), "utf8");
  assert.ok(
    source.trim().split(/\r?\n/).length <= 30,
    `${compositionPath} must remain a small composition root`,
  );
  assert.doesNotMatch(
    source,
    /<(?:section|aside|header|div|button)\b/,
    `${compositionPath} reabsorbed panel markup`,
  );
}
const panelDirectory = path.join(
    root,
    "src",
    "presentation",
    "templates",
    "panels",
  ),
  panelFiles = (await fs.readdir(panelDirectory)).filter((file) =>
    file.endsWith(".js"),
  );
assert.ok(panelFiles.length >= 18, "panel-level template ownership regressed");
for (const file of panelFiles) {
  const source = await fs.readFile(path.join(panelDirectory, file), "utf8"),
    exports = source.match(/export\s+function\s+create\w+Template/g) || [];
  assert.equal(
    exports.length,
    1,
    `${file} must own exactly one panel template`,
  );
  assert.ok(
    source.trim().split(/\r?\n/).length <= 80,
    `${file} exceeded its bounded panel ownership`,
  );
}

const packageJson = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
assert.ok(packageJson.scripts.test, "package.json must expose npm test");
const verificationFiles = (await fs.readdir(path.join(root, "scripts")))
  .filter((file) => /^verify-.*\.mjs$/.test(file))
  .map((file) => path.join(root, "scripts", file));
for (const file of verificationFiles) {
  const source = await fs.readFile(file, "utf8");
  if (!/page\.goto\s*\(/.test(source)) continue;
  assert.match(
    source,
    /from\s+["']\.\/lib\/browser-test\.mjs["']/,
    `${file} bypasses the shared browser fixture`,
  );
  assert.doesNotMatch(
    source,
    /from\s+["']playwright["']|https?:\/\/(?:localhost|127\.0\.0\.1):5173/,
    `${file} owns Playwright or a fixed test server`,
  );
}
console.log(`architecture guard passed (${files.length} simulation modules)`);
