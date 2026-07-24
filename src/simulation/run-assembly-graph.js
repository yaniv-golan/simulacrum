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
        deepFreeze({
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
      revision: this.#revision,
      graphRevision: this.#graphRevision,
      parts: [...this.#parts.values()],
      connections: [...this.#connections.values()],
      controllers: [...this.#controllers].map(([id, state]) => ({ id, state })),
      events: this.#events,
    });
  }

  importState(state) {
    if (!state || typeof state !== "object")
      throw new DomainValidationError(
        "INVALID_RUN_GRAPH_CHECKPOINT",
        "Run graph checkpoint must be an object",
      );
    const startPartIds = new Set(
        this.#startSnapshot.parts.map((part) => part.id),
      ),
      startConnectionIds = new Set(
        this.#startSnapshot.connections.map((connection) => connection.id),
      ),
      parts = state.parts || [],
      connections = state.connections || [];
    if (
      parts.length !== startPartIds.size ||
      parts.some((part) => !startPartIds.has(part.id)) ||
      connections.length !== startConnectionIds.size ||
      connections.some((connection) => !startConnectionIds.has(connection.id))
    )
      throw new DomainValidationError(
        "RUN_GRAPH_CHECKPOINT_IDENTITY_MISMATCH",
        "Run graph checkpoint does not match the starting assembly",
      );
    this.#parts = new Map(
      parts.map((part) => [part.id, deepFreeze(structuredClone(part))]),
    );
    this.#connections = new Map(
      connections.map((connection) => [
        connection.id,
        deepFreeze(structuredClone(connection)),
      ]),
    );
    this.#controllers = new Map(
      (state.controllers || []).map(({ id, state: controllerState }) => [
        id,
        immutableClone(controllerState),
      ]),
    );
    this.#events = (state.events || []).map((event) =>
      deepFreeze(structuredClone(event)),
    );
    this.#revision = finiteNumber(state.revision, {
      min: 0,
      path: ["checkpoint", "revision"],
    });
    this.#graphRevision = finiteNumber(state.graphRevision, {
      min: 0,
      path: ["checkpoint", "graphRevision"],
    });
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
