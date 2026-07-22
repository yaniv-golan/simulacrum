import { assert } from "./lib/assert.mjs";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import {
  createSharePackage,
  decodeSharePackage,
  fingerprintAsset,
  SHARE_VERSION,
  verificationForAsset,
} from "../src/model/share-packages.js";
import { ShareLibrary } from "../src/model/share-library.js";
import {
  createSubassemblyTemplate,
  decodeSubassembly,
  SUBASSEMBLY_VERSION,
} from "../src/model/subassemblies.js";

const blueprint = builtInDemo("cart").blueprint;
const rootPart = blueprint.parts[0];
const controller = blueprint.parts.find((part) => part.type === "computer");
const fingerprint = await fingerprintAsset("blueprint", blueprint);
const proof = {
  proofVersion: 1,
  challengeVersion: 1,
  challengeId: "field-trial",
  assetFingerprint: fingerprint,
  score: 8200,
  solution: "GROUND VEHICLE",
  recordedAt: "2026-07-17T00:00:00.000Z",
  binding: {
    kind: "component",
    policyVersion: 1,
    rootPartId: rootPart.id,
    initialComponentId: `component:${rootPart.id}`,
  },
  terminal: {
    criteria: [{ id: "distance", met: true, current: "31 M", target: "30 M" }],
    metrics: {
      massKg: 180,
      partCount: blueprint.parts.length,
      energyUsed: 8,
      damage: 0,
      worstFatigue: 0.1,
      apexM: 0,
      touchedWater: false,
      payloadSecured: false,
    },
  },
  environment: {
    seed: "earth-coordinate-terrain-v1",
    latitude: 32,
    longitude: 35,
    timeOfDay: 14,
    windEnabled: true,
  },
  controllerPrograms: controller
    ? [{ partId: controller.id, digest: "b".repeat(64) }]
    : [],
};

const shared = await createSharePackage({
  kind: "blueprint",
  asset: blueprint,
  metadata: {
    title: "Field Rover",
    description: "A suspension rover for cargo challenges.",
    tags: "rover, cargo, beginner, rover",
    creator: "Workshop Pilot",
    createdAt: "2026-07-17T00:00:00.000Z",
    extensions: { "com.example.card": { density: "compact" } },
  },
  verification: [proof],
});

assert.equal(SHARE_VERSION, 1);
assert.equal(shared.fingerprint, fingerprint);
assert.match(shared.fingerprint, /^sim-sha256-[0-9a-f]{64}$/);
assert.deepEqual(shared.metadata.tags, ["rover", "cargo", "beginner"]);
assert.equal(shared.verification.length, 1);
assert.equal(shared.verification[0].binding.kind, "component");
assert.equal(shared.verification[0].terminal.criteria[0].met, true);

const decoded = await decodeSharePackage(JSON.stringify(shared));
assert.equal(decoded.ok, true);
assert.deepEqual(decoded.warnings, []);
assert.equal(decoded.item.fingerprint, fingerprint);

assert.equal(
  await fingerprintAsset("blueprint", {
    ...blueprint,
    name: "Renamed",
    created: "2026-07-18T00:00:00.000Z",
    demo: "gearbox",
  }),
  fingerprint,
  "display metadata changed engineering identity",
);
const moved = structuredClone(blueprint);
moved.parts[0].pos[0] += 0.25;
assert.notEqual(await fingerprintAsset("blueprint", moved), fingerprint);
const retuned = structuredClone(blueprint);
const battery = retuned.parts.find((part) => part.type === "battery");
battery.config.capacityWh += 1;
assert.notEqual(await fingerprintAsset("blueprint", retuned), fingerprint);
const extended = structuredClone(blueprint);
extended.extensions = { "com.example.behavior": { policy: 2 } };
assert.notEqual(await fingerprintAsset("blueprint", extended), fingerprint);
const remoteChanged = structuredClone(blueprint);
remoteChanged.remoteProfiles.cart.controls[0].defaultValue = 0.25;
assert.notEqual(
  await fingerprintAsset("blueprint", remoteChanged),
  fingerprint,
);
if (controller) {
  const reprogrammed = structuredClone(blueprint);
  reprogrammed.parts.find((part) => part.id === controller.id).scriptSources = {
    ...controller.scriptSources,
    typescript: `${controller.scriptSources.typescript}\n// identity change`,
  };
  assert.notEqual(
    await fingerprintAsset("blueprint", reprogrammed),
    fingerprint,
  );
}

const tampered = structuredClone(shared);
tampered.asset.parts[0].pos[0] += 1;
const tamperedResult = await decodeSharePackage(tampered);
assert.equal(tamperedResult.ok, false);
assert.equal(tamperedResult.errors[0].code, "ASSET_FINGERPRINT_MISMATCH");

const rawBlueprint = await decodeSharePackage(blueprint);
assert.equal(rawBlueprint.ok, false);
assert.equal(rawBlueprint.errors[0].code, "INVALID_SHARE_PACKAGE");
const futureShare = structuredClone(shared);
futureShare.version = 2;
const unsupportedShare = await decodeSharePackage(futureShare);
assert.equal(unsupportedShare.ok, false);
assert.equal(unsupportedShare.errors[0].code, "UNSUPPORTED_SHARE_VERSION");

