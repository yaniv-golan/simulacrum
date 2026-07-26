import { assert } from "./lib/assert.mjs";
import {
  BrowserStorage,
  STORAGE_PROTOCOL,
  STORAGE_KEYS,
} from "../src/application/browser-storage.js";
import { BrowserShareRepository } from "../src/application/share-exchange-repository.js";
import { ShareExchangeService } from "../src/application/share-exchange-service.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { createSharePackage } from "../src/model/share-packages.js";
import {
  decodeSharePayload,
  encodeSharePayload,
} from "../src/model/share-codec.js";
import { createSubassemblyTemplate } from "../src/model/subassemblies.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.failOnceOn = null;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failOnceOn === key) {
      this.failOnceOn = null;
      throw new Error(`quota failure for ${key}`);
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
}

const quietLogger = { warn() {}, error() {} };
async function fixture(catalog = null) {
  const raw = new MemoryStorage();
  const storage = new BrowserStorage(raw, { logger: quietLogger });
  const repository = new BrowserShareRepository({
    storage,
    keys: STORAGE_KEYS,
    logger: quietLogger,
  });
  if (catalog) {
    const committed = repository.commit({ catalog });
    assert.equal(committed.ok, true);
  }
  const service = new ShareExchangeService({ repository });
  await service.ready;
  return { raw, storage, repository, service };
}

