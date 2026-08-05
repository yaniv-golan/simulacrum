import { AssemblyModel } from "../model/assembly-model.js";
import {
  canonicalId,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  immutableClone,
} from "../model/primitives.js";
import {
  batteryEnergyReadModel,
  runtimeBatteryEnergy,
} from "./energy-ledger.js";
import { componentElectricalSource } from "../model/component-contracts.js";

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const loadTransactions = new WeakMap();
const CONNECTION_CHECKPOINT_FIELDS = Object.freeze([
  "id",
  "stress",
  "fatigue",
  "failed",
  "peakLoadN",
  "peakTorqueNm",
  "lastLoadN",
  "lastTorqueNm",
  "forceUtilization",
  "torqueUtilization",
  "failureReason",
  "failureMode",
  "failedAtS",
]);
const STRUCTURAL_EVENT_FIELDS = Object.freeze([
  "type",
  "graphRevision",
  "failedConnectionIds",
  "failedInternalEdgeIds",
  "detachedPartIds",
  "reason",
  "mode",
  "time",
]);

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function checkpointTreeIsFinite(value) {
  if (value == null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(checkpointTreeIsFinite);
  if (typeof value !== "object") return false;
  return Object.values(value).every(checkpointTreeIsFinite);
}

function uniqueKnownIds(values, knownIds) {
  if (!Array.isArray(values)) return false;
  const ids = new Set(values);
  return ids.size === values.length && values.every((id) => knownIds.has(id));
}

/** Internal fixed-step batch boundary; intentionally absent from Core. */
export function applyRunGraphLoads(runGraph, records = []) {
  const apply = loadTransactions.get(runGraph);
  if (!apply)
    throw new TypeError("RunAssemblyGraph load transaction is unavailable");
  return apply(records);
}

function runtimePart(part) {
  const runtime = {
    ...structuredClone(part),
    detached: false,
    thermal: structuredClone(part.thermal || null),
  };
  if (componentElectricalSource(part)) {
    delete runtime.storedEnergyWh;
    Object.assign(runtime, runtimeBatteryEnergy(part));
  }
  return deepFreeze(runtime);
}

function runtimeConnection(connection) {
  return deepFreeze({
    ...structuredClone(connection),
    stress: 0,
    fatigue: 0,
    failed: false,
    peakLoadN: 0,
    peakTorqueNm: 0,
  });
}

/**
 * Transient, authoritative state for one simulation run. It is constructed
 * from an immutable editor snapshot and is discarded on stop/reset; no action
 * mutates the persistent AssemblyModel or the caller's snapshot.
 */
export class RunAssemblyGraph {
  #startSnapshot;
  #parts = new Map();
  #connections = new Map();
  #controllers = new Map();
  #events = [];
  #checkpointInternalEdgeIds = new Set();
  #revision = 0;
  #graphRevision = 0;
  #indexRevision = -1;
  #adjacency = new Map();
  #snapshotRevision = -1;
  #snapshot = null;

  constructor(snapshot = {}) {
    const canonical = new AssemblyModel(snapshot).snapshot();
    this.#startSnapshot = canonical;
    this.#parts = new Map(
      canonical.parts.map((part) => [part.id, runtimePart(part)]),
    );
    this.#connections = new Map(
      canonical.connections.map((connection) => [
        connection.id,
        runtimeConnection(connection),
      ]),
    );
    loadTransactions.set(this, (records) => this.#applyLoads(records));
  }

  get revision() {
    return this.#revision;
  }

  get graphRevision() {
    return this.#graphRevision;
  }

  startSnapshot() {
    return this.#startSnapshot;
  }

  parts() {
    return Object.freeze([...this.#parts.values()]);
  }

  connections() {
    return Object.freeze([...this.#connections.values()]);
  }

  part(id) {
    return this.#parts.get(id) || null;
  }

  connection(id) {
    return this.#connections.get(id) || null;
  }

  controllerState(id) {
    return this.#controllers.get(id) || null;
  }

  events() {
    return Object.freeze([...this.#events]);
  }

  /** Registers compiled flexible-edge identities for checkpoint validation. */
  setCheckpointInternalEdgeIds(ids = []) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length)
      throw new DomainValidationError(
        "INVALID_RUN_GRAPH_INTERNAL_EDGE_IDS",
        "Checkpoint internal-edge identities must be a unique array",
      );
    const validated = new Set();
    for (const id of ids) validated.add(canonicalId(id));
    this.#checkpointInternalEdgeIds = validated;
  }

  setPartState(id, patch) {
    const current = this.#requirePart(id);
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new DomainValidationError(
        "INVALID_RUNTIME_PART_PATCH",
        "Runtime part state must be an object patch",
        { details: { id } },
      );
    const safePatch = structuredClone(patch);
    delete safePatch.id;
    delete safePatch.type;
    this.#parts.set(id, deepFreeze({ ...current, ...safePatch }));
    this.#revision++;
    return this.part(id);
  }

  consumeEnergy(id, amount) {
    const current = this.#requirePart(id),
      consumed = finiteNumber(amount, {
        min: 0,
        path: ["energyJ", id],
      }),
      before = Math.max(0, Number(current.energyJ || 0)),
      after = Math.max(0, before - consumed);
    if (after !== before) {
      this.#parts.set(
        id,
        Object.freeze({
          ...current,
          ...batteryEnergyReadModel({
            capacityJ: current.capacityJ || 0,
            energyJ: after,
          }),
        }),
      );
      this.#revision++;
    }
    return before - after;
  }

  setControllerState(id, state) {
    this.#requirePart(id);
    if (!state || typeof state !== "object" || Array.isArray(state))
      throw new DomainValidationError(
        "INVALID_CONTROLLER_STATE",
        "Controller runtime state must be an object",
        { details: { id } },
      );
    this.#controllers.set(id, immutableClone(state));
    this.#revision++;
    return this.controllerState(id);
  }

  applyLoad(connectionId, options = {}) {
    return this.#applyLoads([{ connectionId, ...options }])[0];
  }

  #applyLoads(records = []) {
    if (!Array.isArray(records))
      throw new DomainValidationError(
        "INVALID_RUNTIME_LOAD_TRANSACTION",
        "Runtime load transaction must be an array",
      );
    const seen = new Set(),
      updates = records.map((record, index) => {
        const connectionId = record?.connectionId;
        if (seen.has(connectionId))
          throw new DomainValidationError(
            "DUPLICATE_RUNTIME_LOAD",
            `Connection ${String(connectionId)} appears twice in one load transaction`,
            { path: ["records", index, "connectionId"] },
          );
        seen.add(connectionId);
        const current = this.#requireConnection(connectionId),
          nextLoad = finiteNumber(record?.loadN ?? 0, {
            min: 0,
            path: ["connections", connectionId, "loadN"],
          }),
          nextStress = finiteNumber(record?.stress ?? current.stress ?? 0, {
            min: 0,
            path: ["connections", connectionId, "stress"],
          }),
          nextFatigue = clamp01(
            Number(current.fatigue || 0) +
              finiteNumber(record?.fatigueDelta ?? 0, {
                path: ["connections", connectionId, "fatigueDelta"],
              }),
          ),
          nextTorque = finiteNumber(record?.torqueNm ?? 0, {
            min: 0,
            path: ["connections", connectionId, "torqueNm"],
          }),
          next = deepFreeze({
            ...current,
            stress: nextStress,
            fatigue: nextFatigue,
            peakLoadN: Math.max(current.peakLoadN || 0, nextLoad),
            lastLoadN: nextLoad,
            peakTorqueNm: Math.max(current.peakTorqueNm || 0, nextTorque),
            lastTorqueNm: nextTorque,
            forceUtilization: finiteNumber(record?.forceUtilization ?? 0, {
              min: 0,
            }),
            torqueUtilization: finiteNumber(record?.torqueUtilization ?? 0, {
              min: 0,
            }),
          });
        // Loads are sampled in connection state. Only discrete failures enter
        // the durable event timeline.
        finiteNumber(record?.time ?? 0, { min: 0 });
        return { connectionId, next };
      });
    for (const { connectionId, next } of updates)
      this.#connections.set(connectionId, next);
    if (updates.length) this.#revision++;
    return Object.freeze(updates.map(({ next }) => next));
  }

  failConnection(id, details = {}) {
    return this.applyStructuralEvent({
      failedConnectionIds: [id],
      reason: details.reason || "connection failed",
      mode: details.mode || "structural",
      time: details.time || 0,
    });
  }

  detachComponent(ids, details = {}) {
    return this.applyStructuralEvent({
      detachedPartIds: Array.isArray(ids) ? ids : [ids],
      reason: details.reason || "component detached",
      mode: details.mode || "detachment",
      time: details.time || 0,
    });
  }

  /** Applies one atomic graph mutation and advances graphRevision once. */
  applyStructuralEvent({
    failedConnectionIds = [],
    failedInternalEdgeIds = [],
    detachedPartIds = [],
    reason = "structural event",
    mode = "structural",
    time = 0,
  } = {}) {
    const failures = [...new Set(failedConnectionIds)],
      internalFailures = [...new Set(failedInternalEdgeIds)].map((id) =>
        canonicalId(id),
      ),
      detachments = [...new Set(detachedPartIds)];
    for (const id of failures) this.#requireConnection(id);
    for (const id of detachments) this.#requirePart(id);
    const allFailures = new Set(failures);
    for (const partId of detachments)
      for (const connection of this.#connections.values())
        if (connection.a === partId || connection.b === partId)
          allFailures.add(connection.id);
    let changed = internalFailures.length > 0;
    for (const id of allFailures) {
      const current = this.#connections.get(id);
      if (current.failed) continue;
      this.#connections.set(
        id,
        deepFreeze({
          ...current,
          failed: true,
          failureReason: reason,
          failureMode: mode,
          failedAtS: finiteNumber(time, { min: 0 }),
        }),
      );
      changed = true;
    }
    for (const id of detachments) {
      const current = this.#parts.get(id);
      if (current.detached) continue;
      this.#parts.set(id, deepFreeze({ ...current, detached: true }));
      changed = true;
    }
    if (!changed)
      return immutableClone({
        changed: false,
        graphRevision: this.#graphRevision,
        failedConnectionIds: [],
        failedInternalEdgeIds: [],
        detachedPartIds: [],
      });
    this.#revision++;
    this.#graphRevision++;
    this.#indexRevision = -1;
    const event = deepFreeze({
      type: "structural",
      graphRevision: this.#graphRevision,
      failedConnectionIds: [...allFailures],
      failedInternalEdgeIds: internalFailures,
      detachedPartIds: detachments,
      reason: String(reason),
      mode: String(mode),
      time: finiteNumber(time, { min: 0 }),
    });
    this.#events.push(event);
    return immutableClone({ changed: true, ...event });
  }

  adjacency(kind = null) {
    this.#refreshIndexes();
    return new Map(
      [...this.#adjacency].map(([id, edges]) => [
        id,
        immutableClone(
          kind ? edges.filter((edge) => edge.connection.kind === kind) : edges,
        ),
      ]),
    );
  }

  connectedPartIds(id, kind = null) {
    this.#requirePart(id);
    return Object.freeze(
      (this.adjacency(kind).get(id) || []).map((edge) => edge.id),
    );
  }

  snapshot() {
    if (this.#snapshotRevision === this.#revision) return this.#snapshot;
    this.#snapshot = Object.freeze({
      schemaVersion: 1,
      revision: this.#revision,
      graphRevision: this.#graphRevision,
      startAssemblyRevision: this.#startSnapshot.revision || 0,
      parts: Object.freeze([...this.#parts.values()]),
      connections: Object.freeze([...this.#connections.values()]),
      controllers: Object.freeze(
        [...this.#controllers].map(([id, state]) =>
          Object.freeze({ id, state }),
        ),
      ),
      events: Object.freeze([...this.#events]),
    });
    this.#snapshotRevision = this.#revision;
    return this.#snapshot;
  }

  exportState() {
    return structuredClone({
      version: 2,
      revision: this.#revision,
      graphRevision: this.#graphRevision,
      parts: [...this.#parts.values()].map((part) => ({
        id: part.id,
        detached: part.detached,
        ...(componentElectricalSource(
          this.#startSnapshot.parts.find(
            (candidate) => candidate.id === part.id,
          ),
        )
          ? { energyJ: part.energyJ }
          : {}),
      })),
      connections: [...this.#connections.values()].map((connection) => ({
        id: connection.id,
        stress: connection.stress,
        fatigue: connection.fatigue,
        failed: connection.failed,
        peakLoadN: connection.peakLoadN,
        peakTorqueNm: connection.peakTorqueNm,
        lastLoadN: connection.lastLoadN ?? null,
        lastTorqueNm: connection.lastTorqueNm ?? null,
        forceUtilization: connection.forceUtilization ?? null,
        torqueUtilization: connection.torqueUtilization ?? null,
        failureReason: connection.failureReason ?? null,
        failureMode: connection.failureMode ?? null,
        failedAtS: connection.failedAtS ?? null,
      })),
      controllers: [...this.#controllers].map(([id, state]) => ({ id, state })),
      events: this.#events,
    });
  }

  validateState(state) {
    if (
      state?.version !== 2 ||
      !checkpointKeysMatch(state, [
        "version",
        "revision",
        "graphRevision",
        "parts",
        "connections",
        "controllers",
        "events",
      ]) ||
      !Array.isArray(state.parts) ||
      !Array.isArray(state.connections) ||
      !Array.isArray(state.controllers) ||
      !Array.isArray(state.events)
    )
      throw new DomainValidationError(
        "INVALID_RUN_GRAPH_CHECKPOINT",
        "Run graph checkpoint must use the version 2 mutable-state projection",
      );
    const startParts = new Map(
        this.#startSnapshot.parts.map((part) => [part.id, part]),
      ),
      startPartIds = new Set(startParts.keys()),
      startConnectionIds = new Set(
        this.#startSnapshot.connections.map((connection) => connection.id),
      ),
      parts = new Map(),
      connections = new Map(),
      controllers = new Map();
    for (const record of state.parts) {
      const startPart = startParts.get(record?.id),
        expectedFields = componentElectricalSource(startPart)
          ? ["id", "detached", "energyJ"]
          : ["id", "detached"];
      if (
        !startPart ||
        parts.has(record.id) ||
        !checkpointKeysMatch(record, expectedFields) ||
        typeof record.detached !== "boolean" ||
        (Object.hasOwn(record, "energyJ") &&
          (!Number.isFinite(record.energyJ) ||
            record.energyJ < 0 ||
            record.energyJ > this.#parts.get(record.id).capacityJ))
      )
        throw new DomainValidationError(
          "RUN_GRAPH_CHECKPOINT_IDENTITY_MISMATCH",
          "Run graph part checkpoint does not match the starting assembly",
        );
      parts.set(record.id, structuredClone(record));
    }
    for (const record of state.connections) {
      const optionalNumbers = [
          "lastLoadN",
          "lastTorqueNm",
          "forceUtilization",
          "torqueUtilization",
          "failedAtS",
        ],
        requiredNumbers = ["stress", "fatigue", "peakLoadN", "peakTorqueNm"];
      if (
        !startConnectionIds.has(record?.id) ||
        connections.has(record.id) ||
        !checkpointKeysMatch(record, CONNECTION_CHECKPOINT_FIELDS) ||
        requiredNumbers.some(
          (field) => !Number.isFinite(record[field]) || record[field] < 0,
        ) ||
        record.fatigue > 1 ||
        optionalNumbers.some(
          (field) =>
            record[field] !== null &&
            (!Number.isFinite(record[field]) || record[field] < 0),
        ) ||
        typeof record.failed !== "boolean" ||
        !["failureReason", "failureMode"].every(
          (field) =>
            record[field] === null || typeof record[field] === "string",
        ) ||
        (record.failed
          ? record.failureReason === null ||
            record.failureMode === null ||
            record.failedAtS === null
          : record.failureReason !== null ||
            record.failureMode !== null ||
            record.failedAtS !== null)
      )
        throw new DomainValidationError(
          "INVALID_RUN_GRAPH_CONNECTION_CHECKPOINT",
          `Run graph connection checkpoint is invalid for ${String(record?.id)}`,
        );
      connections.set(record.id, structuredClone(record));
    }
    if (
      parts.size !== startPartIds.size ||
      [...startPartIds].some((id) => !parts.has(id)) ||
      connections.size !== startConnectionIds.size ||
      [...startConnectionIds].some((id) => !connections.has(id))
    )
      throw new DomainValidationError(
        "RUN_GRAPH_CHECKPOINT_IDENTITY_MISMATCH",
        "Run graph checkpoint does not match the starting assembly",
      );
    for (const record of state.controllers) {
      if (
        !checkpointKeysMatch(record, ["id", "state"]) ||
        !startPartIds.has(record.id) ||
        controllers.has(record.id) ||
        !record.state ||
        typeof record.state !== "object" ||
        Array.isArray(record.state) ||
        !checkpointTreeIsFinite(record.state)
      )
        throw new DomainValidationError(
          "INVALID_RUN_GRAPH_CONTROLLER_CHECKPOINT",
          "Run graph controller checkpoint is invalid",
        );
      controllers.set(record.id, immutableClone(record.state));
    }
    if (
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      !Number.isSafeInteger(state.graphRevision) ||
      state.graphRevision < 0 ||
      state.graphRevision > state.revision ||
      state.events.length !== state.graphRevision
    )
      throw new DomainValidationError(
        "INVALID_RUN_GRAPH_CHECKPOINT_REVISION",
        "Run graph checkpoint revisions are invalid",
      );
    const events = state.events.map((event, index) => {
      if (
        !checkpointKeysMatch(event, STRUCTURAL_EVENT_FIELDS) ||
        event.type !== "structural" ||
        event.graphRevision !== index + 1 ||
        !uniqueKnownIds(event.failedConnectionIds, startConnectionIds) ||
        !uniqueKnownIds(
          event.failedInternalEdgeIds,
          this.#checkpointInternalEdgeIds,
        ) ||
        !uniqueKnownIds(event.detachedPartIds, startPartIds) ||
        typeof event.reason !== "string" ||
        typeof event.mode !== "string" ||
        !Number.isFinite(event.time) ||
        event.time < 0
      )
        throw new DomainValidationError(
          "INVALID_RUN_GRAPH_EVENT_CHECKPOINT",
          `Run graph structural event ${index} is invalid`,
        );
      return deepFreeze(structuredClone(event));
    });
    const replayedFailures = new Map(),
      replayedDetachments = new Set();
    for (const [index, event] of events.entries()) {
      let changed = event.failedInternalEdgeIds.length > 0;
      for (const connectionId of event.failedConnectionIds)
        if (!replayedFailures.has(connectionId)) {
          replayedFailures.set(connectionId, {
            reason: event.reason,
            mode: event.mode,
            time: event.time,
          });
          changed = true;
        }
      const eventFailureIds = new Set(event.failedConnectionIds);
      for (const partId of event.detachedPartIds) {
        if (!replayedDetachments.has(partId)) {
          replayedDetachments.add(partId);
          changed = true;
        }
        const omittedIncidentFailure = this.#startSnapshot.connections.some(
          (connection) =>
            (connection.a === partId || connection.b === partId) &&
            !eventFailureIds.has(connection.id),
        );
        if (omittedIncidentFailure)
          throw new DomainValidationError(
            "RUN_GRAPH_CHECKPOINT_EVENT_STATE_MISMATCH",
            `Run graph structural event ${index} omits a connection failed by its detachment`,
          );
      }
      if (!changed)
        throw new DomainValidationError(
          "RUN_GRAPH_CHECKPOINT_EVENT_STATE_MISMATCH",
          `Run graph structural event ${index} does not represent a graph mutation`,
        );
    }
    for (const [id, record] of connections) {
      const failure = replayedFailures.get(id);
      if (
        record.failed !== Boolean(failure) ||
        (failure &&
          (record.failureReason !== failure.reason ||
            record.failureMode !== failure.mode ||
            record.failedAtS !== failure.time))
      )
        throw new DomainValidationError(
          "RUN_GRAPH_CHECKPOINT_EVENT_STATE_MISMATCH",
          `Run graph connection ${String(id)} does not match its structural event history`,
        );
    }
    for (const [id, record] of parts)
      if (record.detached !== replayedDetachments.has(id))
        throw new DomainValidationError(
          "RUN_GRAPH_CHECKPOINT_EVENT_STATE_MISMATCH",
          `Run graph part ${String(id)} does not match its structural event history`,
        );
    return {
      parts,
      connections,
      controllers,
      events,
      revision: state.revision,
      graphRevision: state.graphRevision,
    };
  }

  importState(state) {
    const validated = this.validateState(state);
    this.#parts = new Map(
      [...this.#parts].map(([id, current]) => {
        const saved = validated.parts.get(id),
          next = { ...current, detached: saved.detached };
        if (Object.hasOwn(saved, "energyJ"))
          Object.assign(
            next,
            batteryEnergyReadModel({
              capacityJ: current.capacityJ,
              energyJ: saved.energyJ,
            }),
          );
        return [id, deepFreeze(next)];
      }),
    );
    this.#connections = new Map(
      [...this.#connections].map(([id, current]) => {
        const saved = validated.connections.get(id),
          next = { ...current };
        for (const field of CONNECTION_CHECKPOINT_FIELDS)
          if (field !== "id") {
            if (saved[field] === null) delete next[field];
            else next[field] = saved[field];
          }
        return [id, deepFreeze(next)];
      }),
    );
    this.#controllers = validated.controllers;
    this.#events = validated.events;
    this.#revision = validated.revision;
    this.#graphRevision = validated.graphRevision;
    this.#indexRevision = -1;
    this.#snapshotRevision = -1;
    this.#snapshot = null;
  }

  #requirePart(id) {
    const canonical = canonicalId(id),
      value = this.#parts.get(canonical);
    if (!value)
      throw new DomainValidationError(
        "UNKNOWN_RUNTIME_PART",
        `Runtime part ${String(id)} does not exist`,
      );
    return value;
  }

  #requireConnection(id) {
    const canonical = canonicalId(id),
      value = this.#connections.get(canonical);
    if (!value)
      throw new DomainValidationError(
        "UNKNOWN_RUNTIME_CONNECTION",
        `Runtime connection ${String(id)} does not exist`,
      );
    return value;
  }

  #refreshIndexes() {
    if (this.#indexRevision === this.#graphRevision) return;
    const adjacency = new Map([...this.#parts.keys()].map((id) => [id, []]));
    for (const connection of this.#connections.values()) {
      if (connection.failed) continue;
      if (
        this.#parts.get(connection.a)?.detached ||
        this.#parts.get(connection.b)?.detached
      )
        continue;
      adjacency
        .get(connection.a)
        .push({ id: connection.b, connection: structuredClone(connection) });
      adjacency
        .get(connection.b)
        .push({ id: connection.a, connection: structuredClone(connection) });
    }
    this.#adjacency = adjacency;
    this.#indexRevision = this.#graphRevision;
  }
}
