import crypto from "node:crypto";
import { assert } from "./lib/assert.mjs";
import {
  APPLICATION_STORAGE_ROOTS,
  BrowserStorage,
  STORAGE_KEYS,
  STORAGE_PROTOCOL,
  STORAGE_ROOT_OWNERS,
} from "../src/application/browser-storage.js";
import { sha256Hex } from "../src/model/sha256.js";
import {
  BrowserDiscoveryRepository,
  BrowserEnvironmentPreferencesRepository,
} from "../src/application/local-settings-repositories.js";

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
    this.failure = null;
  }

  failNext(predicate, message = "injected storage failure") {
    this.failure = { predicate, message };
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.failure?.predicate(key, "set")) {
      const message = this.failure.message;
      this.failure = null;
      throw new DOMException(message, "QuotaExceededError");
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    if (this.failure?.predicate(key, "remove")) {
      const message = this.failure.message;
      this.failure = null;
      throw new DOMException(message, "SecurityError");
    }
    this.values.delete(key);
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
}

class QuotaStorage extends MemoryStorage {
  constructor(maximumEntries) {
    super();
    this.maximumEntries = maximumEntries;
  }

  setItem(key, value) {
    if (!this.values.has(key) && this.values.size >= this.maximumEntries)
      throw new DOMException("entry quota exceeded", "QuotaExceededError");
    super.setItem(key, value);
  }
}

const logger = { warn() {} };
let nextId = 0;
const deterministicId = () => (++nextId).toString(16).padStart(32, "0"),
  createStorage = (raw) =>
    new BrowserStorage(raw, {
      logger,
      idFactory: deterministicId,
      clock: () => "2026-07-17T00:00:00.000Z",
    }),
  parseAt = (raw, key) => JSON.parse(raw.getItem(key)),
  manifestFor = (raw, pointer = parseAt(raw, STORAGE_PROTOCOL.pointerKey)) =>
    parseAt(raw, `${STORAGE_PROTOCOL.manifestPrefix}${pointer.manifestId}`);

assert.equal(
  sha256Hex("abc"),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
);
assert.equal(STORAGE_PROTOCOL.version, 1);
assert.equal(STORAGE_PROTOCOL.pointerKey, "simulacrum.v1.storage.commit");
assert.equal(
  STORAGE_PROTOCOL.manifestPrefix,
  "simulacrum.v1.storage.manifest.",
);
assert.equal(
  STORAGE_PROTOCOL.generationPrefix,
  "simulacrum.v1.storage.generation.",
);
assert.deepEqual(APPLICATION_STORAGE_ROOTS, [
  "workspace",
  "subassemblyLibrary",
  "sharePackages",
  "shareSocial",
  "shareOrigins",
  "challengeRecords",
  "challengeBest",
  "discovery",
  "environmentPreferences",
  "executableTrust",
]);
assert.deepEqual(Object.keys(STORAGE_ROOT_OWNERS), APPLICATION_STORAGE_ROOTS);

// A missing current pointer starts empty and never scans unrelated flat namespaces.
const staleFlat = {
    "simulacrum.workspace": JSON.stringify({ version: 1, parts: ["stale"] }),
    "simulacrum.executableTrust": JSON.stringify({
      version: 1,
      digests: ["a".repeat(64)],
    }),
  },
  raw = new MemoryStorage(staleFlat),
  storage = createStorage(raw);
assert.equal(storage.readEntry(STORAGE_KEYS.workspace).source, "storage-v1");
assert.deepEqual(storage.readJson(STORAGE_KEYS.workspace, null), null);
assert.deepEqual(storage.readJson(STORAGE_KEYS.executableTrust, null), null);
assert.equal(
  raw.getItem("simulacrum.workspace"),
  staleFlat["simulacrum.workspace"],
);

// One commit writes the exact pointer, manifest, and generation contracts.
const workspace = { format: "test-workspace", version: 1 },
  first = storage.writeJson(STORAGE_KEYS.workspace, workspace);