const blueprint = builtInDemo("cart").blueprint;
const alternate = builtInDemo("drone").blueprint;
const root = blueprint.parts[0];
const controller = blueprint.parts.find((part) => part.type === "computer");
const localPackage = await createSharePackage({
  kind: "blueprint",
  asset: blueprint,
  metadata: {
    title: "Local Rover",
    creator: "Local Builder",
    createdAt: "2026-07-17T00:00:00.000Z",
  },
});
const proof = {
  proofVersion: 1,
  challengeVersion: 1,
  challengeId: "field-trial",
  score: 8420,
  solution: "GROUND VEHICLE",
  recordedAt: "2026-07-17T00:01:00.000Z",
  assetFingerprint: localPackage.fingerprint,
  binding: {
    kind: "component",
    policyVersion: 1,
    rootPartId: root.id,
    initialComponentId: `component:${root.id}`,
  },
  terminal: {
    criteria: [{ id: "distance", met: true, current: "31 M", target: "30 M" }],
    metrics: {
      massKg: 180,
      partCount: blueprint.parts.length,
      energyUsed: 8,
      damage: 0,
      worstFatigue: 0,
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
const provenPackage = await createSharePackage({
  kind: "blueprint",
  asset: blueprint,
  metadata: localPackage.metadata,
  verification: [proof],
});

// Current damaged records are isolated and diagnosed instead of blocking startup.
const damaged = await fixture({
  packages: [localPackage, { ...localPackage, version: 2 }],
  social: {},
  origins: {},
});
assert.equal(damaged.service.list().length, 1);
assert.equal(damaged.service.snapshot().recoveryDiagnostics.length, 1);

// Validation and expected-kind checks happen before mutation.
const reusable = createSubassemblyTemplate(
  { parts: blueprint.parts, connections: blueprint.connections },
  [blueprint.parts[0].id],
  { name: "Wheel module" },
);
const componentPackage = await createSharePackage({
  kind: "subassembly",
  asset: reusable,
  metadata: { title: "Wheel module" },
});
const clean = await fixture();
const beforeWrongKind = clean.service.snapshot();
const wrongKind = await clean.service.importPackage(componentPackage, {
  origin: "file",
  requiredKind: "blueprint",
});
assert.equal(wrongKind.ok, false);
assert.equal(wrongKind.errors[0].code, "ASSET_KIND_MISMATCH");
assert.deepEqual(clean.service.snapshot(), beforeWrongKind);

// Invalid optional proof is omitted with a pathful warning through the service.
const malformedProof = structuredClone(localPackage);
malformedProof.verification = [{ proofVersion: 2 }];
const warningImport = await clean.service.importPackage(malformedProof, {
  origin: "file",
});
assert.equal(warningImport.ok, true);
assert.equal(warningImport.warnings[0].code, "UNSUPPORTED_PROOF_VERSION");
assert.equal(warningImport.warnings[0].index, 0);
assert.equal(warningImport.item.verification.length, 0);

// Attached proof never becomes local merely because the package is saved.
const trustFixture = await fixture();
assert.equal(
  (await trustFixture.service.importPackage(provenPackage, { origin: "link" }))
    .ok,
  true,
);
assert.equal(trustFixture.service.list()[0].proofTrust, "attached");
assert.equal((await trustFixture.service.savePackage(provenPackage)).ok, true);
assert.equal(trustFixture.service.list()[0].proofTrust, "attached");
const exactLocalRecord = {
  proofVersion: 1,
  challengeVersion: 1,
  id: proof.challengeId,
  success: true,
  verificationEligible: true,
  score: proof.score,
  solution: proof.solution,
  recordedAt: proof.recordedAt,
  assetFingerprint: proof.assetFingerprint,
  binding: proof.binding,
  terminal: proof.terminal,
  environment: proof.environment,
  controllerPrograms: proof.controllerPrograms,
};
assert.equal(
  trustFixture.service.list({}, [exactLocalRecord])[0].proofTrust,
  "local",
);

// Duplicate acquisition merges proof/origin history without changing local metadata.
await trustFixture.service.rate(localPackage.fingerprint, 4);
await trustFixture.service.favorite(localPackage.fingerprint, true);
const importedDuplicate = await createSharePackage({
  kind: "blueprint",
  asset: blueprint,
  metadata: {
    title: "Untrusted rename",
    creator: "Remote author",
    createdAt: "2026-07-17T01:00:00.000Z",
  },
  verification: [proof],
});
const duplicateResult = await trustFixture.service.importPackage(
  importedDuplicate,
  { origin: "link" },
);
assert.equal(duplicateResult.status, "duplicate");
const duplicateEntry = await trustFixture.service.get(localPackage.fingerprint);
assert.equal(duplicateEntry.package.metadata.title, "Local Rover");
assert.deepEqual(duplicateEntry.origins, ["link", "local"]);
assert.equal(duplicateEntry.social.rating, 4);
assert.equal(duplicateEntry.package.metadata.rating, undefined);

// A failed multi-key write leaves observable state and storage unchanged.
const failed = await fixture();
const beforeFailureState = failed.service.snapshot();
const beforeFailurePointer = failed.raw.getItem(STORAGE_PROTOCOL.pointerKey);
failed.raw.failOnceOn = STORAGE_PROTOCOL.pointerKey;
const rejectedSave = await failed.service.savePackage(localPackage);
assert.equal(rejectedSave.ok, false);
assert.deepEqual(failed.service.snapshot(), beforeFailureState);
assert.equal(
  failed.raw.getItem(STORAGE_PROTOCOL.pointerKey),
  beforeFailurePointer,
);
assert.deepEqual(failed.repository.load(), {
  catalog: { packages: [], social: {}, origins: {} },
});

// Removal uses one package catalog and one deletion path; no tombstones remain.
const removed = await fixture();
await removed.service.savePackage(localPackage);
assert.equal((await removed.service.remove(localPackage.fingerprint)).ok, true);
const rehydrated = new ShareExchangeService({ repository: removed.repository });
await rehydrated.ready;
assert.equal(rehydrated.list().length, 0);

// Reusable publishing always emits subassembly packages, including one part.
const published = await clean.service.publishReusable([reusable], {
  creator: "Builder",
});
assert.equal(published.ok, true);
assert.equal(published.items[0].kind, "subassembly");

// Remix lineage remains explicit and clears on assembly replacement.
const remixFixture = await fixture();
await remixFixture.service.savePackage(localPackage);
const prepared = await remixFixture.service.prepareRemix(
  localPackage.fingerprint,
);
assert.equal(prepared.ok, true);
remixFixture.service.beginRemix(prepared.provenance);
const modified = structuredClone(blueprint);
for (const part of modified.parts) part.pos[0] += 0.5;
const remixed = await remixFixture.service.createPackage({
  kind: "blueprint",
  asset: modified,
  metadata: { title: "Changed remix" },
});
assert.equal(remixed.provenance.parentFingerprint, localPackage.fingerprint);
remixFixture.service.clearRemix();
assert.equal(
  (
    await remixFixture.service.createPackage({
      kind: "blueprint",
      asset: alternate,
      metadata: { title: "Unrelated machine" },
    })
  ).provenance.parentFingerprint,
  null,
);

// Raw/gzip links preserve Unicode and reject decompression bombs before parsing.
const encoded = await encodeSharePayload({
  title: "רכב 🚀",
  package: localPackage,
});
assert.equal((await decodeSharePayload(encoded)).title, "רכב 🚀");
if (typeof CompressionStream !== "undefined") {
  const huge = JSON.stringify({ payload: "x".repeat(2_100_000) });
  const compressed = new Uint8Array(
    await new Response(
      new Blob([huge]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const base64 = Buffer.from(compressed).toString("base64url");
  await assert.rejects(
    () => decodeSharePayload(`gz.${base64}`),
    /2 MB safety limit/,
  );
}

console.log(
  `share exchange v1 passed (${trustFixture.service.list().length} canonical package, warning-preserving transactional persistence)`,
);
