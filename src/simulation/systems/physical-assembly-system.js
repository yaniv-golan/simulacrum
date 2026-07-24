import { DomainValidationError } from "../../model/primitives.js";

function refreshIndex(context) {
  const index = context.services.physicalAssemblyIndex,
    runtime = context.services.multibodyRuntime,
    flexible = context.services.flexibleLineRuntime;
  if (!runtime?.compiled) return null;
  if (!index)
    throw new DomainValidationError(
      "PHYSICAL_ASSEMBLY_INDEX_REQUIRED",
      "Compiled simulation requires one shared PhysicalAssemblyIndex service",
    );
  return index.refresh({
    runGraph: context.runGraph,
    constraintEntries: [
      ...(runtime.constraintEntries || []),
      ...(flexible?.edgeEntries || []),
      ...(flexible?.attachmentEntries || []),
    ],
    topologyRevision:
      (runtime.topologyRevision || 0) + (flexible?.topologyRevision || 0),
  });
}

/** Publishes the canonical physical-component identity after all mutations. */
export class PhysicalAssemblySystem {
  phase = "telemetry";

  initialize(context) {
    const snapshot = refreshIndex(context);
    if (!snapshot) return;
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.physicalAssembly = snapshot;
  }

  step(context) {
    const snapshot = refreshIndex(context);
    if (snapshot) context.telemetry.physicalAssembly = snapshot;
  }

  afterCheckpointRestore(context) {
    refreshIndex(context);
  }
}