const futureProof = structuredClone(shared);
futureProof.verification = [{ proofVersion: 2 }];
const unsupportedProof = await decodeSharePackage(futureProof);
assert.equal(unsupportedProof.ok, true);
assert.equal(unsupportedProof.item.verification.length, 0);
assert.equal(unsupportedProof.warnings[0].code, "UNSUPPORTED_PROOF_VERSION");
assert.equal(unsupportedProof.warnings[0].index, 0);
const malformedProof = structuredClone(shared);
malformedProof.verification = [{ proofVersion: 1 }];
const malformed = await decodeSharePackage(malformedProof);
assert.equal(malformed.ok, true);
assert.equal(malformed.item.verification.length, 0);
assert.equal(malformed.warnings[0].code, "INVALID_PROOF");
assert.ok(malformed.warnings[0].path.length > 0);

const unsafe = structuredClone(shared);
unsafe.asset.parts[0].programTrust = { digest: "f".repeat(64) };
const unsafeResult = await decodeSharePackage(unsafe);
assert.equal(unsafeResult.ok, false);
assert.equal(unsafeResult.errors[0].code, "UNSAFE_EXECUTABLE");
const unsafeAcquisition = structuredClone(shared);
unsafeAcquisition.asset.programAcquisitionByController = {};
assert.equal(
  (await decodeSharePackage(unsafeAcquisition)).errors[0].code,
  "UNSAFE_EXECUTABLE",
);
assert.equal(
  (await decodeSharePackage("{")).errors[0].code,
  "INVALID_SHARE_PACKAGE",
);

const selected = [blueprint.parts[0].id];
const reusable = createSubassemblyTemplate(
  { parts: blueprint.parts, connections: blueprint.connections },
  selected,
  { name: "Rover component" },
);
assert.equal(SUBASSEMBLY_VERSION, 1);
assert.equal(decodeSubassembly(reusable).ok, true);
const futureReusable = { ...structuredClone(reusable), version: 2 };
assert.equal(decodeSubassembly(futureReusable).ok, false);
const reusableShare = await createSharePackage({
  kind: "subassembly",
  asset: reusable,
  metadata: { title: "Rover component", tags: ["mechanical"] },
});
assert.equal(reusableShare.kind, "subassembly");
assert.equal(reusableShare.dependencies.partCount, 1);
const wrongKind = { ...structuredClone(reusableShare), kind: "blueprint" };
const wrongKindResult = await decodeSharePackage(wrongKind);
assert.equal(wrongKindResult.ok, false);
assert.equal(wrongKindResult.errors[0].code, "ASSET_KIND_MISMATCH");

const remix = await createSharePackage({
  kind: "blueprint",
  asset: moved,
  metadata: { title: "Field Rover Remix", creator: "Remixer" },
  provenance: {
    parentFingerprint: shared.fingerprint,
    rootFingerprint: shared.fingerprint,
    remixDepth: 1,
    originalCreator: shared.metadata.creator,
  },
});
assert.notEqual(remix.fingerprint, shared.fingerprint);
assert.equal(remix.provenance.parentFingerprint, shared.fingerprint);
const unchangedRemix = await createSharePackage({
  kind: "blueprint",
  asset: blueprint,
  provenance: { parentFingerprint: shared.fingerprint },
});
assert.equal(unchangedRemix.provenance.parentFingerprint, null);
const invalidRoot = structuredClone(remix);
invalidRoot.provenance.rootFingerprint = invalidRoot.fingerprint;
assert.equal(
  (await decodeSharePackage(invalidRoot)).errors[0].code,
  "INVALID_SHARE_PACKAGE",
);

const recordProofs = verificationForAsset(
  [
    {
      proofVersion: 1,
      challengeVersion: 1,
      id: proof.challengeId,
      success: true,
      verificationEligible: true,
      score: proof.score,
      solution: proof.solution,
      recordedAt: proof.recordedAt,
      assetFingerprint: fingerprint,
      binding: proof.binding,
      terminal: proof.terminal,
      environment: proof.environment,
      controllerPrograms: proof.controllerPrograms,
    },
  ],
  fingerprint,
  blueprint,
);
assert.equal(recordProofs.length, 1);

const library = new ShareLibrary({ packages: [shared] });
library.upsert(reusableShare, "file");
library.upsert(remix, "link");
library.favorite(shared.fingerprint, true);
library.rate(shared.fingerprint, 4);
assert.equal(library.entries({ filter: "favorites" }).length, 1);
assert.equal(library.entries({ filter: "component" }).length, 1);
assert.equal(library.entries({ query: "cargo rover" }).length, 1);
assert.equal(library.get(shared.fingerprint).metadata.rating, undefined);
assert.equal(library.persistence().social[shared.fingerprint].rating, 4);

console.log(
  `share-package v1 passed (${shared.dependencies.partCount} parts, SHA-256 identity, isolated proof warnings)`,
);
