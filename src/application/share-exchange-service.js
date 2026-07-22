import { ShareLibrary } from "../model/share-library.js";
import {
  createSharePackage,
  decodeShareLibrary,
  decodeSharePackage,
  verificationForAsset,
} from "../model/share-packages.js";

/** @param {readonly any[]} errors @param {readonly any[]} warnings */
function rejected(errors, warnings = []) {
  const first = errors[0];
  return {
    ok: false,
    status: "rejected",
    item: null,
    warnings: structuredClone(warnings),
    errors: structuredClone(errors),
    error: new Error(first?.message || "Share package rejected"),
  };
}

function operationalError(error) {
  return rejected([
    {
      code: "SHARE_OPERATION_FAILED",
      path: [],
      message: error instanceof Error ? error.message : String(error),
    },
  ]);
}

function proofTrust(item, localChallengeRecords) {
  if (!item.verification.length) return "none";
  const proofKey = (proof) =>
    JSON.stringify([
      proof.challengeId,
      proof.score,
      proof.solution,
      proof.recordedAt,
      proof.assetFingerprint,
      proof.proofVersion,
      proof.challengeVersion,
      proof.binding,
      proof.terminal,
      proof.environment,
      proof.controllerPrograms,
    ]);
  const local = new Set(
    verificationForAsset(
      localChallengeRecords,
      item.fingerprint,
      item.asset,
    ).map(proofKey),
  );
  const localCount = item.verification.filter((proof) =>
    local.has(proofKey(proof)),
  ).length;
  if (!localCount) return "attached";
  return localCount === item.verification.length ? "local" : "mixed";
}

/** DOM-free asynchronous use cases and policy for the local Blueprint Exchange. */
export class ShareExchangeService {
  constructor({ repository }) {
    this.repository = repository;
    this.remixDraft = null;
    this.library = new ShareLibrary();
    this.recoveryDiagnostics = [];
    this.ready = this.#initialize(repository.load().catalog);
  }