assert.equal(first.ok, true);
const firstPointer = parseAt(raw, STORAGE_PROTOCOL.pointerKey),
  firstManifest = manifestFor(raw, firstPointer);
assert.deepEqual(Object.keys(firstPointer).sort(), [
  "manifestId",
  "protocolVersion",
]);
assert.equal(firstPointer.protocolVersion, 1);
assert.match(firstPointer.manifestId, /^[0-9a-f]{32}$/);
assert.deepEqual(Object.keys(firstManifest).sort(), [
  "createdAt",
  "generationId",
  "manifestId",
  "previousManifestId",
  "protocolVersion",
  "roots",
]);
assert.equal(firstManifest.previousManifestId, null);
assert.deepEqual(
  Object.keys(firstManifest.roots).sort(),
  [...APPLICATION_STORAGE_ROOTS].sort(),
);
assert.ok(
  APPLICATION_STORAGE_ROOTS.filter(
    (root) => firstManifest.roots[root] !== null,
  ).every((root) => root === STORAGE_KEYS.workspace),
);
const workspaceReference = firstManifest.roots.workspace,
  workspaceEncoded = raw.getItem(workspaceReference.key);
assert.deepEqual(Object.keys(workspaceReference).sort(), [
  "bytes",
  "key",
  "sha256",
]);
assert.equal(
  workspaceReference.key,
  `${STORAGE_PROTOCOL.generationPrefix}${firstManifest.generationId}.workspace`,
);
assert.equal(
  workspaceReference.bytes,
  new TextEncoder().encode(workspaceEncoded).byteLength,
);
assert.equal(
  workspaceReference.sha256,
  crypto.createHash("sha256").update(workspaceEncoded).digest("hex"),
);
assert.deepEqual(storage.readJson(STORAGE_KEYS.workspace, null), workspace);
assert.equal(raw.getItem("workspace"), null, "flat mirror was recreated");

// An owner can atomically update only its declared roots.
const catalog = {
  packages: [{ format: "current-package" }],
  social: { one: { favorite: true, rating: 4 } },
  origins: { one: { primary: "local", history: ["local"] } },
};
const shareCommit = storage.commitOwned("share", [
  {
    key: STORAGE_KEYS.sharePackages,
    encoding: "json",
    value: catalog.packages,
  },
  { key: STORAGE_KEYS.shareSocial, encoding: "json", value: catalog.social },
  {
    key: STORAGE_KEYS.shareOrigins,
    encoding: "json",
    value: catalog.origins,
  },
]);
assert.equal(shareCommit.ok, true);
assert.deepEqual(
  storage.readJson(STORAGE_KEYS.sharePackages, []),
  catalog.packages,
);
const secondPointer = parseAt(raw, STORAGE_PROTOCOL.pointerKey),
  secondManifest = manifestFor(raw, secondPointer);
assert.equal(secondManifest.previousManifestId, firstPointer.manifestId);
for (const root of [
  "workspace",
  "sharePackages",
  "shareSocial",
  "shareOrigins",
])
  assert.equal(
    secondManifest.roots[root].key,
    `${STORAGE_PROTOCOL.generationPrefix}${secondManifest.generationId}.${root}`,
  );
assert.equal(
  storage.commitOwned("workspace", [
    { key: STORAGE_KEYS.sharePackages, encoding: "json", value: [] },
  ]).ok,
  false,
);
assert.equal(
  storage.commitBatch([
    { key: STORAGE_KEYS.workspace, encoding: "json", value: workspace },
    { key: STORAGE_KEYS.sharePackages, encoding: "json", value: [] },
  ]).ok,
  false,
);

// Root names, shapes, encodings, and duplicates fail before a pointer switch.
const pointerBeforeInvalid = raw.getItem(STORAGE_PROTOCOL.pointerKey);
for (const updates of [
  [],
  [null],
  [{ key: "unknown", encoding: "json", value: {} }],
  [{ key: STORAGE_KEYS.workspace, encoding: "text", value: "x" }],
  [{ key: STORAGE_KEYS.challengeRecords, encoding: "json", value: {} }],
  [
    { key: STORAGE_KEYS.challengeBest, encoding: "json", value: {} },
    { key: STORAGE_KEYS.challengeBest, encoding: "json", value: {} },
  ],
])
  assert.equal(storage.commitBatch(updates).ok, false);
