import { assert } from "./lib/assert.mjs";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { BlueprintAcquisition } from "../src/model/blueprint-acquisition.js";
import { ShareLibrary } from "../src/model/share-library.js";
import {
  createSharePackage,
  decodeShareLibrary,
  decodeSharePackage,
  decodeSharePackageOrThrow,
  fingerprintAsset,
  verificationForAsset,
} from "../src/model/share-packages.js";
import {
  createLocalSubassemblyRecord,
  createSubassemblyTemplate,
  decodeLocalSubassemblyLibrary,
  decodeSubassembly,
  decodeSubassemblyOrThrow,
  instantiateSubassembly,
} from "../src/model/subassemblies.js";
import { ShareExchangeService } from "../src/application/share-exchange-service.js";
import { portDefinition } from "../src/model/ports.js";

const cart = structuredClone(builtInDemo("cart").blueprint),
  root = cart.parts[0],
  cargo = cart.parts.find((part) => part.type === "cargo") || root,
  controller = cart.parts.find((part) => part.type === "computer"),
  fixedTime = "2026-07-17T00:00:00.000Z",
  onePart = createSubassemblyTemplate(
    { parts: cart.parts, connections: cart.connections },
    [root.id],
    { name: "Root module" },
  ),
  connectedIds = cart.connections.find(
    (connection) => connection.kind === "mechanical",
  )
    ? (() => {
        const connection = cart.connections.find(
          (candidate) => candidate.kind === "mechanical",
        );
        return [connection.a, connection.b];
      })()
    : [cart.parts[0].id, cart.parts[1].id],
  disconnectedIds = (() => {
    for (const left of cart.parts)
      for (const right of cart.parts)
        if (
          left.id < right.id &&
          !cart.connections.some(
            (connection) =>
              (connection.a === left.id && connection.b === right.id) ||
              (connection.a === right.id && connection.b === left.id),
          )
        )
          return [left.id, right.id];
    throw new Error("Cart fixture has no disconnected pair");
  })(),
  twoPart = createSubassemblyTemplate(
    { parts: cart.parts, connections: cart.connections },
    connectedIds,
    {
      name: "Two part module",
      accent: "not-a-color",
      origin: [0, 0, 0],
      extensions: { "com.example.module": { purpose: "coverage" } },
    },
  );

const mission = structuredClone(
    builtInDemo("mission", {
      wat: "(module)",
      typescript: "function tick() {}",
    }).blueprint,
  ),
  flightTemplate = createSubassemblyTemplate(
    { parts: mission.parts, connections: mission.connections },
    mission.parts.map((part) => part.id),
    { name: "Reusable flight controller" },
  ),
  flightTarget = [3, -2, 5],
  flightInstance = instantiateSubassembly(flightTemplate, {
    position: flightTarget,
    nextId: 20_000,
  }),
  flightIdMap = new Map(
    flightTemplate.parts.map((part, index) => [
      part.id,
      flightInstance.parts[index].id,
    ]),
  ),
  templateController = flightTemplate.parts.find(
    (part) => part.type === "computer",
  ),
  instanceController = flightInstance.parts.find(
    (part) => part.type === "computer",
  ),
  resourcePorts = flightTemplate.exposedPorts.filter((endpoint) =>
    ["OUTLET", "PROPELLANT"].includes(endpoint.port),
  );
const flightTemplateCentroid = [0, 1, 2].map(
  (axis) =>
    flightTemplate.parts.reduce((sum, part) => sum + part.pos[axis], 0) /
    flightTemplate.parts.length,
);
flightTemplateCentroid.forEach((value) =>
  assert.ok(
    Math.abs(value) < 1e-12,
    "fallback origin was not the part centroid",
  ),
);
assert.deepEqual(
  flightInstance.parts.map((part) => part.pos),
  flightTemplate.parts.map((part) =>
    part.pos.map((value, axis) => value + flightTarget[axis]),
  ),
  "instantiation did not translate every authored part by the target position",
);
assert.deepEqual(
  flightInstance.connections.map((connection) => connection.id),
  flightTemplate.connections.map(
    (_connection, index) => `subassembly-20000-${index + 1}`,
  ),
  "instantiation did not assign deterministic one-based connection IDs",
);
assert.ok(resourcePorts.length > 0, "flight fixture exposes no resource ports");
assert.ok(
  resourcePorts.every((endpoint) => endpoint.role === "resource"),
  "resource endpoints were not preserved as resource endpoints",
);
assert.deepEqual(
  instanceController.controllerBindings,
  templateController.controllerBindings.map((binding) => ({
    ...binding,
    endpointPartId: flightIdMap.get(binding.endpointPartId),
  })),
  "instantiation did not remap controller binding endpoint IDs",
);
assert.equal(
  flightInstance.connections.filter(
    (connection) => connection.kind === "resource",
  ).length,
  flightTemplate.connections.filter(
    (connection) => connection.kind === "resource",
  ).length,
  "instantiation changed the reusable resource network",
);