  async #initialize(catalog) {
    const decoded = await decodeShareLibrary(catalog.packages);
    this.recoveryDiagnostics = [...decoded.diagnostics].map((value) =>
      structuredClone(value),
    );
    this.library = new ShareLibrary({
      packages: [...decoded.packages].map((value) => structuredClone(value)),
      social: catalog.social,
      origins: catalog.origins,
    });
    return this.snapshot();
  }

  #candidate() {
    return new ShareLibrary(this.library.persistence());
  }

  #commit(library) {
    const committed = this.repository.commit({
      catalog: library.persistence(),
    });
    if (!committed.ok) return committed;
    this.library = library;
    return committed;
  }

  async #mutate(operation) {
    await this.ready;
    const candidate = this.#candidate();
    try {
      const value = await operation(candidate);
      const committed = this.#commit(candidate);
      return committed.ok
        ? { ok: true, ...value }
        : operationalError(committed.error);
    } catch (error) {
      return operationalError(error);
    }
  }

  list(options = {}, localChallengeRecords = []) {
    return this.library.entries(options).map((entry) => ({
      ...entry,
      proofTrust: proofTrust(entry.package, localChallengeRecords),
    }));
  }

  async get(fingerprint, localChallengeRecords = []) {
    await this.ready;
    return (
      this.list({}, localChallengeRecords).find(
        (entry) => entry.package.fingerprint === fingerprint,
      ) || null
    );
  }

  async createPackage({
    kind,
    asset,
    metadata,
    localChallengeRecords = [],
    provenance = this.remixDraft || {},
  }) {
    const initial = await createSharePackage({
      kind,
      asset,
      metadata,
      provenance: kind === "blueprint" ? provenance : {},
    });
    return createSharePackage({
      kind,
      asset: initial.asset,
      metadata: initial.metadata,
      provenance: initial.provenance,
      verification: verificationForAsset(
        localChallengeRecords,
        initial.fingerprint,
        initial.asset,
      ),
    });
  }

  async importPackage(input, { origin = "file", requiredKind = null } = {}) {
    await this.ready;
    const decoded = await decodeSharePackage(input);
    if (!decoded.ok) return rejected(decoded.errors, decoded.warnings);
    if (requiredKind && decoded.item.kind !== requiredKind)
      return rejected(
        [
          {
            code: "ASSET_KIND_MISMATCH",
            path: ["kind"],
            message: `Import requires a ${requiredKind}`,
          },
        ],
        decoded.warnings,
      );
    return this.#mutate((candidate) => {
      const existed = candidate.get(decoded.item.fingerprint);
      candidate.upsert(decoded.item, origin);
      return {
        status: existed ? "duplicate" : "imported",
        item: candidate.get(decoded.item.fingerprint),
        warnings: structuredClone(decoded.warnings),
        errors: [],
      };
    });
  }

  async savePackage(input) {
    await this.ready;
    const decoded = await decodeSharePackage(input);
    if (!decoded.ok) return rejected(decoded.errors, decoded.warnings);
    const saved = await this.#mutate((candidate) => {
      const existed = candidate.get(decoded.item.fingerprint);
      candidate.upsert(decoded.item, "local");
      return {
        status: existed ? "duplicate" : "imported",
        item: candidate.get(decoded.item.fingerprint),
        warnings: structuredClone(decoded.warnings),
        errors: [],
      };
    });
    if (saved.ok) this.clearRemix();
    return saved;
  }

  remove(fingerprint) {
    return this.#mutate((candidate) => {
      const existed = Boolean(candidate.get(fingerprint));
      candidate.remove(fingerprint);
      return { status: existed ? "removed" : "unchanged" };
    });
  }

  favorite(fingerprint, value = null) {
    return this.#mutate((candidate) => ({
      status: "updated",
      value: candidate.favorite(fingerprint, value),
    }));
  }

  rate(fingerprint, rating) {
    return this.#mutate((candidate) => ({
      status: "updated",
      value: candidate.rate(fingerprint, rating),
    }));
  }

  publishReusable(assets, { creator = "" } = {}) {
    return this.#mutate(async (candidate) => {
      const items = [];
      for (const asset of assets || []) {
        const item = await createSharePackage({
          kind: "subassembly",
          asset,
          metadata: {
            title: asset.name,
            description: `${asset.parts.length}-part reusable workshop ${
              asset.parts.length === 1 ? "component" : "subassembly"
            }`,
            creator,
            tags: [
              asset.parts.length === 1 ? "component" : "subassembly",
              "reusable",
            ],
          },
        });
        candidate.upsert(item, "local");
        items.push(candidate.get(item.fingerprint));
      }
      return {
        status: items.length ? "updated" : "unchanged",
        items,
        warnings: [],
        errors: [],
      };
    });
  }

  async prepareRemix(fingerprint) {
    await this.ready;
    const item = this.library.get(fingerprint);
    if (!item || item.kind !== "blueprint")
      return operationalError(
        new Error("Only complete machines can be remixed"),
      );
    return {
      ok: true,
      status: "ready",
      asset: item.asset,
      title: `${item.metadata.title} Remix`.slice(0, 64),
      provenance: {
        parentFingerprint: item.fingerprint,
        rootFingerprint: item.provenance.rootFingerprint,
        remixDepth: item.provenance.remixDepth + 1,
        originalCreator:
          item.provenance.originalCreator || item.metadata.creator,
      },
    };
  }

  beginRemix(provenance) {
    this.remixDraft = structuredClone(provenance);
  }

  clearRemix() {
    this.remixDraft = null;
  }

  remix() {
    return structuredClone(this.remixDraft);
  }

  snapshot(localChallengeRecords = []) {
    return {
      entries: this.list({}, localChallengeRecords),
      remix: this.remix(),
      persistence: this.library.persistence(),
      recoveryDiagnostics: structuredClone(this.recoveryDiagnostics),
    };
  }
}
