import {
  DomainValidationError,
  immutableClone,
  stableStringify,
} from "../model/primitives.js";
import {
  ROUTE_EVIDENCE_LIMITS,
  routeEvidenceByteLength,
  routeWitnessFromIndex,
  validateRouteEvidenceQuery,
} from "./route-evidence-index.js";

let nextGeneration = 1n;

const SLOT_NAMES = Object.freeze([
    "power",
    "signal",
    "resourceReachability",
    "resourceAllocation",
  ]),
  slotForQuery = (query) =>
    query.kind === "resource-reachability"
      ? "resourceReachability"
      : query.kind === "resource-allocation"
        ? "resourceAllocation"
        : query.kind,
  mediumForQuery = (query) =>
    query.kind.startsWith("resource") ? "resource" : query.kind;

function unavailableResponse(query, status, identity = null, token = null) {
  return immutableClone({
    version: 1,
    medium: mediumForQuery(query),
    identity,
    evidenceToken: token,
    status,
    source: query.source || null,
    target: query.target || null,
    resourceKey: query.resourceKey || null,
    allocation: null,
    controllerPortSelection: null,
    hops: [],
    alternativeWitnessCount: 0,
    cycleConnectionIds: [],
    blockingConnectionIds: [],
    blockerEvidence: "unknown",
    totalHopCount: null,
    truncated: {
      hops: false,
      alternatives: false,
      cycles: false,
      blockers: false,
    },
  });
}

function validateIdentity(identity) {
  if (
    !identity ||
    identity.phase !== "live" ||
    typeof identity.runConfigurationFingerprint !== "string" ||
    typeof identity.networkResultDigest !== "string" ||
    !Number.isSafeInteger(identity.telemetryTick) ||
    identity.telemetryTick < 0
  )
    throw new DomainValidationError(
      "INVALID_ROUTE_EVIDENCE_IDENTITY",
      "Live route evidence requires a complete expected identity",
    );
  return immutableClone(identity);
}

function payloadKey(index) {
  return `${index.medium}\0${index.runtimeTopologyFingerprint}\0${index.networkResultDigest}`;
}

function parseBase36(value) {
  let result = 0n;
  for (const character of value)
    result = result * 36n + BigInt(parseInt(character, 36));
  return result;
}

/** Session-owned, bounded, opaque-token route evidence retention. */
export class RouteEvidenceArchive {
  #generation = nextGeneration++;
  #epoch = 1n;
  #nextSlot = 1n;
  #records = new Map();
  #payloads = new Map();
  #currentSlot = null;
  #closed = false;

