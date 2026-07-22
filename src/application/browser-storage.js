import { stableStringify } from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";

export const STORAGE_KEYS = Object.freeze({
  workspace: "workspace",
  subassemblies: "subassemblyLibrary",
  sharePackages: "sharePackages",
  shareSocial: "shareSocial",
  shareOrigins: "shareOrigins",
  challengeRecords: "challengeRecords",
  challengeBest: "challengeBest",
  discovery: "discovery",
  environmentPreferences: "environmentPreferences",
  executableTrust: "executableTrust",
});

export const STORAGE_ROOT_OWNERS = Object.freeze({
  workspace: "workspace",
  subassemblyLibrary: "subassembly",
  sharePackages: "share",
  shareSocial: "share",
  shareOrigins: "share",
  challengeRecords: "challenge",
  challengeBest: "challenge",
  discovery: "discovery",
  environmentPreferences: "preferences",
  executableTrust: "trust",
});

export const APPLICATION_STORAGE_ROOTS = Object.freeze(
  Object.keys(STORAGE_ROOT_OWNERS),
);

export const STORAGE_PROTOCOL = Object.freeze({
  version: 1,
  pointerKey: "simulacrum.v1.storage.commit",
  manifestPrefix: "simulacrum.v1.storage.manifest.",
  generationPrefix: "simulacrum.v1.storage.generation.",
});

const ID_PATTERN = /^[0-9a-f]{32}$/,
  SHA_PATTERN = /^[0-9a-f]{64}$/,
  ROOT_SET = new Set(APPLICATION_STORAGE_ROOTS),
  EMPTY_ROOTS = Object.freeze({
    workspace: null,
    subassemblyLibrary: [],
    sharePackages: [],
    shareSocial: {},
    shareOrigins: {},
    challengeRecords: [],
    challengeBest: {},
    discovery: null,
    environmentPreferences: null,
    executableTrust: null,
  });

const clone = (value) => (value == null ? value : structuredClone(value)),
  isObject = (value) =>
    Boolean(value) && typeof value === "object" && !Array.isArray(value),
  exactKeys = (value, keys) =>
    isObject(value) &&
    Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"),
  canonicalIso = (value) =>
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value,
  byteLength = (value) => new TextEncoder().encode(value).byteLength;

