import { deepFreeze, DomainValidationError } from "../model/primitives.js";
import {
  createFailureEvidencePolicy,
  failureEvidencePolicyFingerprint,
} from "./failure-evidence-policy.js";

const encoder = new TextEncoder();
const TRIGGER_PRIORITY = Object.freeze({
  "structural-failure": 4,
  "contact-invariant": 3,
  "rolling-actuator-stall": 2,
  "numerical-anomaly": 1,
});
const STAGE_ORDER = Object.freeze({
  command: 1,
  physics: 2,
  "structure-pre": 3,
  "structure-post": 4,
  complete: 5,
});

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function serializedBytes(value) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function rowMagnitude(row) {
  return Math.max(
    0,
    Number(row?.forceMagnitudeN || 0),
    Number(row?.momentMagnitudeNm || 0),
  );
}

function rowOrder(left, right) {
  return (
    rowMagnitude(right) - rowMagnitude(left) ||
    String(left.rowId).localeCompare(String(right.rowId), "en") ||
    String(left.side || "").localeCompare(String(right.side || ""), "en")
  );
}

function uniqueRows(rows) {
  const byId = new Map();
  for (const row of rows || []) {
    const key = `${String(row?.rowId)}\0${String(row?.side || "")}`;
    if (!byId.has(key)) byId.set(key, row);
  }
  return [...byId.values()];
}

function nearConnectionIds(frame, policy) {
  return (frame.structurePreMutation?.evaluations || [])
    .filter(
      (entry) =>
        Math.max(
          Number(entry.forceUtilization || 0),
          Number(entry.torqueUtilization || 0),
        ) >= policy.nearFailureUtilization,
    )
    .map((entry) => String(entry.connectionId));
}

function compactRows(frame, policy, triggered, totalRowCount = null) {
  const rows = uniqueRows(frame.solverContributions),
    nearConnections = new Set(nearConnectionIds(frame, policy)),
    total = totalRowCount == null ? rows.length : totalRowCount;
  if (triggered) {
    const sorted = [...rows].sort(rowOrder),
      retained = sorted.slice(0, policy.maxRowsOnTriggerTick);
    return {
      rows: retained,
      validity: retained.length === total ? "measured" : "truncated",
      omittedRowCount: Math.max(0, total - retained.length),
    };
  }
  const retained = new Map(),
    byConnection = new Map(),
    unprojected = [];
  for (const row of rows) {
    const connectionIds = row.sourceConnectionIds || [];
    if (!connectionIds.length) {
      unprojected.push(row);
      continue;
    }
    for (const connectionId of connectionIds) {
      const key = String(connectionId),
        list = byConnection.get(key) || [];
      list.push(row);
      byConnection.set(key, list);
    }
  }
  for (const [connectionId, list] of byConnection) {
    const selected = nearConnections.has(connectionId)
      ? list
      : [...list].sort(rowOrder).slice(0, policy.topRowsPerConnection);
    for (const row of selected)
      retained.set(`${row.rowId}\0${row.side || ""}`, row);
  }
  for (const row of unprojected
    .sort(rowOrder)
    .slice(0, policy.topRowsPerConnection))
    retained.set(`${row.rowId}\0${row.side || ""}`, row);
  const selected = [...retained.values()].sort(rowOrder),
    capped = selected.slice(0, policy.maxRowsPerExactFrame);
  return {
    rows: capped,
    validity: capped.length === total ? "measured" : "truncated",
    omittedRowCount: Math.max(0, total - capped.length),
  };
}

function boundedMeasuredPush(values, byteSizes, value, maximum) {
  const size = serializedBytes(value);
  values.push(value);
  byteSizes.push(size);
  let removedBytes = 0;
  if (values.length > maximum) {
    const removeCount = values.length - maximum;
    values.splice(0, removeCount);
    removedBytes = byteSizes
      .splice(0, removeCount)
      .reduce((total, removed) => total + removed, 0);
  }
  return size - removedBytes;
}

function arrayPayloadBytes(byteSizes) {
  return (
    byteSizes.reduce((total, size) => total + size, 0) +
    Math.max(0, byteSizes.length - 1)
  );
}

function revisionOnlyTopology(topology) {
  return {
    snapshotState: "revision-only",
    graphRevision: Number(topology?.graphRevision || 0),
  };
}