assert.equal(storage.readEntry("unknown").ok, false);
assert.equal(raw.getItem(STORAGE_PROTOCOL.pointerKey), pointerBeforeInvalid);

const shapeStorage = createStorage(new MemoryStorage());
for (const [root, invalidValues] of [
  [
    STORAGE_KEYS.discovery,
    [
      {},
      { tipsEnabled: "yes", complete: false },
      { tipsEnabled: true, complete: "yes" },
      { tipsEnabled: true, complete: false, extra: true },
    ],
  ],
  [
    STORAGE_KEYS.environmentPreferences,
    [
      {},
      { timeOfDay: Number.NaN, windEnabled: true },
      { timeOfDay: -1, windEnabled: true },
      { timeOfDay: 25, windEnabled: true },
      { timeOfDay: 12, windEnabled: "yes" },
    ],
  ],
  [
    STORAGE_KEYS.executableTrust,
    [
      {},
      { version: 2, digests: [] },
      { version: 1, digests: "bad" },
      { version: 1, digests: ["bad"] },
      { version: 1, digests: [`x${"a".repeat(64)}`] },
      { version: 1, digests: [`${"a".repeat(64)}x`] },
      { version: 1, digests: ["a".repeat(64), "a".repeat(64)] },
      { version: 1, digests: ["f".repeat(64), "0".repeat(64)] },
    ],
  ],
])
  for (const value of invalidValues)
    assert.equal(shapeStorage.writeJson(root, value).ok, false);
assert.equal(
  shapeStorage.writeJson(STORAGE_KEYS.discovery, {
    tipsEnabled: false,
    complete: true,
  }).ok,
  true,
);
assert.equal(
  shapeStorage.writeJson(STORAGE_KEYS.environmentPreferences, {
    timeOfDay: 18.5,
    windEnabled: false,
  }).ok,
  true,
);
assert.equal(
  shapeStorage.writeJson(STORAGE_KEYS.environmentPreferences, {
    timeOfDay: 0,
    windEnabled: true,
  }).ok,
  true,
);
assert.equal(
  shapeStorage.writeJson(STORAGE_KEYS.environmentPreferences, {
    timeOfDay: 24,
    windEnabled: true,
  }).ok,
  true,
);
for (const value of [[], "object", 4, false])
  assert.equal(shapeStorage.writeJson(STORAGE_KEYS.workspace, value).ok, false);
const isolatedInput = { nested: { value: 1 } };
assert.equal(
  shapeStorage.writeJson(STORAGE_KEYS.workspace, isolatedInput).ok,
  true,
);
isolatedInput.nested.value = 99;
assert.equal(
  shapeStorage.readJson(STORAGE_KEYS.workspace, null).nested.value,
  1,
);

// A damaged current generation falls back only to its validated predecessor.
const secondManifestKey = `${STORAGE_PROTOCOL.manifestPrefix}${secondPointer.manifestId}`,
  secondWorkspaceKey = secondManifest.roots.workspace.key,
  secondWorkspaceRaw = raw.getItem(secondWorkspaceKey);
raw.setItem(secondWorkspaceKey, "corrupt");
assert.deepEqual(storage.readJson(STORAGE_KEYS.workspace, null), workspace);
assert.deepEqual(storage.readJson(STORAGE_KEYS.sharePackages, []), []);
raw.setItem(secondWorkspaceKey, secondWorkspaceRaw);

const firstManifestKey = `${STORAGE_PROTOCOL.manifestPrefix}${firstPointer.manifestId}`,
  firstManifestRaw = raw.getItem(firstManifestKey);