assert.equal(twoPart.accent, "#70e0c4");
for (const accent of ["x#123456", "#123456x"])
  assert.equal(
    createSubassemblyTemplate(
      { parts: cart.parts, connections: cart.connections },
      [root.id],
      { accent },
    ).accent,
    "#70e0c4",
  );
const boundedName = createSubassemblyTemplate(
  { parts: cart.parts, connections: cart.connections },
  [root.id],
  { name: " x ".repeat(100) },
).name;
assert.ok(boundedName.length <= 80);
assert.equal(boundedName, boundedName.trim());
assert.throws(
  () =>
    createSubassemblyTemplate(
      { parts: cart.parts, connections: cart.connections },
      [],
    ),
  /Select at least one/,
);
assert.throws(
  () =>
    createSubassemblyTemplate(
      { parts: cart.parts, connections: cart.connections },
      disconnectedIds,
    ),
  /connected selection/,
);
assert.throws(
  () =>
    createSubassemblyTemplate(
      { parts: cart.parts, connections: cart.connections },
      [root.id],
      { origin: [Number.NaN, 0, 0] },
    ),
  /finite position/,
);

const whitespaceName = structuredClone(onePart);
whitespaceName.name = ` ${whitespaceName.name}`;
assert.equal(decodeSubassembly(whitespaceName).ok, false);
assert.throws(() => decodeSubassemblyOrThrow({ ...onePart, version: 2 }));
const missingExposedPorts = structuredClone(onePart);
delete missingExposedPorts.exposedPorts;
assert.equal(
  decodeSubassembly(missingExposedPorts).errors[0].code,
  "WIRE_SCHEMA_VIOLATION",
  "incomplete subassembly shape was accepted",
);
const duplicateExposed = structuredClone(onePart);
duplicateExposed.exposedPorts.push({
  ...duplicateExposed.exposedPorts[0],
  id: "another-id",
});
assert.equal(
  decodeSubassembly(duplicateExposed).errors[0].code,
  "DUPLICATE_EXPOSED_ENDPOINT",
);
const occupiedEndpoint = twoPart.connections
    .flatMap((connection) => [
      { partId: connection.a, port: connection.portA },
      { partId: connection.b, port: connection.portB },
    ])
    .find(({ partId, port }) =>
      ["one"].includes(
        portDefinition(
          twoPart.parts.find((part) => part.id === partId),
          port,
        ).multiplicity,
      ),
    ),
  occupiedExposed = structuredClone(twoPart);
assert.ok(occupiedEndpoint, "fixture has no occupied single-use endpoint");
occupiedExposed.exposedPorts.push({
  id: "occupied-port",
  label: "Occupied internal endpoint",
  role: "mount",
  partId: occupiedEndpoint.partId,
  port: occupiedEndpoint.port,
});
assert.equal(
  decodeSubassembly(occupiedExposed).errors[0].code,
  "OCCUPIED_EXPOSED_PORT",
);
const disconnected = structuredClone(twoPart);
disconnected.connections = [];
assert.equal(decodeSubassembly(disconnected).ok, false);
assert.throws(() => instantiateSubassembly(onePart, { position: [0, 1] }));
assert.throws(() =>
  instantiateSubassembly(onePart, { position: [0, Number.NaN, 0] }),
);
assert.equal(instantiateSubassembly(onePart).parts.length, 1);

