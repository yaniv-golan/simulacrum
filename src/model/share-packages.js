import {
  validateProofWire,
  validateSharePackageWire,
} from "./generated/share-wire-validators.js";
import { DomainValidationError, stableStringify } from "./primitives.js";
import { SUBASSEMBLY_FORMAT } from "./subassemblies.js";
import {
  ASSET_FINGERPRINT_PATTERN,
  fingerprintAsset,
  normalizePortableAsset,
} from "./portable-asset-identity.js";
import { validateWireInput } from "./wire-validation.js";

export { fingerprintAsset } from "./portable-asset-identity.js";

export const SHARE_FORMAT = "simulacrum-share-package";
export const SHARE_VERSION = 1;
export const SHARE_KINDS = Object.freeze(["blueprint", "subassembly"]);
export const MAX_SHARE_BYTES = 2_000_000;

function text(value, limit) {
  return String(value ?? "")
    .trim()
    .slice(0, limit);
}

function canonicalTimestamp(value, fallback) {
  const candidate = text(value, 40) || fallback;
  if (!Number.isFinite(Date.parse(candidate)))
    throw new Error("Share timestamps must be valid ISO dates");
  return new Date(candidate).toISOString();
}

function normalizeTags(tags) {
  return [
    ...new Set(
      (Array.isArray(tags) ? tags : String(tags || "").split(","))
        .map((tag) => text(tag, 24).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 8);
}

function normalizeThumbnail(value) {
  const thumbnail = String(value || "");
  if (!thumbnail) return "";
  if (
    !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(
      thumbnail,
    ) ||
    thumbnail.length > 90_000
  )
    throw new Error("Invalid or oversized blueprint thumbnail");
  return thumbnail;
}

function dependenciesFor(asset, extensions = undefined) {
  const parts = asset.parts || [];
  return {
    componentTypes: [...new Set(parts.map((part) => part.type))].sort(),
    controllerLanguages: [
      ...new Set(
        parts
          .filter((part) => part.type === "computer")
          .map((part) => part.scriptLanguage),
      ),
    ].sort(),
    partCount: parts.length,
    connectionCount: asset.connections.length,
    ...(extensions ? { extensions: structuredClone(extensions) } : {}),
  };
}

/** @param {string} code @param {string} message @param {readonly any[]} path @param {number|undefined} index */
function issue(code, message, path = [], index = undefined) {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    message,
    ...(index == null ? {} : { index }),
  });
}

function issueFromError(error, fallbackCode, index = undefined) {
  const code =
    error instanceof DomainValidationError ? error.code : fallbackCode;
  return issue(
    code,
    error instanceof Error ? error.message : String(error),
    error instanceof DomainValidationError ? error.path : [],
    index,
  );
}

function packageIssueFromError(error) {
  if (error instanceof DomainValidationError) {
    if (
      [
        "UNSUPPORTED_SHARE_VERSION",
        "ASSET_KIND_MISMATCH",
        "ASSET_FINGERPRINT_MISMATCH",
        "UNSAFE_EXECUTABLE",
      ].includes(error.code)
    )
      return issue(error.code, error.message, error.path);
    if (error.code === "WIRE_BYTE_LIMIT")
      return issue("PACKAGE_TOO_LARGE", error.message, error.path);
  }
  return issue(
    "INVALID_SHARE_PACKAGE",
    error instanceof Error ? error.message : String(error),
    error instanceof DomainValidationError ? error.path : [],
  );
}

function proofPartIds(binding) {
  if (binding.kind === "mechanism")
    return [binding.inputPartId, binding.outputPartId];
  if (binding.kind === "payload")
    return [binding.rootPartId, binding.payloadPartId];
  return [binding.rootPartId];
}

function decodeProof(input, asset, fingerprint) {
  const envelope = validateWireInput(input, "proof", validateProofWire);
  const proof = envelope.value;
  if (proof.assetFingerprint !== fingerprint)
    throw new DomainValidationError(
      "INVALID_PROOF",
      "Proof fingerprint does not match the shared asset",
      { path: ["assetFingerprint"] },
    );
  if (!Number.isFinite(Date.parse(proof.recordedAt)))
    throw new DomainValidationError(
      "INVALID_PROOF",
      "Proof recordedAt must be an ISO date",
      { path: ["recordedAt"] },
    );
  const partById = new Map(asset.parts.map((part) => [part.id, part]));
  for (const partId of proofPartIds(proof.binding))
    if (!partById.has(partId))
      throw new DomainValidationError(
        "INVALID_PROOF",
        `Proof binding references missing part ${partId}`,
        { path: ["binding"] },
      );
  const controllerIds = new Set();
  for (const [index, program] of proof.controllerPrograms.entries()) {
    if (controllerIds.has(program.partId))
      throw new DomainValidationError(
        "INVALID_PROOF",
        `Duplicate controller program ${program.partId}`,
        { path: ["controllerPrograms", index, "partId"] },
      );
    controllerIds.add(program.partId);
    if (partById.get(program.partId)?.type !== "computer")
      throw new DomainValidationError(
        "INVALID_PROOF",
        `Controller program ${program.partId} does not reference a computer`,
        { path: ["controllerPrograms", index, "partId"] },
      );
  }
  const ordered = [...proof.controllerPrograms].sort(
    (left, right) => left.partId - right.partId,
  );
  if (stableStringify(ordered) !== stableStringify(proof.controllerPrograms))
    throw new DomainValidationError(
      "INVALID_PROOF",
      "Controller programs must be sorted by part ID",
      { path: ["controllerPrograms"] },
    );
  return structuredClone(proof);
}

