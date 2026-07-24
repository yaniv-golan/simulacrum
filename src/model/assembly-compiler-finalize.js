const DIAGNOSTIC_REMEDIES = Object.freeze({
  DANGLING_CONNECTION: "Remove the connection or restore both endpoint parts.",
  INCOMPLETE_PHYSICAL_CONNECTION:
    "Choose explicit compatible endpoint ports and an attachment capacity.",
  INCOMPLETE_CONNECTOR:
    "Attach each authored endpoint port to one physical body.",
  INVALID_RELEASE_COUPLER_TOPOLOGY:
    "Attach each release flange to exactly one distinct physical body.",
  FORCE_ELEMENT_ENDPOINT_PORT_MISMATCH:
    "Reconnect the element using its declared A and B endpoint ports.",
  SELF_CONNECTOR: "Connect the two endpoints to different physical bodies.",
  MESH_REQUIRES_GEAR: "Use a component with explicit tooth geometry.",
  UNSUPPORTED_ROTARY_PART:
    "Add a physical support, bearing, hinge, or drivetrain constraint.",
  DYNAMIC_MASS_CONSTRAINT_UNSUPPORTED:
    "Attach tanks and ablative parts with fixed structural connections.",
});

/**
 * @param {ReturnType<import("./assembly-compiler-context.js").createCompilationContext>} context
 * @param {ReturnType<import("./assembly-compiler-context.js").createCompilationContext>["diagnostics"][number]} item
 */
function diagnosticRecord(context, item) {
  const connectionId = "connectionId" in item ? item.connectionId : undefined,
    partId = "partId" in item ? item.partId : undefined,
    connection = connectionId
      ? context.connections.find((candidate) => candidate.id === connectionId)
      : null,
    involvedDescriptorIds = [
      partId == null ? null : `part:${partId}`,
      connectionId == null ? null : `connection:${connectionId}`,
      connection ? `part:${connection.a}` : null,
      connection ? `part:${connection.b}` : null,
    ]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort();
  return Object.freeze({
    ...item,
    sourceProvenance: Object.freeze({
      owner: "assembly-compiler",
      authoredPath:
        partId != null
          ? Object.freeze(["parts", partId])
          : Object.freeze(["connections", connectionId]),
    }),
    involvedDescriptorIds: Object.freeze(involvedDescriptorIds),
    residualDetail:
      item.severity === "error"
        ? "Compilation stopped before solver rows were created."
        : "Topology compiled with this unresolved design warning.",
    remedy:
      DIAGNOSTIC_REMEDIES[item.code] ||
      "Inspect the cited authored descriptors and correct the physical topology.",
  });
}

/**
 * @param {ReturnType<import("./assembly-compiler-context.js").createCompilationContext>} context
 */
export function finalizeCompilation(context) {
  const diagnosticRecords = context.diagnostics.map((item) =>
      diagnosticRecord(context, item),
    ),
    hasFlexibleLines = context.flexibleLines.length > 0,
    flexibleMassKg = context.flexibleLines.reduce(
      (sum, line) => sum + line.totalMassKg,
      0,
    );
  return Object.freeze({
    version: 1,
    sourceRevision: context.snapshot?.revision || 0,
    parts: context.parts,
    bodies: context.bodies,
    constraints: context.constraints,
    collisionExclusions: context.collisionExclusions,
    forceElements: context.forceElements,
    ...(hasFlexibleLines ? { flexibleLines: context.flexibleLines } : {}),
    actuators: context.actuators,
    contactRegions: context.contactRegions,
    networks: context.networks,
    diagnostics: Object.freeze(diagnosticRecords),
    stats: Object.freeze({
      partCount: context.parts.length,
      bodyCount: context.bodies.length,
      constraintCount: context.constraints.length,
      collisionExclusionCount: context.collisionExclusions.length,
      forceElementPartCount: context.forceElementParts.size,
      ...(hasFlexibleLines
        ? {
            flexibleLinePartCount: context.flexibleLineParts.size,
            flexibleEntityCount: context.flexibleLines.reduce(
              (sum, line) => sum + line.entities.length,
              0,
            ),
          }
        : {}),
      errorCount: diagnosticRecords.filter((item) => item.severity === "error")
        .length,
      warningCount: diagnosticRecords.filter(
        (item) => item.severity === "warning",
      ).length,
      totalMass:
        context.bodies.reduce((sum, body) => sum + body.mass, 0) +
        flexibleMassKg,
    }),
  });
}