const controllerModule = createSubassemblyTemplate(
    {
      parts: [
        {
          ...structuredClone(controller),
          id: 1,
          pos: [0, 0, 0],
          controllerBindings: [],
        },
      ],
      connections: [],
    },
    [1],
    { name: "Controller" },
  ),
  localRecord = createLocalSubassemblyRecord(controllerModule, {
    createdAt: fixedTime,
  }),
  importedRecord = createLocalSubassemblyRecord(controllerModule, {
    origin: {
      kind: BlueprintAcquisition.FILE_IMPORT,
      sourceFingerprint: `sim-sha256-${"1".repeat(64)}`,
    },
    createdAt: fixedTime,
    updatedAt: "2026-07-17T00:01:00.000Z",
  });
assert.equal(localRecord.origin.kind, BlueprintAcquisition.LOCAL_AUTHORING);
assert.equal(importedRecord.origin.kind, BlueprintAcquisition.FILE_IMPORT);
for (const options of [
  { origin: null },
  { origin: { kind: "NOPE", sourceFingerprint: null } },
  {
    origin: {
      kind: BlueprintAcquisition.LOCAL_AUTHORING,
      sourceFingerprint: `sim-sha256-${"2".repeat(64)}`,
    },
  },
  {
    origin: {
      kind: BlueprintAcquisition.SHARE_IMPORT,
      sourceFingerprint: null,
    },
  },
  {
    origin: {
      kind: BlueprintAcquisition.SHARE_IMPORT,
      sourceFingerprint: "bad",
    },
  },
  {
    origin: {
      kind: BlueprintAcquisition.SHARE_IMPORT,
      sourceFingerprint: `xsim-sha256-${"3".repeat(64)}`,
    },
  },
  {
    origin: {
      kind: BlueprintAcquisition.SHARE_IMPORT,
      sourceFingerprint: `sim-sha256-${"4".repeat(64)}x`,
    },
  },
  {
    origin: {
      kind: BlueprintAcquisition.BUILT_IN,
      sourceFingerprint: null,
      extra: true,
    },
  },
  { createdAt: "not-a-date" },
  { createdAt: fixedTime, updatedAt: "2026-07-16T00:00:00.000Z" },
  { programAcquisitionByController: {} },
])
  assert.throws(() => createLocalSubassemblyRecord(controllerModule, options));
assert.throws(() =>
  createLocalSubassemblyRecord(controllerModule, {
    programAcquisitionByController: {
      [controllerModule.parts[0].id]: "INVALID",
    },
  }),
);
const damagedRecords = decodeLocalSubassemblyLibrary([
  null,
  { ...localRecord, extra: true },
  { ...localRecord, version: 2 },
  { ...localRecord, createdAt: "bad" },
  localRecord,
]);
assert.equal(damagedRecords.records.length, 1);
assert.equal(damagedRecords.diagnostics.length, 4);
assert.deepEqual(decodeLocalSubassemblyLibrary(null).records, []);

const subassemblyFingerprint = await fingerprintAsset("subassembly", onePart),
  renamedSubassembly = { ...onePart, name: "Renamed", accent: "#ffffff" };
assert.equal(
  await fingerprintAsset("subassembly", renamedSubassembly),
  subassemblyFingerprint,
);
await assert.rejects(() => fingerprintAsset("component", onePart));

const basePackage = await createSharePackage({
    kind: "blueprint",
    asset: cart,
    metadata: {
      title: "Branch rover",
      tags: ["rover", "branch"],
      thumbnail: "data:image/png;base64,AA==",
      createdAt: fixedTime,
      updatedAt: fixedTime,
      extensions: { "com.example.card": { compact: true } },
    },
    provenance: { extensions: { "com.example.lineage": { note: "claim" } } },
    extensions: { "com.example.package": { hint: true } },
    dependencyExtensions: { "com.example.dependencies": { version: 1 } },
  }),
  baseFingerprint = basePackage.fingerprint;