function evaluationMagnitude(evaluation) {
  return Math.max(
    Number(evaluation?.forceUtilization || 0),
    Number(evaluation?.torqueUtilization || 0),
  );
}

function loadMagnitude(load) {
  return Math.max(Number(load?.forceN || 0), Number(load?.torqueNm || 0));
}

function compactConnectionLoads(loads, maximum) {
  return [...(loads || [])]
    .sort(
      (left, right) =>
        loadMagnitude(right) - loadMagnitude(left) ||
        String(left.connectionId).localeCompare(
          String(right.connectionId),
          "en",
        ),
    )
    .slice(0, maximum);
}

function compactStructureHistory(frame, triggered, policy) {
  if (triggered) return frame;
  const pre = frame.structurePreMutation,
    post = frame.structurePostMutation;
  return {
    ...frame,
    connectionLoads: compactConnectionLoads(
      frame.connectionLoads,
      policy.topRowsPerConnection,
    ),
    structurePreMutation: pre
      ? {
          ...pre,
          evaluations: [...(pre.evaluations || [])]
            .sort(
              (left, right) =>
                evaluationMagnitude(right) - evaluationMagnitude(left) ||
                String(left.connectionId).localeCompare(
                  String(right.connectionId),
                  "en",
                ),
            )
            .slice(0, policy.topRowsPerConnection),
          topology: revisionOnlyTopology(pre.topology),
        }
      : null,
    structurePostMutation: post?.event ? post : null,
  };
}

function advanceStage(frame, stage) {
  const next = STAGE_ORDER[stage],
    current = Number(frame._stageOrder || 0);
  if (!next || next <= current)
    throw new DomainValidationError(
      "FAILURE_EVIDENCE_STAGE_ORDER",
      `Failure-evidence stage ${stage} cannot follow ${frame._stage || "start"}`,
      { details: { tick: frame.tick, previousStage: frame._stage, stage } },
    );
  frame._stage = stage;
  frame._stageOrder = next;
}

function triggerOrder(left, right) {
  return (
    left.tick - right.tick ||
    (TRIGGER_PRIORITY[right.kind] || 0) - (TRIGGER_PRIORITY[left.kind] || 0) ||
    String(left.subjectId || "").localeCompare(
      String(right.subjectId || ""),
      "en",
    )
  );
}

function boundedDiagnostic(frame, trigger) {
  if (!frame || !trigger) return null;
  const failedConnectionId =
      frame.structurePostMutation?.event?.failedConnectionIds?.[0] ||
      (trigger.kind === "structural-failure" ? trigger.subjectId : null),
    rows = frame.solverContributions
      .filter(
        (row) =>
          !failedConnectionId ||
          (row.sourceConnectionIds || [])
            .map(String)
            .includes(String(failedConnectionId)),
      )
      .sort(rowOrder),
    contribution = rows[0] || null,
    sourceContactId = contribution?.sourceContactIds?.[0] || null,
    contact =
      frame.contacts.find((entry) => entry.contactId === sourceContactId) ||
      [...frame.contacts].sort(
        (left, right) => Number(right.forceN || 0) - Number(left.forceN || 0),
      )[0] ||
      null,
    evaluation = failedConnectionId
      ? frame.structurePreMutation?.evaluations?.find(
          (entry) => String(entry.connectionId) === String(failedConnectionId),
        ) || null
      : null;
  return {
    contact: contact
      ? {
          contactId: contact.contactId,
          materialKey: contact.otherMaterialKey,
          supportShapeId: contact.supportShapeId,
          surfaceRegionId: contact.surfaceRegionId,
          featureId: contact.featureId,
          featureValidity: contact.featureValidity,
          forceN: contact.forceN,
          validity: contact.validity,
        }
      : null,
    contribution: contribution
      ? {
          rowId: contribution.rowId,
          rowKind: contribution.rowKind,
          forceMagnitudeN: contribution.forceMagnitudeN,
          momentMagnitudeNm: contribution.momentMagnitudeNm,
          validity: contribution.validity,
        }
      : null,
    connection: evaluation
      ? {
          connectionId: String(evaluation.connectionId),
          loadN: evaluation.loadN,
          torqueNm: evaluation.torqueNm,
          ultimateForceN: evaluation.ultimateForceN,
          ultimateTorqueNm: evaluation.ultimateTorqueNm,
          forceUtilization: evaluation.forceUtilization,
          torqueUtilization: evaluation.torqueUtilization,
        }
      : null,
    preTopologyRevision:
      frame.structurePreMutation?.topology?.graphRevision ?? null,
    postTopologyRevision:
      frame.structurePostMutation?.topology?.graphRevision ?? null,
  };
}