raw.setItem(secondWorkspaceKey, "corrupt");
raw.setItem(firstManifestKey, "corrupt");
const bothInvalid = storage.readEntry(STORAGE_KEYS.workspace);
assert.equal(bothInvalid.ok, false);
assert.equal(bothInvalid.error instanceof AggregateError, true);
raw.setItem(secondWorkspaceKey, secondWorkspaceRaw);
raw.setItem(firstManifestKey, firstManifestRaw);

// Pointer and exact-envelope violations fail closed.
const pointerRaw = raw.getItem(STORAGE_PROTOCOL.pointerKey);
for (const malformed of [
  "{",
  JSON.stringify({ protocolVersion: 0, manifestId: secondPointer.manifestId }),
  JSON.stringify({
    protocolVersion: 2,
    manifestId: secondPointer.manifestId,
    extra: true,
  }),
  JSON.stringify({ protocolVersion: 2, manifestId: "bad" }),
  JSON.stringify({ protocolVersion: 2, manifestId: `x${"a".repeat(32)}` }),
  JSON.stringify({ protocolVersion: 2, manifestId: `${"a".repeat(32)}x` }),
]) {
  raw.setItem(STORAGE_PROTOCOL.pointerKey, malformed);
  assert.equal(storage.readEntry(STORAGE_KEYS.workspace).ok, false);
}
raw.setItem(STORAGE_PROTOCOL.pointerKey, pointerRaw);

const missingManifestPointer = {
  protocolVersion: 1,
  manifestId: "e".repeat(32),
};
raw.setItem(
  STORAGE_PROTOCOL.pointerKey,
  JSON.stringify(missingManifestPointer),
);
assert.equal(storage.readEntry(STORAGE_KEYS.workspace).ok, false);
raw.setItem(STORAGE_PROTOCOL.pointerKey, pointerRaw);

const secondManifestRaw = raw.getItem(secondManifestKey);
for (const mutate of [
  (manifest) => (manifest.protocolVersion = 2),
  (manifest) => (manifest.manifestId = "0".repeat(32)),
  (manifest) => (manifest.generationId = "bad"),
  (manifest) => (manifest.previousManifestId = "bad"),
  (manifest) => (manifest.createdAt = "not-a-date"),
  (manifest) => (manifest.roots.extra = null),
]) {
  const candidate = structuredClone(secondManifest);
  mutate(candidate);
  raw.setItem(secondManifestKey, JSON.stringify(candidate));
  assert.equal(storage.readEntry(STORAGE_KEYS.workspace).ok, false);
}
for (const mutate of [
  (manifest) => (manifest.roots.workspace.extra = true),
  (manifest) => delete manifest.roots.workspace.bytes,
  (manifest) => (manifest.roots.workspace.bytes = 1.5),
  (manifest) => (manifest.roots.workspace.bytes = -1),
  (manifest) => (manifest.roots.workspace.sha256 = "0".repeat(64)),
  (manifest) => (manifest.roots.workspace.key += ".wrong"),
]) {
  const candidate = structuredClone(secondManifest);
  mutate(candidate);
  raw.setItem(secondManifestKey, JSON.stringify(candidate));
  // A valid manifest envelope can name its predecessor for recovery.
  assert.deepEqual(storage.readJson(STORAGE_KEYS.workspace, null), workspace);
}
raw.setItem(secondManifestKey, secondManifestRaw);

const secondWorkspaceReference = secondManifest.roots.workspace,
  secondWorkspaceCanonical = raw.getItem(secondWorkspaceReference.key);