assert.equal((await decodeSharePackageOrThrow(basePackage)).ok, true);
await assert.rejects(() =>
  decodeSharePackageOrThrow({ ...basePackage, version: 2 }),
);
await assert.rejects(() =>
  createSharePackage({
    kind: "blueprint",
    asset: cart,
    metadata: { createdAt: "invalid" },
  }),
);
await assert.rejects(() =>
  createSharePackage({
    kind: "blueprint",
    asset: cart,
    metadata: { thumbnail: "data:image/png;base64,%%%" },
  }),
);
await assert.rejects(() =>
  createSharePackage({
    kind: "blueprint",
    asset: cart,
    metadata: { tags: ["bad!"] },
  }),
);

const proofBase = {
  proofVersion: 1,
  challengeVersion: 1,
  challengeId: "branch-trial",
  assetFingerprint: baseFingerprint,
  score: 10,
  solution: "CAPABILITY",
  recordedAt: fixedTime,
  binding: {
    kind: "payload",
    policyVersion: 1,
    rootPartId: root.id,
    payloadPartId: cargo.id,
    initialComponentId: `component:${root.id}`,
  },
  terminal: {
    criteria: [{ id: "done", met: true, current: "yes", target: "yes" }],
    metrics: {
      massKg: 1,
      partCount: cart.parts.length,
      energyUsed: 0,
      damage: 0,
      worstFatigue: 0,
      apexM: 0,
      touchedWater: false,
      payloadSecured: true,
    },
  },
  environment: {
    seed: "branch-world",
    latitude: 0,
    longitude: 0,
    timeOfDay: 12,
    windEnabled: false,
  },
  controllerPrograms: [{ partId: controller.id, digest: "a".repeat(64) }],
  extensions: { "com.example.proof": { note: "local" } },
};
const payloadProofPackage = await createSharePackage({
  kind: "blueprint",
  asset: cart,
  verification: [proofBase],
});
assert.equal(payloadProofPackage.verification[0].binding.kind, "payload");
const mechanismProof = {
  ...structuredClone(proofBase),
  challengeId: "mechanism-trial",
  binding: {
    kind: "mechanism",
    policyVersion: 1,
    inputPartId: cart.parts[0].id,
    outputPartId: cart.parts[1].id,
  },
};
assert.equal(
  (
    await createSharePackage({
      kind: "blueprint",
      asset: cart,
      verification: [mechanismProof],
    })
  ).verification[0].binding.kind,
  "mechanism",
);
for (const invalidProof of [
  {
    ...structuredClone(proofBase),
    assetFingerprint: `sim-sha256-${"9".repeat(64)}`,
  },
  {
    ...structuredClone(proofBase),
    binding: { ...proofBase.binding, payloadPartId: 999999 },
  },
  {
    ...structuredClone(proofBase),
    controllerPrograms: [
      ...proofBase.controllerPrograms,
      ...proofBase.controllerPrograms,
    ],
  },
  {
    ...structuredClone(proofBase),
    controllerPrograms: [{ partId: root.id, digest: "a".repeat(64) }],
  },
]) {
  const candidate = structuredClone(basePackage);
  candidate.verification = [invalidProof];
  const result = await decodeSharePackage(candidate);
  assert.equal(result.ok, true);
  assert.equal(result.warnings[0].code, "INVALID_PROOF");
}

const secondControllerCart = structuredClone(cart),
  secondController = {
    ...structuredClone(controller),
    id: Math.max(...cart.parts.map((part) => part.id)) + 1,
    pos: [8, 8, 8],
    controllerBindings: [],
  };
secondControllerCart.parts.push(secondController);
const twoControllerPackage = await createSharePackage({
    kind: "blueprint",
    asset: secondControllerCart,
  }),
  unsortedProof = {
    ...structuredClone(proofBase),
    assetFingerprint: twoControllerPackage.fingerprint,
    controllerPrograms: [
      { partId: secondController.id, digest: "b".repeat(64) },
      { partId: controller.id, digest: "a".repeat(64) },
    ],
  },
  unsortedCandidate = structuredClone(twoControllerPackage);
unsortedCandidate.verification = [unsortedProof];
assert.equal(
  (await decodeSharePackage(unsortedCandidate)).warnings[0].code,
  "INVALID_PROOF",
);