/**
 * Owns bounded, exact-tick diagnostic evidence without participating in
 * integration, contact, structural decisions, or topology mutation.
 */
export class FailureEvidenceRecorder {
  constructor({ policy = {} } = {}) {
    this.policy = createFailureEvidencePolicy(policy);
    this.reset();
  }

  /** @param {{runIdentity?:object,policy?:object}} [options] */
  beginRun({ runIdentity, policy = this.policy } = {}) {
    if (!runIdentity)
      throw new DomainValidationError(
        "FAILURE_EVIDENCE_RUN_IDENTITY_REQUIRED",
        "Failure evidence requires one immutable run identity",
      );
    this.reset();
    this.policy = createFailureEvidencePolicy(policy);
    this.runIdentity = immutable(runIdentity);
    this.policyFingerprint = failureEvidencePolicyFingerprint(this.policy);
    this.active = true;
    this.liveMetadataBytes = null;
  }

  /** Starts the next bounded episode without changing the tick-zero anchor. */
  rearmEpisode({ priorEpisodeBoundaries = [] } = {}) {
    if (!this.active || !this.frozen)
      throw new DomainValidationError(
        "FAILURE_EVIDENCE_EPISODE_NOT_FROZEN",
        "Failure evidence can re-arm only after a completed episode",
      );
    if (
      !Array.isArray(priorEpisodeBoundaries) ||
      priorEpisodeBoundaries.length > 31
    )
      throw new DomainValidationError(
        "FAILURE_EVIDENCE_EPISODE_HISTORY_LIMIT",
        "Failure-evidence prior episode history must contain at most 31 boundaries",
      );
    this.priorEpisodeBoundaries = immutable(priorEpisodeBoundaries);
    this.current = null;
    this.exactFrames = [];
    this.contextFrames = [];
    this.exactFrameByteSizes = [];
    this.contextFrameByteSizes = [];
    this.triggers = [];
    this.primaryTrigger = null;
    this.frozen = null;
    this.frozenTelemetrySummary = null;
    this.frozenMemoryBytes = 0;
    this.liveMetadataBytes = null;
  }

  setReplayability({ supported, reasonCode = null }) {
    if (!this.active)
      throw new DomainValidationError(
        "FAILURE_EVIDENCE_RUN_NOT_ACTIVE",
        "Replayability can be set only for an active evidence run",
      );
    this.replayability = immutable({
      state: supported ? "supported" : "unsupported",
      reasonCode: supported
        ? null
        : String(reasonCode || "REPLAY_ANCHOR_UNAVAILABLE"),
    });
    this.liveMetadataBytes = null;
  }

  /** Whether the observer still needs exact per-tick provenance. */
  acceptingEvidence() {
    return this.active && !this.frozen;
  }

