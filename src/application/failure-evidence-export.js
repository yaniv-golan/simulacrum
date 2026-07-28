import { analyzeFailureEvidence } from "../model/failure-evidence-analysis.js";
import {
  decodeFailureEvidenceOrThrow,
  failureEvidenceManifestDigest,
} from "../model/failure-evidence-artifacts.js";
import { stableStringify } from "../model/primitives.js";

const VALIDITIES = new Set(["measured", "derived", "unavailable", "truncated"]);

function id(value) {
  return value == null ? null : String(value);
}

function validity(value) {
  return VALIDITIES.has(value) ? value : "unavailable";
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function measuredValidity(value, numbers) {
  return numbers.every((number) => Number.isFinite(Number(number)))
    ? validity(value)
    : "unavailable";
}

function vector(value, nullable = false) {
  if (!value && nullable) return null;
  return [
    finite(value?.x ?? value?.[0]),
    finite(value?.y ?? value?.[1]),
    finite(value?.z ?? value?.[2]),
  ];
}

function ids(values) {
  return [...new Set((values || []).map(String))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function normalizeCommandLedger(ledger) {
  const writes = [
    ...(ledger?.remote || []).map((entry) => ({
      source: "remote",
      sourceId: "operator",
      targetId: String(entry.targetId),
      channelId: String(entry.channel),
      value: Number(entry.value),
    })),
    ...(ledger?.script || []).map((entry) => ({
      source: "script",
      sourceId: String(entry.controllerId),
      targetId: String(entry.targetId),
      channelId: String(entry.channel),
      value: Number(entry.value),
    })),
  ].sort(
    (left, right) =>
      left.targetId.localeCompare(right.targetId, "en") ||
      left.channelId.localeCompare(right.channelId, "en") ||
      left.source.localeCompare(right.source, "en"),
  );
  return {
    writes,
    conflicts: ids(ledger?.conflicts),
    rejections: (ledger?.rejections || []).map((entry) => ({
      source: entry.controllerId
        ? "script"
        : entry.targetId != null
          ? "remote"
          : "unknown",
      sourceId: entry.controllerId ? String(entry.controllerId) : null,
      targetId: id(entry.targetId),
      channelId: id(entry.channel),
      value: Number.isFinite(Number(entry.value)) ? Number(entry.value) : null,
      reason: String(entry.reason || "route rejected"),
    })),
    capabilities: ids(ledger?.capabilities),
  };
}

function normalizeTireEvidence(evidence) {
  if (!evidence) return null;
  const numericFields = [
    evidence.rawPointWorldM?.x,
    evidence.rawPointWorldM?.y,
    evidence.rawPointWorldM?.z,
    evidence.correctedPointWorldM?.x,
    evidence.correctedPointWorldM?.y,
    evidence.correctedPointWorldM?.z,
    evidence.correctionWorldM?.x,
    evidence.correctionWorldM?.y,
    evidence.correctionWorldM?.z,
    evidence.geometricToleranceM,
  ].filter((value) => value != null);
  return {
    partId: id(evidence.tirePartId),
    contactRole: id(evidence.contactRole),
    semanticRegionKey: id(evidence.semanticRegionKey),
    rawPointWorldM: vector(evidence.rawPointWorldM, true),
    correctedPointWorldM: vector(evidence.correctedPointWorldM, true),
    correctionWorldM: vector(evidence.correctionWorldM, true),
    geometricToleranceM: Number.isFinite(Number(evidence.geometricToleranceM))
      ? Number(evidence.geometricToleranceM)
      : null,
    withinGeometricTolerance:
      typeof evidence.withinGeometricTolerance === "boolean"
        ? evidence.withinGeometricTolerance
        : null,
    manifoldId: id(evidence.manifoldId),
    supportFeatureId: id(evidence.supportFeatureId),
    supportValidity: validity(evidence.supportValidity),
    forceRowIds: ids(evidence.tireForceRowIds),
    validity: measuredValidity(evidence.validity, numericFields),
  };
}

function normalizeContact(contact) {
  const numericFields = [
    contact.point?.x,
    contact.point?.y,
    contact.point?.z,
    contact.normal?.x,
    contact.normal?.y,
    contact.normal?.z,
    contact.forceWorldN?.x,
    contact.forceWorldN?.y,
    contact.forceWorldN?.z,
    contact.forceN,
  ];
  return {
    contactId: id(contact.contactId),
    bodyId: String(contact.bodyId),
    otherBodyId: id(contact.otherBodyId),
    partIds: ids(contact.partIds),
    pointWorldM: vector(contact.point),
    normalWorld: vector(contact.normal),
    forceWorldN: vector(contact.forceWorldN),
    forceN: Math.max(0, finite(contact.forceN)),
    materialKey: id(contact.otherMaterialKey),
    supportShapeId: id(contact.supportShapeId),
    surfaceRegionId: id(contact.surfaceRegionId),
    featureId: contact.featureId
      ? {
          cellX: Number(contact.featureId.cellX),
          cellZ: Number(contact.featureId.cellZ),
          triangle:
            contact.featureId.triangle === "upper" ||
            contact.featureId.triangle === 1
              ? 1
              : 0,
        }
      : null,
    featureValidity: validity(contact.featureValidity),
    tireEvidence: normalizeTireEvidence(contact.tireEvidence),
    validity: measuredValidity(contact.validity, numericFields),
  };
}

function normalizeContribution(row) {
  const numericFields = [
    row.forceWorldN?.x,
    row.forceWorldN?.y,
    row.forceWorldN?.z,
    row.momentAtApplicationPointWorldNm?.x,
    row.momentAtApplicationPointWorldNm?.y,
    row.momentAtApplicationPointWorldNm?.z,
    row.applicationPointWorldM?.x,
    row.applicationPointWorldM?.y,
    row.applicationPointWorldM?.z,
    row.forceMagnitudeN,
    row.momentMagnitudeNm,
    row.multiplier,
  ];
  return {
    rowId: String(row.rowId),
    rowKind: String(row.rowKind || "equation"),
    source: ["constraint", "contact", "friction", "tire-force"].includes(
      row.source,
    )
      ? row.source
      : "constraint",
    side: row.side === "B" ? "B" : "A",
    bodyId: id(row.bodyId),
    otherBodyId: id(row.otherBodyId),
    constraintId: id(row.constraintId),
    sourceConnectionIds: ids(row.sourceConnectionIds),
    sourceContactIds: ids(row.sourceContactIds),
    forceWorldN: vector(row.forceWorldN),
    momentWorldNm: vector(row.momentAtApplicationPointWorldNm),
    applicationPointWorldM: vector(row.applicationPointWorldM),
    forceMagnitudeN: Math.max(0, finite(row.forceMagnitudeN)),
    momentMagnitudeNm: Math.max(0, finite(row.momentMagnitudeNm)),
    multiplier: finite(row.multiplier),
    validity: measuredValidity(row.validity, numericFields),
  };
}

function normalizeTopology(topology) {
  if (topology?.snapshotState === "revision-only")
    return {
      snapshotState: "revision-only",
      graphRevision: Math.max(0, Math.trunc(finite(topology.graphRevision))),
    };
  return {
    snapshotState: "full",
    graphRevision: Math.max(0, Math.trunc(finite(topology?.graphRevision))),
    connections: (topology?.connections || []).map((connection) => ({
      id: String(connection.id),
      a: String(connection.a),
      b: String(connection.b),
      kind: connection.kind === "mesh" ? "mesh" : "mechanical",
      failed: Boolean(connection.failed),
    })),
    detachedPartIds: ids(topology?.detachedPartIds),
  };
}

function normalizePreMutation(stage) {
  if (!stage) return null;
  return {
    evaluations: (stage.evaluations || []).map((entry) => ({
      connectionId: String(entry.connectionId),
      loadN: Math.max(0, finite(entry.loadN)),
      torqueNm: Math.max(0, finite(entry.torqueNm)),
      ultimateForceN: Math.max(0, finite(entry.ultimateForceN)),
      ultimateTorqueNm: Math.max(0, finite(entry.ultimateTorqueNm)),
      forceUtilization: Math.max(0, finite(entry.forceUtilization)),
      torqueUtilization: Math.max(0, finite(entry.torqueUtilization)),
      stress: Math.max(0, finite(entry.stress)),
      fatigue: Math.max(0, finite(entry.fatigue)),
    })),
    topology: normalizeTopology(stage.topology),
  };
}

function normalizePostMutation(stage) {
  if (!stage) return null;
  const event = stage.event;
  return {
    event: event
      ? {
          failedConnectionIds: ids(event.failedConnectionIds),
          detachedPartIds: ids(event.detachedPartIds),
          mode: String(event.mode || "structural"),
          reason: String(event.reason || "structural event"),
        }
      : null,
    topology: normalizeTopology(stage.topology),
  };
}

function normalizeExactFrame(frame) {
  return {
    tick: frame.tick,
    timeS: Math.max(0, finite(frame.timeS, frame.tick / 120)),
    commandLedger: normalizeCommandLedger(frame.commandLedger),
    contacts: (frame.contacts || []).map(normalizeContact),
    solverContributions: (frame.solverContributions || []).map(
      normalizeContribution,
    ),
    connectionLoads: (frame.connectionLoads || []).map((entry) => ({
      connectionId: String(entry.connectionId),
      forceN: Math.max(0, finite(entry.forceN)),
      torqueNm: Math.max(0, finite(entry.torqueNm)),
    })),
    structurePreMutation: normalizePreMutation(frame.structurePreMutation),
    structurePostMutation: normalizePostMutation(frame.structurePostMutation),
    contributionValidity: validity(frame.contributionValidity),
    omittedRowCount: Math.max(0, Math.trunc(finite(frame.omittedRowCount))),
  };
}

function normalizeContextFrame(frame) {
  const assemblies = frame.mobility?.assemblies || [];
  return {
    tick: frame.tick,
    timeS: Math.max(0, finite(frame.timeS, frame.tick / 120)),
    graphRevision: Math.max(0, Math.trunc(finite(frame.graphRevision))),
    commandLedger: normalizeCommandLedger(frame.commandLedger),
    connectionLoads: (frame.connectionLoads || []).map((entry) => ({
      connectionId: String(entry.connectionId),
      forceN: Math.max(0, finite(entry.forceN)),
      torqueNm: Math.max(0, finite(entry.torqueNm)),
    })),
    assemblies: assemblies.map((assembly) => ({
      assemblyId: String(assembly.assemblyId),
      positionWorldM: vector(assembly.pose?.position),
      signedSpeedMPerS: finite(assembly.signedSpeed),
      grounded: Boolean(assembly.grounded),
      brake: Math.max(0, Math.min(1, finite(assembly.brake))),
      motors: (assembly.driveForce?.motors || []).map((motor) => ({
        partId: String(motor.partId),
        resolvedThrottle: Math.max(
          -1,
          Math.min(1, finite(motor.resolvedThrottle)),
        ),
        commandSource: String(motor.commandSource || "default"),
        availablePowerW: Math.max(0, finite(motor.availablePowerW)),
        deliveredPowerW: Math.max(0, finite(motor.deliveredPowerW)),
        operational: Boolean(motor.operational),
        shaftPositionRad: finite(motor.shaftPositionRad),
        shaftAngularSpeedRadPerS: finite(motor.shaftAngularSpeedRadPerS),
      })),
      wheels: (assembly.wheelStates || []).map((wheel) => ({
        partId: String(wheel.partId),
        touching: Boolean(wheel.touching),
        angularSpeed: finite(wheel.angularSpeed),
        normalLoadN: Math.max(0, finite(wheel.normalLoadN)),
      })),
    })),
  };
}

function normalizeTrigger(trigger) {
  return {
    kind: trigger.kind,
    tick: trigger.tick,
    timeS: Math.max(0, finite(trigger.timeS, trigger.tick / 120)),
    subjectId: id(trigger.subjectId),
    validity: validity(trigger.validity),
  };
}

/** Composes the application-private, self-contained diagnostic wire artifact. */
export function createFailureEvidenceArtifact({
  runtime,
  snapshot: suppliedSnapshot = null,
}) {
  const recorder = runtime?.failureEvidence?.recorder,
    snapshot = suppliedSnapshot || recorder?.snapshot(),
    trigger = snapshot?.trigger;
  if (!trigger) throw new Error("Failure evidence has not captured a trigger");
  const runIdentity = runtime.runIdentity,
    replayability = {
      status:
        snapshot.replayability?.state === "supported"
          ? "supported"
          : "unsupported",
      reasonCode:
        snapshot.replayability?.state === "supported"
          ? null
          : String(
              snapshot.replayability?.reasonCode || "REPLAY_ANCHOR_UNAVAILABLE",
            ),
    },
    exactFrames = snapshot.exactFrames.map(normalizeExactFrame),
    artifact = {
      format: "simulacrum-failure-evidence",
      version: 2,
      blueprint: structuredClone(runtime.runBlueprint),
      runConfiguration: structuredClone(runIdentity.configuration),
      runIdentity: {
        runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
        blueprintFingerprint: runIdentity.blueprintFingerprint,
        compiledTopologyFingerprint: runIdentity.compiledTopologyFingerprint,
        testSiteFingerprint: runIdentity.testSiteFingerprint,
        materialMapFingerprint: runIdentity.materialMapFingerprint,
        deploymentFingerprint: runIdentity.deploymentFingerprint,
        deploymentJson: stableStringify(runIdentity.deployment),
        environment: structuredClone(runIdentity.environment),
      },
      diagnosticPolicy: structuredClone(snapshot.policy),
      policyFingerprint: snapshot.policyFingerprint,
      replayAnchorCheckpoint:
        replayability.status === "supported"
          ? structuredClone(runtime.failureEvidence.replayAnchor)
          : null,
      externalInputTrace: {
        format: "simulacrum-input-trace",
        version: 1,
        runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
        startTick: 1,
        endTick: trigger.tick,
        inputs: runtime.inputTraceRecorder
          .inputsThrough(trigger.tick)
          .filter((entry) => entry.tick >= 1),
      },
      priorEpisodeBoundaries: structuredClone(
        snapshot.priorEpisodeBoundaries || [],
      ),
      trigger: normalizeTrigger(trigger),
      triggers: snapshot.triggers.map(normalizeTrigger),
      exactFrames,
      contextFrames: snapshot.contextFrames.map(normalizeContextFrame),
      summary: null,
      replayability,
      manifestDigest: "0".repeat(64),
    };
  artifact.summary = analyzeFailureEvidence(artifact);
  artifact.manifestDigest = failureEvidenceManifestDigest(artifact);
  return decodeFailureEvidenceOrThrow(artifact).wire;
}