function rootShapeIsValid(root, value) {
  if (value === null) return true;
  switch (root) {
    case "workspace":
      return isObject(value);
    case "subassemblyLibrary":
    case "sharePackages":
    case "challengeRecords":
      return Array.isArray(value);
    case "shareSocial":
    case "shareOrigins":
    case "challengeBest":
      return isObject(value);
    case "discovery":
      return (
        exactKeys(value, ["tipsEnabled", "complete"]) &&
        typeof value.tipsEnabled === "boolean" &&
        typeof value.complete === "boolean"
      );
    case "environmentPreferences":
      return (
        exactKeys(value, ["timeOfDay", "windEnabled"]) &&
        Number.isFinite(value.timeOfDay) &&
        value.timeOfDay >= 0 &&
        value.timeOfDay <= 24 &&
        typeof value.windEnabled === "boolean"
      );
    case "executableTrust":
      return (
        exactKeys(value, ["version", "digests"]) &&
        value.version === 1 &&
        Array.isArray(value.digests) &&
        value.digests.every((digest) => SHA_PATTERN.test(digest)) &&
        new Set(value.digests).size === value.digests.length &&
        [...value.digests]
          .sort()
          .every((digest, index) => digest === value.digests[index])
      );
    default:
      return false;
  }
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function normalizedUpdate(update) {
  if (!isObject(update) || typeof update.key !== "string")
    throw new TypeError("Storage batch entries require a string root");
  if (!ROOT_SET.has(update.key))
    throw new TypeError(`Unknown storage root ${update.key}`);
  if (update.remove) return { key: update.key, remove: true };
  if (update.encoding !== "json")
    throw new TypeError(`Storage root ${update.key} requires JSON encoding`);
  if (!rootShapeIsValid(update.key, update.value))
    throw new TypeError(`Storage root ${update.key} has an invalid value`);
  return { key: update.key, value: clone(update.value) };
}

function emptyValues() {
  return Object.fromEntries(
    APPLICATION_STORAGE_ROOTS.map((root) => [root, clone(EMPTY_ROOTS[root])]),
  );
}

/**
 * Transactional browser persistence for the storage-v1 namespace. The current
 * pointer is the sole authority; flat keys and alternate namespaces are never
 * read or mirrored.
 */
export class BrowserStorage {
  #storage = null;
  #acquisitionError = null;
  #idFactory;
  #clock;

  /**
   * @param {any} storage
   * @param {{logger?: Pick<Console, "warn">, idFactory?: null | ((kind: string) => string), clock?: () => string}} [options]
   */
  constructor(
    storage,
    { logger = console, idFactory = null, clock = null } = {},
  ) {
    this.logger = logger;
    this.#idFactory = idFactory;
    this.#clock = clock || (() => new Date().toISOString());
    try {
      this.#storage = storage === undefined ? globalThis.localStorage : storage;
    } catch (error) {
      this.#acquisitionError = error;
      this.logger.warn("Browser persistence is unavailable", error);
    }
  }

  #requireStorage() {
    if (this.#acquisitionError) throw this.#acquisitionError;
    if (!this.#storage) throw new Error("browser storage is unavailable");
    return this.#storage;
  }

  #rawGet(key) {
    return this.#requireStorage().getItem(key);
  }

  #nextId(kind) {
    const supplied = this.#idFactory?.(kind),
      generated =
        supplied ||
        globalThis.crypto?.randomUUID?.().replaceAll("-", "") ||
        Array.from({ length: 4 }, () =>
          Math.floor(Math.random() * 0x1_0000_0000)
            .toString(16)
            .padStart(8, "0"),
        ).join("");
    if (!ID_PATTERN.test(generated))
      throw new Error(`${kind} ID must be 32 lowercase hexadecimal characters`);
    return generated;
  }

  #writeVerified(key, value) {
    const storage = this.#requireStorage();
    storage.setItem(key, value);
    if (storage.getItem(key) !== value)
      throw new Error(`Storage write could not be verified for ${key}`);
  }

  #readManifestEnvelope(manifestId) {
    if (!ID_PATTERN.test(manifestId || ""))
      throw new Error("Manifest ID is invalid");
    const key = `${STORAGE_PROTOCOL.manifestPrefix}${manifestId}`,
      raw = this.#rawGet(key);
    if (raw == null) throw new Error(`Manifest ${manifestId} is missing`);
    const manifest = parseJson(raw, `Manifest ${manifestId}`);
    if (
      !exactKeys(manifest, [
        "protocolVersion",
        "manifestId",
        "generationId",
        "previousManifestId",
        "createdAt",
        "roots",
      ]) ||
      manifest.protocolVersion !== STORAGE_PROTOCOL.version ||
      manifest.manifestId !== manifestId ||
      !ID_PATTERN.test(manifest.generationId || "") ||
      (manifest.previousManifestId !== null &&
        !ID_PATTERN.test(manifest.previousManifestId || "")) ||
      !canonicalIso(manifest.createdAt) ||
      !exactKeys(manifest.roots, APPLICATION_STORAGE_ROOTS)
    )
      throw new Error(`Manifest ${manifestId} is malformed`);
    return manifest;
  }

  #readManifest(manifestId) {
    const manifest = this.#readManifestEnvelope(manifestId),
      values = emptyValues(),
      entries = new Map();
    for (const root of APPLICATION_STORAGE_ROOTS) {
      const reference = manifest.roots[root];
      if (reference === null) continue;
      const expectedKey = `${STORAGE_PROTOCOL.generationPrefix}${manifest.generationId}.${root}`;
      if (
        !exactKeys(reference, ["key", "bytes", "sha256"]) ||
        reference.key !== expectedKey ||
        !Number.isSafeInteger(reference.bytes) ||
        reference.bytes < 0 ||
        !SHA_PATTERN.test(reference.sha256 || "")
      )
        throw new Error(`Manifest reference for ${root} is malformed`);
      const encoded = this.#rawGet(reference.key);
      if (encoded == null) throw new Error(`Generation for ${root} is missing`);
      if (
        byteLength(encoded) !== reference.bytes ||
        sha256Hex(encoded) !== reference.sha256
      )
        throw new Error(`Generation for ${root} failed manifest validation`);
      const value = parseJson(encoded, `Generation ${root}`);
      if (!rootShapeIsValid(root, value))
        throw new Error(`Generation for ${root} has an invalid value`);
      values[root] = value;
      entries.set(root, { encoded, reference: clone(reference) });
    }
    return {
      manifestId,
      generationId: manifest.generationId,
      previousManifestId: manifest.previousManifestId,
      manifest,
      values,
      entries,
    };
  }

  #emptySnapshot() {
    return {
      manifestId: null,
      generationId: null,
      previousManifestId: null,
      manifest: null,
      values: emptyValues(),
      entries: new Map(),
    };
  }

  #loadSnapshot() {
    const rawPointer = this.#rawGet(STORAGE_PROTOCOL.pointerKey);
    if (rawPointer == null) return this.#emptySnapshot();
    const pointer = parseJson(rawPointer, "Storage commit pointer");
    if (
      !exactKeys(pointer, ["protocolVersion", "manifestId"]) ||
      pointer.protocolVersion !== STORAGE_PROTOCOL.version ||
      !ID_PATTERN.test(pointer.manifestId || "")
    )
      throw new Error("Storage commit pointer is malformed");
    let envelope;
    try {
      envelope = this.#readManifestEnvelope(pointer.manifestId);
      return this.#readManifest(pointer.manifestId);
    } catch (currentError) {
      if (!envelope?.previousManifestId) throw currentError;
      try {
        const previous = this.#readManifest(envelope.previousManifestId);
        this.logger.warn(
          `Storage manifest ${pointer.manifestId} is invalid; using ${envelope.previousManifestId}`,
          currentError,
        );
        return previous;
      } catch (previousError) {
        throw new AggregateError(
          [currentError, previousError],
          "Current and previous storage manifests are invalid",
          { cause: previousError },
        );
      }
    }
  }

  readEntry(root) {
    if (!ROOT_SET.has(root))
      return {
        ok: false,
        found: false,
        value: null,
        error: new TypeError(`Unknown storage root ${root}`),
      };
    try {
      const snapshot = this.#loadSnapshot(),
        entry = snapshot.entries.get(root);
      return entry
        ? {
            ok: true,
            found: true,
            source: "storage-v1",
            encoding: "json",
            value: entry.encoded,
          }
        : { ok: true, found: false, source: "storage-v1", value: null };
    } catch (error) {
      this.logger.warn(`Could not read persisted value for ${root}`, error);
      return { ok: false, found: false, value: null, error };
    }
  }

  readJson(root, fallback) {
    const result = this.readEntry(root);
    if (!result.ok || !result.found) return clone(fallback);
    return JSON.parse(result.value);
  }

  writeJson(root, value) {
    return this.commitOwned(STORAGE_ROOT_OWNERS[root], [
      { key: root, encoding: "json", value },
    ]);
  }

  remove(root) {
    return this.commitOwned(STORAGE_ROOT_OWNERS[root], [
      { key: root, remove: true },
    ]);
  }

  commitBatch(updates) {
    try {
      const normalized = updates.map(normalizedUpdate),
        owners = new Set(
          normalized.map((update) => STORAGE_ROOT_OWNERS[update.key]),
        );
      if (owners.size !== 1)
        throw new TypeError("Storage batch must belong to exactly one owner");
      return this.commitOwned([...owners][0], updates);
    } catch (error) {
      this.logger.warn("Browser persistence transaction failed", error);
      return { ok: false, error, pointerCommitted: false, manifestId: null };
    }
  }

  commitOwned(owner, updates) {
    let pointerCommitted = false,
      manifestId = null;
    try {
      if (!Array.isArray(updates) || !updates.length)
        throw new TypeError("Storage batch must contain at least one update");
      const normalized = updates.map(normalizedUpdate);
      if (
        normalized.some((update) => STORAGE_ROOT_OWNERS[update.key] !== owner)
      )
        throw new TypeError(`Storage owner ${owner} cannot update this root`);
      if (
        new Set(normalized.map((update) => update.key)).size !==
        normalized.length
      )
        throw new TypeError("Storage batch contains duplicate roots");
      const previous = this.#loadSnapshot(),
        values = clone(previous.values);
      this.collectGarbage();
      for (const update of normalized)
        values[update.key] = update.remove
          ? clone(EMPTY_ROOTS[update.key])
          : clone(update.value);
      const committed = this.#commitValues(values, previous.manifestId);
      pointerCommitted = committed.pointerCommitted;
      manifestId = committed.manifestId;
      return committed;
    } catch (error) {
      this.logger.warn("Browser persistence transaction failed", error);
      return { ok: false, error, pointerCommitted, manifestId };
    }
  }

  #commitValues(values, previousManifestId) {
    const generationId = this.#nextId("generation"),
      manifestId = this.#nextId("manifest"),
      roots = Object.fromEntries(
        APPLICATION_STORAGE_ROOTS.map((root) => [root, null]),
      );
    for (const root of APPLICATION_STORAGE_ROOTS) {
      const value = values[root];
      if (!rootShapeIsValid(root, value))
        throw new TypeError(`Storage root ${root} has an invalid value`);
      if (stableStringify(value) === stableStringify(EMPTY_ROOTS[root]))
        continue;
      const encoded = stableStringify(value),
        key = `${STORAGE_PROTOCOL.generationPrefix}${generationId}.${root}`;
      this.#writeVerified(key, encoded);
      roots[root] = {
        key,
        bytes: byteLength(encoded),
        sha256: sha256Hex(encoded),
      };
    }
    const manifest = {
        protocolVersion: STORAGE_PROTOCOL.version,
        manifestId,
        generationId,
        previousManifestId,
        createdAt: this.#clock(),
        roots,
      },
      manifestKey = `${STORAGE_PROTOCOL.manifestPrefix}${manifestId}`;
    if (!canonicalIso(manifest.createdAt))
      throw new Error("Storage clock must return a canonical ISO timestamp");
    this.#writeVerified(manifestKey, stableStringify(manifest));
    this.#readManifest(manifestId);
    const pointer = {
      protocolVersion: STORAGE_PROTOCOL.version,
      manifestId,
    };
    this.#writeVerified(STORAGE_PROTOCOL.pointerKey, stableStringify(pointer));
    const committed = this.#loadSnapshot();
    if (committed.manifestId !== manifestId)
      throw new Error("Storage pointer switch could not be verified");
    const garbageCollection = this.collectGarbage();
    return {
      ok: true,
      pointerCommitted: true,
      manifestId,
      previousManifestId,
      garbageCollection,
    };
  }

  collectGarbage({ retainPrevious = true } = {}) {
    try {
      const storage = this.#requireStorage();
      if (
        !Number.isSafeInteger(storage.length) ||
        typeof storage.key !== "function" ||
        typeof storage.removeItem !== "function"
      )
        return { ok: true, removed: [], unsupported: true };
      const snapshot = this.#loadSnapshot(),
        manifests = snapshot.manifestId ? [snapshot.manifestId] : [];
      if (retainPrevious && snapshot.previousManifestId)
        manifests.push(snapshot.previousManifestId);
      const keep = /** @type {Set<string>} */ (
        new Set([STORAGE_PROTOCOL.pointerKey])
      );
      for (const id of manifests) {
        const manifest = this.#readManifest(id);
        keep.add(`${STORAGE_PROTOCOL.manifestPrefix}${id}`);
        for (const entry of manifest.entries.values())
          keep.add(entry.reference.key);
      }
      const candidates = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (
          key &&
          (key.startsWith(STORAGE_PROTOCOL.manifestPrefix) ||
            key.startsWith(STORAGE_PROTOCOL.generationPrefix)) &&
          !keep.has(key)
        )
          candidates.push(key);
      }
      for (const key of candidates) storage.removeItem(key);
      return { ok: true, removed: candidates };
    } catch (error) {
      this.logger.warn("Storage garbage collection failed", error);
      return { ok: false, removed: [], error };
    }
  }

  resetNamespace() {
    let committed;
    try {
      committed = this.#commitValues(emptyValues(), null);
    } catch (error) {
      this.logger.warn("Browser persistence reset failed", error);
      return { ok: false, pointerCommitted: false, error, warnings: [] };
    }
    const warnings = [],
      garbage = this.collectGarbage({ retainPrevious: false });
    if (!garbage.ok) warnings.push(garbage.error);
    try {
      const storage = this.#requireStorage(),
        keep = new Set([
          STORAGE_PROTOCOL.pointerKey,
          `${STORAGE_PROTOCOL.manifestPrefix}${committed.manifestId}`,
        ]);
      if (
        !Number.isSafeInteger(storage.length) ||
        typeof storage.key !== "function" ||
        typeof storage.removeItem !== "function"
      )
        warnings.push(new Error("Orphan cleanup is unavailable"));
      else {
        const candidates = [];
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (key?.startsWith("simulacrum.") && !keep.has(key))
            candidates.push(key);
        }
        for (const key of candidates)
          try {
            storage.removeItem(key);
          } catch (error) {
            warnings.push(error);
          }
      }
      const verified = this.#loadSnapshot();
      if (
        verified.manifestId !== committed.manifestId ||
        verified.entries.size !== 0 ||
        verified.previousManifestId !== null
      )
        throw new Error("Empty storage reset could not be verified");
    } catch (error) {
      return {
        ok: false,
        pointerCommitted: true,
        logicalReset: true,
        manifestId: committed.manifestId,
        error,
        warnings,
      };
    }
    return {
      ok: true,
      pointerCommitted: true,
      logicalReset: true,
      manifestId: committed.manifestId,
      warnings,
    };
  }
}