function assertPackageSemantics(candidate, asset, fingerprint) {
  const expectedFormat =
    candidate.kind === "blueprint"
      ? "simulacrum-blueprint"
      : SUBASSEMBLY_FORMAT;
  if (candidate.asset.format !== expectedFormat)
    throw new DomainValidationError(
      "ASSET_KIND_MISMATCH",
      "Shared asset format does not match package kind",
      { path: ["asset", "format"] },
    );
  if (candidate.fingerprint !== fingerprint)
    throw new DomainValidationError(
      "ASSET_FINGERPRINT_MISMATCH",
      "Share package fingerprint does not match its contents",
      { path: ["fingerprint"] },
    );
  const expectedDependencies = dependenciesFor(
    asset,
    candidate.dependencies.extensions,
  );
  if (
    stableStringify(candidate.dependencies) !==
    stableStringify(expectedDependencies)
  )
    throw new DomainValidationError(
      "INVALID_SHARE_PACKAGE",
      "Share package dependencies do not match its asset",
      { path: ["dependencies"] },
    );
  const { parentFingerprint, rootFingerprint, remixDepth } =
    candidate.provenance;
  if (
    (parentFingerprint === null &&
      (remixDepth !== 0 || rootFingerprint !== fingerprint)) ||
    (parentFingerprint !== null &&
      (remixDepth < 1 ||
        parentFingerprint === fingerprint ||
        rootFingerprint === fingerprint))
  )
    throw new DomainValidationError(
      "INVALID_SHARE_PACKAGE",
      "Share package provenance is internally inconsistent",
      { path: ["provenance"] },
    );
}

function containsUnsafeExecutableClaim(value) {
  if (!value || typeof value !== "object") return false;
  for (const key of [
    "acquisition",
    "executableDigest",
    "programAcquisition",
    "programAcquisitionByController",
    "programTrust",
    "trustDigest",
    "trustGrant",
    "trusted",
  ])
    if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some(containsUnsafeExecutableClaim);
}

/** Total strict import boundary. Invalid proof attachments become warnings. */
export async function decodeSharePackage(input) {
  let candidate;
  try {
    let preview = input;
    if (typeof input === "string") preview = JSON.parse(input);
    if (preview?.format && preview.format !== SHARE_FORMAT)
      throw new DomainValidationError(
        "INVALID_SHARE_PACKAGE",
        "Player sharing accepts only a share-package v1 envelope",
        { path: ["format"] },
      );
    if (containsUnsafeExecutableClaim(preview?.asset))
      return Object.freeze({
        ok: false,
        item: null,
        warnings: Object.freeze([]),
        errors: Object.freeze([
          issue(
            "UNSAFE_EXECUTABLE",
            "Portable assets cannot claim executable trust or acquisition",
            ["asset"],
          ),
        ]),
      });
    const envelope = validateWireInput(
      input,
      "share-package",
      validateSharePackageWire,
    );
    candidate = envelope.value;
    const expectedFormat =
      candidate.kind === "blueprint"
        ? "simulacrum-blueprint"
        : SUBASSEMBLY_FORMAT;
    if (candidate.asset.format !== expectedFormat)
      throw new DomainValidationError(
        "ASSET_KIND_MISMATCH",
        "Shared asset format does not match package kind",
        { path: ["asset", "format"] },
      );
    const asset = normalizePortableAsset(candidate.kind, candidate.asset);
    const fingerprint = await fingerprintAsset(candidate.kind, asset);
    assertPackageSemantics(candidate, asset, fingerprint);
    const warnings = [];
    const verification = [];
    for (const [index, proof] of candidate.verification.entries()) {
      try {
        verification.push(decodeProof(proof, asset, fingerprint));
      } catch (error) {
        const unsupported =
          error instanceof DomainValidationError &&
          error.code === "UNSUPPORTED_PROOF_VERSION";
        const warning = issueFromError(
          error,
          unsupported ? "UNSUPPORTED_PROOF_VERSION" : "INVALID_PROOF",
          index,
        );
        warnings.push(
          unsupported
            ? warning
            : issue("INVALID_PROOF", warning.message, warning.path, index),
        );
      }
    }
    return Object.freeze({
      ok: true,
      item: Object.freeze({
        ...structuredClone(candidate),
        asset,
        verification,
      }),
      warnings: Object.freeze(warnings),
      errors: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      item: null,
      warnings: Object.freeze([]),
      errors: Object.freeze([packageIssueFromError(error)]),
    });
  }
}