  #frame(tick, timeS = null) {
    if (!this.active || this.frozen) return null;
    if (!Number.isSafeInteger(tick) || tick < 0)
      throw new DomainValidationError(
        "INVALID_FAILURE_EVIDENCE_TICK",
        "Failure evidence tick must be a non-negative safe integer",
      );
    if (this.current && this.current.tick !== tick)
      throw new DomainValidationError(
        "FAILURE_EVIDENCE_TICK_NOT_COMPLETED",
        `Tick ${this.current.tick} was not completed before tick ${tick}`,
      );
    this.current ||= {
      tick,
      timeS,
      _stage: null,
      _stageOrder: 0,
      commandLedger: null,
      contacts: [],
      solverContributions: [],
      connectionLoads: [],
      structurePreMutation: null,
      structurePostMutation: null,
    };
    if (timeS != null) this.current.timeS = Number(timeS);
    return this.current;
  }

  recordCommandStage({ tick, timeS, commandLedger }) {
    const frame = this.#frame(tick, timeS);
    if (!frame) return;
    advanceStage(frame, "command");
    // Command telemetry is a completed-stage DTO. The retained frame receives
    // its defensive clone once, during completeTick().
    frame.commandLedger = commandLedger || {};
  }

  recordPhysicsStage({
    tick,
    timeS,
    contacts = [],
    solverContributions = [],
    connectionLoads = [],
  }) {
    const frame = this.#frame(tick, timeS);
    if (!frame) return;
    advanceStage(frame, "physics");
    // These are completed-tick DTO arrays owned by the physics stage. Delay
    // the one defensive clone until compaction commits the retained frame.
    frame.contacts = contacts;
    frame.solverContributions = solverContributions;
    frame.connectionLoads = connectionLoads;
  }

  recordStructurePreMutation({ tick, timeS, evaluations, topology }) {
    const frame = this.#frame(tick, timeS);
    if (!frame) return;
    advanceStage(frame, "structure-pre");
    // Both values are fresh structural DTOs, not live graph objects. Retain
    // their exact pre-mutation values until completeTick() clones the frame.
    frame.structurePreMutation = { evaluations, topology };
  }

  trigger({
    kind,
    tick,
    timeS = null,
    subjectId = null,
    validity = "measured",
  }) {
    if (!this.active || this.frozen) return;
    if (!Object.hasOwn(TRIGGER_PRIORITY, kind))
      throw new DomainValidationError(
        "UNKNOWN_FAILURE_EVIDENCE_TRIGGER",
        `Unknown failure-evidence trigger ${String(kind)}`,
      );
    this.#frame(tick, timeS);
    const candidate = {
      kind,
      tick,
      timeS,
      subjectId: subjectId == null ? null : String(subjectId),
      validity,
    };
    this.triggers.push(candidate);
    this.triggers.sort(triggerOrder);
    this.primaryTrigger = this.triggers[0];
    this.liveMetadataBytes = null;
  }

  recordStructurePostMutation({ tick, timeS, event, topology }) {
    const frame = this.#frame(tick, timeS);
    if (!frame) return;
    if (!frame.structurePreMutation)
      throw new DomainValidationError(
        "FAILURE_EVIDENCE_MISSING_PRE_MUTATION_STAGE",
        `Tick ${tick} cannot record post-mutation evidence before pre-mutation evidence`,
      );
    advanceStage(frame, "structure-post");
    frame.structurePostMutation = { event, topology };
  }

  completeTick({ tick, timeS, contextTelemetry = {} }) {
    const frame = this.#frame(tick, timeS);
    if (!frame) return this.telemetrySummary();
    advanceStage(frame, "complete");
    const triggered = this.primaryTrigger?.tick === tick;
    let totalRowCount = null,
      retentionApplied = false;
    if (typeof frame.solverContributions === "function") {
      const completed = frame.solverContributions({
        triggered,
        nearConnectionIds: nearConnectionIds(frame, this.policy),
        policy: this.policy,
      });
      if (Array.isArray(completed)) frame.solverContributions = completed;
      else {
        frame.solverContributions = completed.rows;
        totalRowCount = completed.totalRowCount;
        retentionApplied = completed.retentionApplied === true;
      }
    }
    const compacted = retentionApplied
        ? {
            rows: frame.solverContributions,
            validity:
              frame.solverContributions.length === totalRowCount
                ? "measured"
                : "truncated",
            omittedRowCount: Math.max(
              0,
              totalRowCount - frame.solverContributions.length,
            ),
          }
        : compactRows(frame, this.policy, triggered, totalRowCount),
      frameEvidence = compactStructureHistory(frame, triggered, this.policy);
    delete frameEvidence._stage;
    delete frameEvidence._stageOrder;
    // Physics and structure producers hand the recorder fresh DTOs. The
    // command ledger is published by its owner as an immutable completed-stage
    // value, so it can be retained with the other recorder-owned DTOs.
    // Exported/frozen artifacts still pass through immutable() at their
    // boundary.
    const exactFrame = {
      ...frameEvidence,
      commandLedger: frameEvidence.commandLedger || {},
      solverContributions: compacted.rows,
      contributionValidity: compacted.validity,
      omittedRowCount: compacted.omittedRowCount,
    };
    boundedMeasuredPush(
      this.exactFrames,
      this.exactFrameByteSizes,
      exactFrame,
      this.policy.exactRetentionTicks,
    );
    if (tick % this.policy.contextStrideTicks === 0)
      boundedMeasuredPush(
        this.contextFrames,
        this.contextFrameByteSizes,
        {
          tick,
          timeS,
          commandLedger: frame.commandLedger || {},
          connectionLoads: compactConnectionLoads(
            frame.connectionLoads,
            this.policy.topRowsPerConnection,
          ),
          ...contextTelemetry,
        },
        Math.ceil(
          this.policy.contextRetentionTicks / this.policy.contextStrideTicks,
        ),
      );
    this.current = null;
    this.lastCompletedTick = tick;
    if (triggered && !this.frozen) this.#freeze();
    return this.telemetrySummary();
  }

  #freeze() {
    this.frozen = immutable({
      version: 1,
      runIdentity: this.runIdentity,
      policy: this.policy,
      policyFingerprint: this.policyFingerprint,
      priorEpisodeBoundaries: this.priorEpisodeBoundaries,
      replayability: this.replayability,
      trigger: this.primaryTrigger,
      triggers: this.triggers,
      exactFrames: this.exactFrames,
      contextFrames: this.contextFrames,
    });
    this.frozenMemoryBytes = serializedBytes(this.frozen);
  }

  #liveMemoryBytes() {
    this.liveMetadataBytes ??= serializedBytes({
      version: 1,
      runIdentity: this.runIdentity,
      policy: this.policy,
      policyFingerprint: this.policyFingerprint,
      priorEpisodeBoundaries: this.priorEpisodeBoundaries,
      replayability: this.replayability,
      trigger: this.primaryTrigger,
      triggers: this.triggers,
      exactFrames: [],
      contextFrames: [],
    });
    // The cached metadata size already includes each pair of empty brackets. The
    // retained payload contributes only serialized elements and commas.
    return (
      this.liveMetadataBytes +
      arrayPayloadBytes(this.exactFrameByteSizes) +
      arrayPayloadBytes(this.contextFrameByteSizes)
    );
  }

  telemetrySummary() {
    if (this.frozenTelemetrySummary) return this.frozenTelemetrySummary;
    const retained = this.frozen || {
        exactFrames: this.exactFrames,
        contextFrames: this.contextFrames,
      },
      memoryBytes = this.frozen
        ? this.frozenMemoryBytes
        : this.#liveMemoryBytes(),
      trigger = this.frozen?.trigger || this.primaryTrigger || null,
      triggeredFrame = trigger
        ? (this.frozen?.exactFrames || this.exactFrames).find(
            (frame) => frame.tick === trigger.tick,
          )
        : null;
    const summary = immutable({
      captureState: this.frozen
        ? "captured"
        : this.active
          ? "armed"
          : "inactive",
      trigger,
      validity:
        triggeredFrame?.contributionValidity ||
        (trigger ? trigger.validity : "unavailable"),
      replayability: this.frozen?.replayability || this.replayability,
      diagnostic: boundedDiagnostic(triggeredFrame, trigger),
      exactFrameCount: retained.exactFrames.length,
      contextFrameCount: retained.contextFrames.length,
      memoryBytes,
      lastCompletedTick: this.lastCompletedTick,
      episodeIndex: this.priorEpisodeBoundaries.length,
    });
    if (this.frozen) this.frozenTelemetrySummary = summary;
    return summary;
  }

  snapshot() {
    return immutable(
      this.frozen || {
        version: 1,
        runIdentity: this.runIdentity,
        policy: this.policy,
        policyFingerprint: this.policyFingerprint,
        priorEpisodeBoundaries: this.priorEpisodeBoundaries,
        replayability: this.replayability,
        trigger: this.primaryTrigger,
        triggers: this.triggers,
        exactFrames: this.exactFrames,
        contextFrames: this.contextFrames,
      },
    );
  }

  reset() {
    this.active = false;
    this.runIdentity = null;
    this.policyFingerprint = null;
    this.priorEpisodeBoundaries = immutable([]);
    this.current = null;
    this.exactFrames = [];
    this.contextFrames = [];
    this.exactFrameByteSizes = [];
    this.contextFrameByteSizes = [];
    this.triggers = [];
    this.primaryTrigger = null;
    this.frozen = null;
    this.frozenTelemetrySummary = null;
    this.frozenMemoryBytes = 0;
    this.liveMetadataBytes = null;
    this.lastCompletedTick = 0;
    this.replayability = immutable({
      state: "pending-anchor",
      reasonCode: null,
    });
  }
}