  #token(slot) {
    return `route-evidence-v1:${this.#generation.toString(36)}:${this.#epoch.toString(36)}:${slot.toString(36)}`;
  }

  #parseToken(token) {
    const match =
      /^route-evidence-v1:([0-9a-z]+):([0-9a-z]+):([0-9a-z]+)$/.exec(
        String(token || ""),
      );
    if (!match) return null;
    return {
      generation: parseBase36(match[1]),
      epoch: parseBase36(match[2]),
      slot: parseBase36(match[3]),
    };
  }

  #descriptor(token, slots) {
    return immutableClone({ version: 1, token, slots });
  }

  /** @param {{telemetryTick?:number,slots?:Record<string,any>}} [input] */
  commit({ telemetryTick, slots } = {}) {
    if (this.#closed)
      return this.#descriptor(null, this.#unsupportedSlots(slots));
    if (!Number.isSafeInteger(telemetryTick) || telemetryTick < 0)
      throw new DomainValidationError(
        "INVALID_ROUTE_EVIDENCE_COMMIT",
        "Route evidence commit requires a non-negative safe telemetry tick",
      );
    const descriptorSlots = {},
      references = [];
    for (const name of SLOT_NAMES) {
      const candidate = slots?.[name] || { status: "unsupported" },
        reportedStatus = [
          "available",
          "unsupported",
          "over-limit",
          "superseded-in-frame",
        ].includes(candidate.status)
          ? candidate.status
          : "unsupported",
        status =
          reportedStatus === "available" && !candidate.index
            ? "unsupported"
            : reportedStatus;
      descriptorSlots[name] = {
        status,
        ...(candidate.identity ? { identity: candidate.identity } : {}),
        ...(candidate.index?.indexDigest
          ? { indexDigest: candidate.index.indexDigest }
          : {}),
      };
      if (status === "available" && candidate.index) {
        const key = payloadKey(candidate.index);
        references.push({ name, key, index: candidate.index });
      }
    }
    if (!references.length) return this.#descriptor(null, descriptorSlots);
    const slot = this.#nextSlot++,
      token = this.#token(slot),
      record = {
        slot,
        telemetryTick,
        token,
        slots: descriptorSlots,
        references: Object.fromEntries(
          references.map(({ name, key }) => [name, key]),
        ),
      },
      recordBytes = routeEvidenceByteLength({
        ...record,
        slot: slot.toString(36),
      });
    this.#records.set(slot, { ...record, chargedBytes: recordBytes });
    for (const { key, index } of references) {
      const stored = this.#payloads.get(key);
      if (stored) stored.references++;
      else
        this.#payloads.set(key, {
          index: Object.isFrozen(index) ? index : immutableClone(index),
          references: 1,
          chargedBytes: routeEvidenceByteLength(index),
        });
    }
    const previousCurrent = this.#currentSlot;
    this.#currentSlot = slot;
    this.#evictHistorical(new Set([previousCurrent]));
    if (this.chargedBytes() > ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes) {
      const previousFreedBytes = this.#recordFreedBytes(previousCurrent);
      if (
        previousCurrent !== null &&
        this.chargedBytes() - previousFreedBytes <=
          ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes
      )
        this.#removeRecord(previousCurrent);
      else {
        this.#removeRecord(slot);
        this.#currentSlot = previousCurrent;
        this.#nextSlot--;
        for (const name of SLOT_NAMES)
          if (descriptorSlots[name].status === "available")
            descriptorSlots[name] = {
              status: "over-limit",
              ...(descriptorSlots[name].identity
                ? { identity: descriptorSlots[name].identity }
                : {}),
            };
        return this.#descriptor(null, descriptorSlots);
      }
    }
    return this.#descriptor(token, descriptorSlots);
  }

  #unsupportedSlots(slots = {}) {
    return Object.fromEntries(
      SLOT_NAMES.map((name) => [
        name,
        {
          status: "unsupported",
          ...(slots?.[name]?.identity
            ? { identity: slots[name].identity }
            : {}),
        },
      ]),
    );
  }

  #removeRecord(slot) {
    const record = this.#records.get(slot);
    if (!record) return;
    this.#records.delete(slot);
    for (const key of Object.values(record.references)) {
      const payload = this.#payloads.get(key);
      if (!payload) continue;
      payload.references--;
      if (payload.references === 0) this.#payloads.delete(key);
    }
  }

  #recordFreedBytes(slot) {
    const record = this.#records.get(slot);
    if (!record) return 0;
    let freed = record.chargedBytes;
    for (const key of new Set(Object.values(record.references))) {
      const payload = this.#payloads.get(key);
      if (payload?.references === 1) freed += payload.chargedBytes;
    }
    return freed;
  }

  #evictHistorical(excluded = new Set()) {
    const candidates = [...this.#records.values()]
      .filter(
        (record) =>
          record.slot !== this.#currentSlot && !excluded.has(record.slot),
      )
      .sort(
        (left, right) =>
          left.telemetryTick - right.telemetryTick ||
          (left.slot < right.slot ? -1 : left.slot > right.slot ? 1 : 0),
      );
    while (
      this.chargedBytes() > ROUTE_EVIDENCE_LIMITS.maximumArchiveBytes &&
      candidates.length
    )
      this.#removeRecord(candidates.shift().slot);
  }

  routeEvidence(token, input, expectedIdentity) {
    const parsed = this.#parseToken(token);
    if (
      this.#closed ||
      !parsed ||
      parsed.generation !== this.#generation ||
      parsed.epoch !== this.#epoch ||
      !this.#records.has(parsed.slot)
    ) {
      const query = (() => {
        try {
          return validateRouteEvidenceQuery(input);
        } catch {
          return { kind: "power", source: null, target: null };
        }
      })();
      return unavailableResponse(query, "unsupported");
    }
    const query = validateRouteEvidenceQuery(input),
      identity = validateIdentity(expectedIdentity),
      record = this.#records.get(parsed.slot),
      name = slotForQuery(query),
      descriptor = record.slots[name];
    if (descriptor?.status !== "available")
      return unavailableResponse(
        query,
        descriptor?.status === "over-limit" ? "over-limit" : "unsupported",
        descriptor?.identity || null,
        token,
      );
    if (stableStringify(descriptor.identity) !== stableStringify(identity))
      return unavailableResponse(query, "stale", descriptor.identity, token);
    const payload = this.#payloads.get(record.references[name]);
    if (!payload) return unavailableResponse(query, "unsupported");
    const witness = routeWitnessFromIndex(
        payload.index,
        query,
        identity.networkResultDigest,
      ),
      { kind: _ownerKind, ...publicWitness } = witness;
    return immutableClone({
      ...publicWitness,
      identity,
      evidenceToken: token,
    });
  }

  invalidateForCheckpointImport() {
    if (this.#closed) return;
    this.#records.clear();
    this.#payloads.clear();
    this.#currentSlot = null;
    this.#epoch++;
    this.#nextSlot = 1n;
  }

  chargedBytes() {
    return (
      [...this.#records.values()].reduce(
        (sum, record) => sum + record.chargedBytes,
        0,
      ) +
      [...this.#payloads.values()].reduce(
        (sum, payload) => sum + payload.chargedBytes,
        0,
      )
    );
  }

  dispose() {
    this.#closed = true;
    this.#records.clear();
    this.#payloads.clear();
    this.#currentSlot = null;
  }
}
