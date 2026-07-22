import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { probeBuiltInTopology } from "./lib/built-in-topology-probe.mjs";
import {
  APPLICATION_STORAGE_ROOTS,
  STORAGE_KEYS,
  STORAGE_PROTOCOL,
  STORAGE_ROOT_OWNERS,
} from "../src/application/browser-storage.js";
import {
  BlueprintAcquisition,
  normalizeBlueprintAcquisition,
  requiresExplicitProgramTrust,
} from "../src/model/blueprint-acquisition.js";
import { decodeBlueprint } from "../src/model/blueprint-decoder.js";
import {
  BLUEPRINT_VERSION,
  normalizeBlueprint,
} from "../src/model/blueprints.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { ReplayBuffer } from "../src/model/failure-analysis.js";
import {
  createSharePackage,
  decodeSharePackage,
  SHARE_VERSION,
} from "../src/model/share-packages.js";
import {
  decodeLocalSubassemblyLibrary,
  decodeSubassembly,
  SUBASSEMBLY_VERSION,
} from "../src/model/subassemblies.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";

const root = path.resolve(import.meta.dirname, ".."),
  specificationDirectory = path.join(
    root,
    "test",
    "fixtures",
    "strict-current-contract",
  );
async function fixture(name) {
  return JSON.parse(
    await fs.readFile(path.join(specificationDirectory, name), "utf8"),
  );
}

const blueprintSpec = await fixture("blueprint.spec.json"),
  workspaceSpec = await fixture("workspace.spec.json"),
  subassemblySpec = await fixture("subassembly.spec.json"),
  shareSpec = await fixture("share-package.spec.json"),
  proofSpec = await fixture("proof.spec.json"),
  storageSpec = await fixture("storage.spec.json"),
  auxiliarySpec = await fixture("auxiliary-contracts.spec.json");

assert.equal(blueprintSpec.version, 1);
assert.equal(workspaceSpec.version, 1);
assert.equal(subassemblySpec.version, 1);
assert.equal(shareSpec.version, 1);
assert.equal(proofSpec.proofVersion, 1);
assert.equal(storageSpec.pointer.protocolVersion, 1);
assert.deepEqual(Object.keys(storageSpec.manifest.roots).sort(), [
  "challengeBest",
  "challengeRecords",
  "discovery",
  "environmentPreferences",
  "executableTrust",
  "shareOrigins",
  "sharePackages",
  "shareSocial",
  "subassemblyLibrary",
  "workspace",
]);
assert.match(
  shareSpec.fingerprint,
  new RegExp(auxiliarySpec.fingerprint.wirePattern),
);
assert.deepEqual(Object.keys(auxiliarySpec.portDescriptor).sort(), [
  "behavior",
  "direction",
  "id",
  "kind",
  "multiplicity",
]);
assert.deepEqual(Object.keys(auxiliarySpec.physicalConnectionCapacity).sort(), [
  "ultimateForceN",
  "ultimateTorqueNm",
]);
assert.deepEqual(Object.keys(auxiliarySpec.decoderResults.success).sort(), [
  "errors",
  "item",
  "ok",
  "warnings",
]);
assert.deepEqual(Object.keys(auxiliarySpec.decoderResults.failure).sort(), [
  "errors",
  "item",
  "ok",
  "warnings",
]);

// These fixtures are permanent current-contract assertions for every portable
// and local boundary.
assert.equal(BLUEPRINT_VERSION, 1);
assert.equal(SUBASSEMBLY_VERSION, 1);
assert.equal(SHARE_VERSION, 1);
assert.equal(STORAGE_PROTOCOL.version, 1);
assert.deepEqual(
  APPLICATION_STORAGE_ROOTS,
  Object.keys(storageSpec.manifest.roots),
);
assert.deepEqual(STORAGE_ROOT_OWNERS, storageSpec.owners);
assert.equal(STORAGE_KEYS.subassemblies, "subassemblyLibrary");
const unsupportedBlueprint = structuredClone(blueprintSpec);
unsupportedBlueprint.version = 2;
assert.equal(decodeBlueprint(unsupportedBlueprint).ok, false);
assert.equal(
  decodeBlueprint(unsupportedBlueprint).errors[0].code,
  "UNSUPPORTED_BLUEPRINT_VERSION",
);
assert.equal(
  normalizeBlueprintAcquisition("unknown"),
  BlueprintAcquisition.UNKNOWN_UNTRUSTED,
);
assert.equal(
  requiresExplicitProgramTrust(BlueprintAcquisition.UNKNOWN_UNTRUSTED),
  true,
);
assert.equal(
  decodeLocalSubassemblyLibrary([{ base: "beam", name: "Old part" }])
    .diagnostics.length,
  1,
);
assert.equal(decodeSubassembly(subassemblySpec).ok, true);

const currentAsset = normalizeBlueprint(builtInDemo("gearbox").blueprint),
  currentPackage = await createSharePackage({
    kind: "blueprint",
    asset: currentAsset,
  });
const rawWrapped = await decodeSharePackage(currentAsset),
  unsupportedProofPackage = await decodeSharePackage({
    ...currentPackage,
    verification: [{ proofVersion: 2 }],
  });
assert.equal(rawWrapped.ok, false);
assert.equal(rawWrapped.errors[0].code, "INVALID_SHARE_PACKAGE");
assert.equal(unsupportedProofPackage.ok, true);
assert.equal(unsupportedProofPackage.item.verification.length, 0);
assert.equal(
  unsupportedProofPackage.warnings[0].code,
  "UNSUPPORTED_PROOF_VERSION",
);

// The raw producer probe is a permanent zero-violation invariant.
const topologyDebt = probeBuiltInTopology();
assert.deepEqual(topologyDebt, []);

// Telemetry is already complete at tick zero, after a completed fixed step,
// in the captured terminal snapshot, and when cloned into replay frames.
const startingAssembly = {
    revision: 9,
    parts: [
      {
        id: 1,
        type: "beam",
        pos: [0, 1, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: {},
      },
    ],
    connections: [],
  },
  session = new SimulationSession().start(startingAssembly),
  tickZero = session.telemetry();
function assertCompleteTelemetry(snapshot, label, { frozen = true } = {}) {
  assert.equal(snapshot.run.parts.length, 1, `${label} lost the run graph`);
  assert.equal(
    snapshot.bodies.bodyByPart.length,
    1,
    `${label} lost body bindings`,
  );
  assert.equal(
    snapshot.run.startAssemblyRevision,
    tickZero.run.startAssemblyRevision,
    `${label} lost assembly identity`,
  );
  if (frozen) assert.ok(Object.isFrozen(snapshot), `${label} is mutable`);
}
assert.equal(tickZero.tick, 0);
assertCompleteTelemetry(tickZero, "tick zero");
session.stepFixed();
const completedStep = session.telemetry();
assert.equal(completedStep.tick, 1);
assertCompleteTelemetry(completedStep, "completed step");
const terminalSnapshot = completedStep,
  replay = new ReplayBuffer({ sampleHz: 120 });
replay.record(tickZero, { force: true });
replay.record(completedStep, { force: true });
replay.record(terminalSnapshot, { force: true });
assertCompleteTelemetry(terminalSnapshot, "terminal snapshot");
for (let index = 0; index < replay.frames.length; index++)
  assertCompleteTelemetry(
    replay.frame(index).telemetry,
    `replay frame ${index}`,
    {
      frozen: false,
    },
  );
session.dispose();

console.log(
  `current contract baseline passed (zero producer topology violations, ${replay.frames.length} complete telemetry frames)`,
);