const oversized = JSON.stringify({
  ...basePackage,
  metadata: { ...basePackage.metadata, description: "x".repeat(2_000_000) },
});
assert.equal(
  (await decodeSharePackage(oversized)).errors[0].code,
  "PACKAGE_TOO_LARGE",
);
assert.equal(
  (await decodeSharePackage([])).errors[0].code,
  "INVALID_SHARE_PACKAGE",
);

const strongest = verificationForAsset(
  [
    { ...proofBase, id: proofBase.challengeId, success: false },
    {
      ...proofBase,
      id: proofBase.challengeId,
      success: true,
      verificationEligible: true,
      score: 5,
    },
    {
      ...proofBase,
      id: proofBase.challengeId,
      success: true,
      verificationEligible: true,
      score: 20,
    },
    {
      ...proofBase,
      id: "invalid-local",
      success: true,
      verificationEligible: true,
      binding: { ...proofBase.binding, rootPartId: 999999 },
    },
  ],
  baseFingerprint,
  cart,
);
assert.equal(strongest.length, 1);
assert.equal(strongest[0].score, 20);

const warningPackage = structuredClone(basePackage);
warningPackage.verification = [{ proofVersion: 2 }];
const decodedLibrary = await decodeShareLibrary([
  basePackage,
  basePackage,
  warningPackage,
  { ...basePackage, version: 2 },
]);
assert.equal(decodedLibrary.packages.length, 1);
assert.equal(decodedLibrary.diagnostics.length, 2);
assert.deepEqual((await decodeShareLibrary(null)).packages, []);

const library = new ShareLibrary({
  packages: [basePackage, payloadProofPackage],
  social: { [baseFingerprint]: { favorite: false, rating: 99 } },
  origins: {
    [baseFingerprint]: { primary: "bad", history: ["bad"] },
  },
});
assert.equal(library.entries()[0].origin, "file");
assert.equal(library.rate("missing", 4), 0);
assert.equal(library.favorite("missing"), null);
assert.equal(library.get("missing"), null);
assert.throws(() => library.upsert(basePackage, "unknown"));
assert.equal(library.favorite(baseFingerprint, true), true);
assert.equal(library.favorite(baseFingerprint), false);
assert.equal(library.favorite(baseFingerprint, false), false);
assert.equal(library.rate(baseFingerprint, -1), 0);
assert.equal(library.rate(baseFingerprint, 9), 5);
library.upsert(
  { ...basePackage, metadata: { ...basePackage.metadata, title: "Remote" } },
  "link",
);
library.upsert(basePackage, "local");
library.upsert(
  { ...basePackage, metadata: { ...basePackage.metadata, title: "Ignored" } },
  "file",
);
library.upsert(
  await createSharePackage({ kind: "subassembly", asset: onePart }),
  "file",
);
library.upsert(
  await createSharePackage({ kind: "subassembly", asset: twoPart }),
  "link",
);
assert.ok(library.entries({ filter: "verified" }).length >= 1);
assert.equal(library.entries({ filter: "component" }).length, 1);
assert.equal(library.entries({ filter: "subassembly" }).length, 1);
assert.ok(library.entries({ filter: "blueprint" }).length >= 1);
assert.equal(library.entries({ query: "no-such-term" }).length, 0);
assert.ok(library.entries({ query: "branch   rover" }).length >= 1);
assert.equal(library.entries({ filter: "favorites" }).length, 0);

const proofMergeLibrary = new ShareLibrary({
  packages: [payloadProofPackage],
});
const weakerProofPackage = structuredClone(payloadProofPackage);
weakerProofPackage.verification[0].score -= 1;
proofMergeLibrary.upsert(weakerProofPackage, "file");
assert.equal(
  proofMergeLibrary.get(payloadProofPackage.fingerprint).verification[0].score,
  payloadProofPackage.verification[0].score,
);

const boundedLibrary = new ShareLibrary();
for (let index = 0; index < 34; index++)
  boundedLibrary.upsert(
    {
      ...basePackage,
      fingerprint: `sim-sha256-${index.toString(16).padStart(64, "0")}`,
    },
    "file",
  );
assert.equal(boundedLibrary.entries().length, 32);

