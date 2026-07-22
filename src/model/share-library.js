const ORIGINS = new Set(["local", "file", "link"]);

function normalizeSocial(value = {}) {
  return {
    favorite: Boolean(value.favorite),
    rating: Math.max(0, Math.min(5, Math.round(Number(value.rating) || 0))),
  };
}

/**
 * @param {string | { primary?: string, history?: string[] } | null | undefined} value
 * @returns {{ primary: string, history: string[] }}
 */
function normalizeOriginRecord(value = "file") {
  const requested = typeof value === "string" ? [value] : value?.history,
    history = [
      ...new Set((requested || []).filter((item) => ORIGINS.has(item))),
    ];
  if (!history.length) history.push("file");
  const primary = typeof value === "object" && value ? value.primary : null,
    preferred = primary && ORIGINS.has(primary) ? primary : history[0];
  return {
    primary: history.includes("local") ? "local" : preferred,
    history,
  };
}

function mergePackage(existing, incoming, keepExisting) {
  const base = keepExisting ? existing : incoming;
  const strongest = new Map();
  for (const proof of [...existing.verification, ...incoming.verification]) {
    const prior = strongest.get(proof.challengeId);
    if (!prior || proof.score > prior.score)
      strongest.set(proof.challengeId, structuredClone(proof));
  }
  return {
    ...structuredClone(base),
    verification: [...strongest.values()].slice(0, 20),
  };
}

/** Local-first package catalog; social state stays outside immutable files. */
export class ShareLibrary {
  constructor({ packages = [], social = {}, origins = {} } = {}) {
    this.packages = new Map(
      packages.map((item) => [item.fingerprint, structuredClone(item)]),
    );
    this.social = new Map(
      Object.entries(social).map(([key, value]) => [
        key,
        normalizeSocial(value),
      ]),
    );
    this.origins = new Map(
      Object.entries(origins).map(([key, value]) => [
        key,
        normalizeOriginRecord(value),
      ]),
    );
  }

  upsert(input, origin = "file") {
    if (!ORIGINS.has(origin)) throw new Error("Unknown share origin");
    const incoming = structuredClone(input),
      existing = this.packages.get(incoming.fingerprint),
      priorOrigin = existing
        ? normalizeOriginRecord(this.origins.get(incoming.fingerprint))
        : { primary: origin, history: [] },
      item = existing
        ? mergePackage(
            existing,
            incoming,
            priorOrigin.history.includes("local") && origin !== "local",
          )
        : incoming,
      nextOrigin = normalizeOriginRecord({
        primary: origin,
        history: [...priorOrigin.history, origin].filter((entry) =>
          ORIGINS.has(entry),
        ),
      });
    this.packages.set(item.fingerprint, item);
    this.origins.set(item.fingerprint, nextOrigin);
    while (this.packages.size > 32) {
      const removable = [...this.packages.keys()].find(
        (key) => !this.social.get(key)?.favorite,
      );
      if (!removable) break;
      this.remove(removable);
    }
    return structuredClone(item);
  }

  remove(fingerprint) {
    this.packages.delete(fingerprint);
    this.social.delete(fingerprint);
    this.origins.delete(fingerprint);
  }

  favorite(fingerprint, value = null) {
    if (!this.packages.has(fingerprint)) return null;
    const social = normalizeSocial(this.social.get(fingerprint));
    social.favorite = value == null ? !social.favorite : Boolean(value);
    this.social.set(fingerprint, social);
    return social.favorite;
  }

  rate(fingerprint, rating) {
    if (!this.packages.has(fingerprint)) return 0;
    const social = normalizeSocial(this.social.get(fingerprint));
    social.rating = normalizeSocial({ rating }).rating;
    this.social.set(fingerprint, social);
    return social.rating;
  }

  get(fingerprint) {
    const item = this.packages.get(fingerprint);
    return item ? structuredClone(item) : null;
  }

  entries({ query = "", filter = "all" } = {}) {
    const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
    return [...this.packages.values()]
      .map((item) => ({
        package: structuredClone(item),
        social: normalizeSocial(this.social.get(item.fingerprint)),
        origin: normalizeOriginRecord(this.origins.get(item.fingerprint))
          .primary,
        origins: normalizeOriginRecord(this.origins.get(item.fingerprint))
          .history,
      }))
      .filter((entry) => {
        if (filter === "favorites" && !entry.social.favorite) return false;
        if (filter === "verified" && !entry.package.verification.length)
          return false;
        if (filter === "component") {
          if (
            entry.package.kind !== "subassembly" ||
            entry.package.dependencies.partCount !== 1
          )
            return false;
        } else if (filter === "subassembly") {
          if (
            entry.package.kind !== "subassembly" ||
            entry.package.dependencies.partCount === 1
          )
            return false;
        } else if (
          filter !== "all" &&
          !["favorites", "verified"].includes(filter) &&
          entry.package.kind !== filter
        )
          return false;
        const searchable = [
          entry.package.metadata.title,
          entry.package.metadata.description,
          entry.package.metadata.creator,
          ...entry.package.metadata.tags,
        ]
          .join(" ")
          .toLowerCase();
        return terms.every((term) => searchable.includes(term));
      })
      .sort(
        (left, right) =>
          Number(right.social.favorite) - Number(left.social.favorite) ||
          right.package.metadata.updatedAt.localeCompare(
            left.package.metadata.updatedAt,
          ),
      );
  }

  persistence() {
    return {
      packages: [...this.packages.values()].map((value) =>
        structuredClone(value),
      ),
      social: Object.fromEntries(this.social),
      origins: Object.fromEntries(
        [...this.origins].map(([key, value]) => [
          key,
          /** @type {any} Public Core persistence wire remains open. */ (
            structuredClone(value)
          ),
        ]),
      ),
    };
  }
}