raw.removeItem(secondWorkspaceReference.key);
assert.deepEqual(storage.readJson(STORAGE_KEYS.workspace, null), workspace);
raw.setItem(secondWorkspaceReference.key, secondWorkspaceCanonical);
for (const replacement of [
  {
    encoded: `${secondWorkspaceCanonical} `,
    bytes: secondWorkspaceReference.bytes,
    sha256: sha256Hex(`${secondWorkspaceCanonical} `),
  },
  {
    encoded: `${secondWorkspaceCanonical} `,
    bytes: new TextEncoder().encode(`${secondWorkspaceCanonical} `).byteLength,
    sha256: secondWorkspaceReference.sha256,
  },
  {
    encoded: "[]",
    bytes: 2,
    sha256: sha256Hex("[]"),
  },
]) {
  const candidate = structuredClone(secondManifest);
  candidate.roots.workspace.bytes = replacement.bytes;
  candidate.roots.workspace.sha256 = replacement.sha256;
  raw.setItem(secondManifestKey, JSON.stringify(candidate));
  raw.setItem(secondWorkspaceReference.key, replacement.encoded);
  assert.deepEqual(storage.readJson(STORAGE_KEYS.workspace, null), workspace);
}
raw.setItem(secondManifestKey, secondManifestRaw);
raw.setItem(secondWorkspaceReference.key, secondWorkspaceCanonical);

// Failures before the pointer switch leave the previous commit authoritative.
for (const [label, predicate] of [
  ["generation", (key) => key.startsWith(STORAGE_PROTOCOL.generationPrefix)],
  ["manifest", (key) => key.startsWith(STORAGE_PROTOCOL.manifestPrefix)],
  ["pointer", (key) => key === STORAGE_PROTOCOL.pointerKey],
]) {
  const before = raw.getItem(STORAGE_PROTOCOL.pointerKey),
    prior = storage.readJson(STORAGE_KEYS.challengeBest, {});
  raw.failNext(predicate, `${label} failure`);
  const result = storage.writeJson(STORAGE_KEYS.challengeBest, {
    score: label.length,
  });
  assert.equal(result.ok, false);
  assert.equal(raw.getItem(STORAGE_PROTOCOL.pointerKey), before);
  assert.deepEqual(storage.readJson(STORAGE_KEYS.challengeBest, {}), prior);
}
assert.equal(storage.collectGarbage().ok, true);

// Canonical empty values are null references, not empty blobs.
assert.equal(storage.writeJson(STORAGE_KEYS.challengeBest, {}).ok, true);
const emptyManifest = manifestFor(raw);
assert.equal(emptyManifest.roots.challengeBest, null);
assert.equal(storage.remove(STORAGE_KEYS.sharePackages).ok, true);
assert.deepEqual(storage.readJson(STORAGE_KEYS.sharePackages, []), []);

// Sustained commits continuously collect unreachable v1 records.
nextId = 0;
const quotaRaw = new QuotaStorage(8),
  quotaStorage = createStorage(quotaRaw);
for (let sequence = 0; sequence < 100; sequence++) {
  const result = quotaStorage.writeJson(STORAGE_KEYS.challengeBest, {
    sequence,
  });
  assert.equal(result.ok, true, `commit ${sequence} exceeded quota`);
  assert.equal(result.garbageCollection.ok, true);
}
assert.deepEqual(quotaStorage.readJson(STORAGE_KEYS.challengeBest, null), {
  sequence: 99,
});

// Reset commits a non-fallback empty snapshot, then cleans only this namespace.
nextId = 1000;
const resetRaw = new MemoryStorage({
    unrelated: "keep me",
    "simulacrum.workspace": "old",
    "simulacrum.parts": "old",
  }),
  resetStorage = createStorage(resetRaw);