class MemoryRepository {
  constructor(catalog = { packages: [], social: {}, origins: {} }) {
    this.catalog = structuredClone(catalog);
    this.failure = null;
  }
  load() {
    return { catalog: structuredClone(this.catalog) };
  }
  commit({ catalog }) {
    if (this.failure != null) throw this.failure;
    this.catalog = structuredClone(catalog);
    return { ok: true };
  }
}

const repository = new MemoryRepository(),
  service = new ShareExchangeService({ repository });
await service.ready;
assert.equal(await service.get("missing"), null);
const rejectedImport = await service.importPackage({});
assert.equal(rejectedImport.status, "rejected");
assert.equal(rejectedImport.error.message, rejectedImport.errors[0].message);
const rejectedSave = await service.savePackage({});
assert.equal(rejectedSave.status, "rejected");
assert.equal(rejectedSave.error.message, rejectedSave.errors[0].message);
assert.equal((await service.remove("missing")).status, "unchanged");
assert.equal((await service.publishReusable([])).status, "unchanged");
assert.equal((await service.prepareRemix("missing")).ok, false);
const createdReusable = await service.createPackage({
  kind: "subassembly",
  asset: onePart,
  metadata: { title: "Reusable" },
  provenance: {
    parentFingerprint: baseFingerprint,
    rootFingerprint: baseFingerprint,
    remixDepth: 1,
    originalCreator: "Must not escape",
  },
});
assert.equal(createdReusable.kind, "subassembly");
assert.equal(createdReusable.provenance.parentFingerprint, null);
assert.equal(
  (
    await service.importPackage(createdReusable, {
      requiredKind: "subassembly",
    })
  ).ok,
  true,
);
assert.equal(
  service
    .list()
    .find((entry) => entry.package.fingerprint === createdReusable.fingerprint)
    .proofTrust,
  "none",
);
assert.equal(
  (await service.prepareRemix(createdReusable.fingerprint)).ok,
  false,
);

const publishedReusable = await service.publishReusable([onePart, twoPart], {
  creator: "Branch Builder",
});
assert.equal(publishedReusable.status, "updated");
assert.equal(
  publishedReusable.items[0].package?.kind || publishedReusable.items[0].kind,
  "subassembly",
);
assert.ok(
  publishedReusable.items[0].metadata.description.includes("component"),
);
assert.ok(publishedReusable.items[0].metadata.tags.includes("component"));
assert.ok(
  publishedReusable.items[1].metadata.description.includes("subassembly"),
);
assert.ok(publishedReusable.items[1].metadata.tags.includes("subassembly"));

await service.savePackage(payloadProofPackage);
assert.equal(
  (await service.get(baseFingerprint)).package.fingerprint,
  baseFingerprint,
);
assert.equal(
  service.list().find((entry) => entry.package.fingerprint === baseFingerprint)
    .proofTrust,
  "attached",
);
const preparedRemix = await service.prepareRemix(baseFingerprint);
assert.equal(preparedRemix.ok, true);
assert.equal(preparedRemix.provenance.remixDepth, 1);
assert.equal(
  preparedRemix.provenance.originalCreator,
  payloadProofPackage.metadata.creator,
);
service.beginRemix(preparedRemix.provenance);
const exposedRemix = service.remix();
exposedRemix.remixDepth = 99;
assert.equal(service.remix().remixDepth, 1);
const modifiedCart = structuredClone(cart);
for (const part of modifiedCart.parts) part.pos[0] += 0.25;
const remixedPackage = await service.createPackage({
  kind: "blueprint",
  asset: modifiedCart,
  metadata: { title: "Branch remix" },
});
assert.equal(remixedPackage.provenance.remixDepth, 1);
assert.equal(remixedPackage.provenance.parentFingerprint, baseFingerprint);
service.clearRemix();
assert.equal((await service.favorite("missing")).value, null);
assert.equal((await service.rate("missing", 3)).value, 0);
repository.failure = "string failure";
service.beginRemix(preparedRemix.provenance);
assert.equal((await service.savePackage(basePackage)).ok, false);
assert.equal(service.remix().parentFingerprint, baseFingerprint);
assert.equal((await service.remove(baseFingerprint)).ok, false);

console.log("sharing defensive branches passed");