export async function decodeSharePackageOrThrow(input) {
  const result = await decodeSharePackage(input);
  if (result.ok) return result;
  const first = result.errors[0];
  throw new DomainValidationError(first.code, first.message, {
    path: first.path,
  });
}

function normalizeMetadata(metadata, asset) {
  const now = new Date().toISOString();
  const createdAt = canonicalTimestamp(metadata.createdAt, now);
  const updatedAt = canonicalTimestamp(metadata.updatedAt, createdAt);
  return {
    title: text(metadata.title || asset.name, 64) || "Untitled",
    description: text(metadata.description, 500),
    tags: normalizeTags(metadata.tags),
    creator: text(metadata.creator, 48),
    thumbnail: normalizeThumbnail(metadata.thumbnail),
    createdAt,
    updatedAt,
    ...(metadata.extensions
      ? { extensions: structuredClone(metadata.extensions) }
      : {}),
  };
}

function normalizeProvenance(provenance, fingerprint, creator) {
  const requestedParent = ASSET_FINGERPRINT_PATTERN.test(
    provenance.parentFingerprint || "",
  )
    ? provenance.parentFingerprint
    : null;
  const parentFingerprint =
    requestedParent === fingerprint ? null : requestedParent;
  const rootFingerprint = parentFingerprint
    ? ASSET_FINGERPRINT_PATTERN.test(provenance.rootFingerprint || "")
      ? provenance.rootFingerprint
      : parentFingerprint
    : fingerprint;
  return {
    parentFingerprint,
    rootFingerprint,
    remixDepth: parentFingerprint
      ? Math.max(
          1,
          Math.min(99, Math.round(Number(provenance.remixDepth) || 1)),
        )
      : 0,
    originalCreator: text(provenance.originalCreator || creator, 48),
    ...(provenance.extensions
      ? { extensions: structuredClone(provenance.extensions) }
      : {}),
  };
}

/** Strict producer; creation and import are intentionally separate APIs. */
/** @param {any} [options] */
export async function createSharePackage({
  kind,
  asset,
  metadata = {},
  provenance = {},
  verification = [],
  extensions = undefined,
  dependencyExtensions = undefined,
} = {}) {
  const normalizedAsset = normalizePortableAsset(kind, asset);
  const fingerprint = await fingerprintAsset(kind, normalizedAsset);
  const normalizedMetadata = normalizeMetadata(metadata, normalizedAsset);
  const candidate = {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    kind,
    fingerprint,
    metadata: normalizedMetadata,
    provenance: normalizeProvenance(
      provenance,
      fingerprint,
      normalizedMetadata.creator,
    ),
    dependencies: dependenciesFor(normalizedAsset, dependencyExtensions),
    verification: structuredClone(verification),
    asset: normalizedAsset,
    ...(extensions ? { extensions: structuredClone(extensions) } : {}),
  };
  const decoded = await decodeSharePackage(candidate);
  if (!decoded.ok) {
    const first = decoded.errors[0];
    throw new DomainValidationError(first.code, first.message, {
      path: first.path,
    });
  }
  return structuredClone(decoded.item);
}

function proofFromRecord(record, fingerprint) {
  return {
    proofVersion: 1,
    challengeVersion: record.challengeVersion,
    challengeId: record.id,
    assetFingerprint: fingerprint,
    score: record.score,
    solution: record.solution,
    recordedAt: record.recordedAt,
    binding: structuredClone(record.binding),
    terminal: structuredClone(record.terminal),
    environment: structuredClone(record.environment),
    controllerPrograms: structuredClone(record.controllerPrograms),
    ...(record.extensions
      ? { extensions: structuredClone(record.extensions) }
      : {}),
  };
}

export function verificationForAsset(records, fingerprint, asset) {
  const strongest = new Map();
  for (const record of records || []) {
    if (
      !record.success ||
      record.verificationEligible !== true ||
      record.proofVersion !== 1 ||
      record.assetFingerprint !== fingerprint
    )
      continue;
    const proof = proofFromRecord(record, fingerprint);
    try {
      const decoded = decodeProof(proof, asset, fingerprint);
      const prior = strongest.get(decoded.challengeId);
      if (!prior || decoded.score > prior.score)
        strongest.set(decoded.challengeId, decoded);
    } catch {
      // Invalid local evidence is ineligible for a portable proof attachment.
    }
  }
  return [...strongest.values()].slice(0, 20);
}

export async function decodeShareLibrary(items = []) {
  const packages = [];
  const diagnostics = [];
  const unique = new Map();
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const decoded = await decodeSharePackage(item);
    if (!decoded.ok) {
      diagnostics.push(
        Object.freeze({
          index,
          errors: decoded.errors,
          warnings: decoded.warnings,
        }),
      );
      continue;
    }
    unique.set(decoded.item.fingerprint, decoded.item);
    if (decoded.warnings.length)
      diagnostics.push(
        Object.freeze({
          index,
          errors: Object.freeze([]),
          warnings: decoded.warnings,
        }),
      );
  }
  packages.push(...unique.values());
  return Object.freeze({
    packages: Object.freeze(packages),
    diagnostics: Object.freeze(diagnostics),
  });
}
