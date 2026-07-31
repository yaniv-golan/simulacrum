/** Publishes the immutable read model after every completed physics step. */
import { publishTelemetrySnapshot } from "../telemetry.js";
import { fingerprintRuntimeTopology } from "../route-evidence-index.js";

function slotCandidate(
  context,
  index,
  finalTopologyFingerprint,
  { allocation = false } = {},
) {
  const runIdentity = context.services.runIdentity;
  if (!index || !runIdentity?.runConfigurationFingerprint)
    return { status: "unsupported" };
  const consistency =
      index.runtimeTopologyFingerprint === finalTopologyFingerprint &&
      index.graphRevision === context.runGraph.graphRevision
        ? "current"
        : "superseded-in-frame",
    transactionId = allocation
      ? (index.resultFacts?.transactionId ?? null)
      : null,
    allocationTick = allocation ? (index.resultFacts?.tick ?? null) : null,
    identity = {
      phase: "live",
      runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
      runtimeTopologyFingerprint: index.runtimeTopologyFingerprint,
      networkGraphRevision: index.graphRevision,
      telemetryTick: context.clock.tick,
      networkResultDigest: index.networkResultDigest,
      finalRuntimeTopologyFingerprint: finalTopologyFingerprint,
      finalGraphRevision: context.runGraph.graphRevision,
      consistency,
      allocationTransactionId: transactionId,
      allocationTick,
    };
  if (index.status === "over-limit") return { status: "over-limit", identity };
  if (consistency !== "current")
    return { status: "superseded-in-frame", identity };
  return { status: "available", identity, index };
}

export class TelemetrySystem {
  phase = "telemetry";

  step(context) {
    if (context.powerNetwork)
      context.telemetry.power = context.powerNetwork.telemetry();
    if (context.signalNetwork)
      context.telemetry.signals = context.signalNetwork.telemetry();
    context.telemetry.commands ||= Object.freeze({
      ...context.commandBus.entries(),
      capabilities: Object.freeze(
        [...(context.commandCapabilities || [])].sort(),
      ),
    });
    const captured = context.services.captureTelemetry?.(context),
      systems = captured?.systems || captured || context.telemetry,
      finalTopologyFingerprint = fingerprintRuntimeTopology(context.runGraph),
      slots = {
        power: slotCandidate(
          context,
          context.powerNetwork?.evidenceIndex?.(),
          finalTopologyFingerprint,
        ),
        signal: slotCandidate(
          context,
          context.signalNetwork?.evidenceIndex?.(),
          finalTopologyFingerprint,
        ),
        resourceReachability: slotCandidate(
          context,
          context.materialResourceNetwork?.evidenceIndex?.(),
          finalTopologyFingerprint,
        ),
        resourceAllocation: slotCandidate(
          context,
          context.materialResourceNetwork?.allocationEvidenceIndex?.(),
          finalTopologyFingerprint,
          { allocation: true },
        ),
      };
    systems.routeEvidence = context.routeEvidenceArchive.commit({
      telemetryTick: context.clock.tick,
      slots,
    });
    context.telemetry = publishTelemetrySnapshot(context, systems);
  }
}