assert.equal(
  resetStorage.writeJson(STORAGE_KEYS.executableTrust, {
    version: 1,
    digests: ["a".repeat(64)],
  }).ok,
  true,
);
assert.equal(
  resetStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
const reset = resetStorage.resetNamespace();
assert.equal(reset.ok, true);
assert.equal(reset.logicalReset, true);
assert.equal(reset.warnings.length, 0);
const resetPointer = parseAt(resetRaw, STORAGE_PROTOCOL.pointerKey),
  resetManifest = manifestFor(resetRaw, resetPointer);
assert.equal(resetManifest.previousManifestId, null);
assert.ok(Object.values(resetManifest.roots).every((value) => value === null));
assert.deepEqual(resetStorage.readJson(STORAGE_KEYS.workspace, null), null);
assert.deepEqual(
  resetStorage.readJson(STORAGE_KEYS.executableTrust, null),
  null,
);
assert.equal(resetRaw.getItem("simulacrum.workspace"), null);
assert.equal(resetRaw.getItem("simulacrum.parts"), null);
assert.equal(resetRaw.getItem("unrelated"), "keep me");

// Cleanup failure after the pointer switch is a warning and cannot resurrect data.
const warningRaw = new MemoryStorage({ "simulacrum.orphan": "old" }),
  warningStorage = createStorage(warningRaw);
assert.equal(
  warningStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
warningRaw.failNext(
  (key, operation) => key === "simulacrum.orphan" && operation === "remove",
  "cleanup denied",
);
const warningReset = warningStorage.resetNamespace();
assert.equal(warningReset.ok, true);
assert.equal(warningReset.warnings.length, 1);
assert.deepEqual(warningStorage.readJson(STORAGE_KEYS.workspace, null), null);
assert.equal(manifestFor(warningRaw).previousManifestId, null);

const protocolCleanupRaw = new MemoryStorage(),
  protocolCleanupStorage = createStorage(protocolCleanupRaw);
assert.equal(
  protocolCleanupStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
const originalProtocolRemove =
  protocolCleanupRaw.removeItem.bind(protocolCleanupRaw);
protocolCleanupRaw.removeItem = (key) => {
  if (
    key.startsWith(STORAGE_PROTOCOL.manifestPrefix) ||
    key.startsWith(STORAGE_PROTOCOL.generationPrefix)
  )
    throw new DOMException("protocol cleanup denied", "SecurityError");
  originalProtocolRemove(key);
};
const protocolWarningReset = protocolCleanupStorage.resetNamespace();
assert.equal(protocolWarningReset.ok, true);
assert.ok(protocolWarningReset.warnings.length > 0);
assert.deepEqual(
  protocolCleanupStorage.readJson(STORAGE_KEYS.workspace, null),
  null,
);

const verificationRaw = new MemoryStorage({
    "simulacrum.verify-trigger": "old",
  }),
  verificationStorage = createStorage(verificationRaw);
assert.equal(
  verificationStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
const originalVerificationGet = verificationRaw.getItem.bind(verificationRaw),
  originalVerificationRemove = verificationRaw.removeItem.bind(verificationRaw);
let corruptVerificationRead = false;
verificationRaw.removeItem = (key) => {
  originalVerificationRemove(key);
  if (key === "simulacrum.verify-trigger") corruptVerificationRead = true;
};
verificationRaw.getItem = (key) =>
  corruptVerificationRead && key === STORAGE_PROTOCOL.pointerKey
    ? "{"
    : originalVerificationGet(key);
const verificationReset = verificationStorage.resetNamespace();
assert.equal(verificationReset.ok, false);
assert.equal(verificationReset.pointerCommitted, true);
assert.equal(verificationReset.logicalReset, true);
assert.match(verificationReset.error.message, /valid JSON/);

// A pointer-switch failure means reset did not logically happen.
const failedResetRaw = new MemoryStorage(),
  failedResetStorage = createStorage(failedResetRaw);
assert.equal(
  failedResetStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
const beforeFailedReset = failedResetRaw.getItem(STORAGE_PROTOCOL.pointerKey);
failedResetRaw.failNext((key) => key === STORAGE_PROTOCOL.pointerKey);
const failedReset = failedResetStorage.resetNamespace();
assert.equal(failedReset.ok, false);
assert.equal(failedReset.pointerCommitted, false);
assert.equal(
  failedResetRaw.getItem(STORAGE_PROTOCOL.pointerKey),
  beforeFailedReset,
);
assert.deepEqual(
  failedResetStorage.readJson(STORAGE_KEYS.workspace, null),
  workspace,
);

// Unavailable browser storage and unavailable enumeration fail safely.
const denied = {
  getItem() {
    throw new DOMException("denied", "SecurityError");
  },
  setItem() {
    throw new DOMException("denied", "SecurityError");
  },
};
assert.deepEqual(
  createStorage(denied).readJson(STORAGE_KEYS.workspace, null),
  null,
);
assert.equal(
  createStorage(denied).writeJson(STORAGE_KEYS.workspace, workspace).ok,
  false,
);
assert.equal(createStorage(null).collectGarbage().ok, false);
const unsupportedRaw = {
    values: new Map(),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
  },
  unsupportedStorage = createStorage(unsupportedRaw);
assert.equal(
  unsupportedStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
assert.equal(unsupportedStorage.collectGarbage().unsupported, true);
const unsupportedReset = unsupportedStorage.resetNamespace();
assert.equal(unsupportedReset.ok, true);
assert.equal(unsupportedReset.warnings.length, 1);

for (const incomplete of [
  {
    length: 0,
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  },
  {
    length: 0,
    getItem() {
      return null;
    },
    setItem() {},
    key() {
      return null;
    },
  },
])
  assert.equal(createStorage(incomplete).collectGarbage().unsupported, true);

const invalidIdStorage = new BrowserStorage(new MemoryStorage(), {
  logger,
  idFactory: () => "bad",
});
assert.equal(
  invalidIdStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  false,
);
for (const id of [`x${"a".repeat(32)}`, `${"a".repeat(32)}x`])
  assert.equal(
    new BrowserStorage(new MemoryStorage(), {
      logger,
      idFactory: () => id,
    }).writeJson(STORAGE_KEYS.workspace, workspace).ok,
    false,
  );
for (const clockValue of ["not-a-date", "2026-07-17T00:00:00Z", 123])
  assert.equal(
    new BrowserStorage(new MemoryStorage(), {
      logger,
      idFactory: deterministicId,
      clock: () => clockValue,
    }).writeJson(STORAGE_KEYS.workspace, workspace).ok,
    false,
  );
const unverifiableRaw = new MemoryStorage();
unverifiableRaw.setItem = () => {};
assert.equal(
  createStorage(unverifiableRaw).writeJson(STORAGE_KEYS.workspace, workspace)
    .ok,
  false,
);

const localStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  get() {
    throw new DOMException("blocked", "SecurityError");
  },
});
assert.equal(
  new BrowserStorage(undefined, { logger }).readEntry(STORAGE_KEYS.workspace)
    .ok,
  false,
);
if (localStorageDescriptor)
  Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
else delete globalThis.localStorage;

// The default ID source also conforms to the exact v1 identifier contract.
const randomRaw = new MemoryStorage(),
  randomStorage = new BrowserStorage(randomRaw, { logger });
assert.equal(
  randomStorage.writeJson(STORAGE_KEYS.workspace, workspace).ok,
  true,
);
assert.match(
  parseAt(randomRaw, STORAGE_PROTOCOL.pointerKey).manifestId,
  /^[0-9a-f]{32}$/,
);

const settingsRaw = new MemoryStorage(),
  settingsStorage = createStorage(settingsRaw),
  discovery = new BrowserDiscoveryRepository({ storage: settingsStorage }),
  environment = new BrowserEnvironmentPreferencesRepository({
    storage: settingsStorage,
  });
assert.deepEqual(discovery.load(), { tipsEnabled: true, complete: false });
assert.equal(discovery.setTipsEnabled(false).ok, true);
assert.equal(discovery.setComplete(true).ok, true);
assert.deepEqual(discovery.load(), { tipsEnabled: false, complete: true });
assert.deepEqual(environment.load(), { timeOfDay: 14, windEnabled: true });
assert.equal(environment.setTimeOfDay(19.5).ok, true);
assert.equal(environment.setWindEnabled(false).ok, true);
assert.deepEqual(environment.load(), { timeOfDay: 19.5, windEnabled: false });
assert.equal(environment.setTimeOfDay(25).ok, false);
assert.deepEqual(environment.load(), { timeOfDay: 19.5, windEnabled: false });

console.log(
  `browser storage v1 passed (${APPLICATION_STORAGE_ROOTS.length} owned roots, transactional reset verified)`,
);
