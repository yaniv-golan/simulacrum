import { registerOwnedImmutable } from "./owned-immutable-value.js";
import {
  compareCompiledIds,
  deepFreeze,
  stableStringify,
} from "./primitives.js";

/**
 * @template T
 * @param {T} left
 * @param {T} right
 * @returns {number}
 */
function canonicalRecordOrder(left, right) {
  const identityOrder = compareCompiledIds(
    /** @type {{id:string|number}} */ (left).id,
    /** @type {{id:string|number}} */ (right).id,
  );
  if (identityOrder) return identityOrder;
  const leftBytes = stableStringify(left),
    rightBytes = stableStringify(right);
  return leftBytes === rightBytes ? 0 : leftBytes < rightBytes ? -1 : 1;
}

/**
 * @template T
 * @param {T[]} records
 * @returns {T[]}
 */
function canonicalRecords(records) {
  return [...records].sort(canonicalRecordOrder);
}

const SOLVER_ORDER_CLASS_RANK = Object.freeze({
  "condensed-connector-v1": 0,
  "direct-connection-v1": 1,
});

/**
 * @param {unknown} record
 * @returns {Array<string | number>}
 */
function canonicalConstraintSourceIds(record) {
  const sourceConnectionIds =
    /** @type {{sourceConnectionIds?: Array<string | number>}} */ (record)
      .sourceConnectionIds ?? [];
  return [...sourceConnectionIds].sort(compareCompiledIds);
}

/**
 * @template T
 * @param {T[]} records
 * @returns {T[]}
 */
function canonicalConstraintRecords(records) {
  return [...records].sort((left, right) => {
    const leftClass = /** @type {{solverOrderClass?: string}} */ (left)
        .solverOrderClass,
      rightClass = /** @type {{solverOrderClass?: string}} */ (right)
        .solverOrderClass,
      leftRank = SOLVER_ORDER_CLASS_RANK[leftClass],
      rightRank = SOLVER_ORDER_CLASS_RANK[rightClass];
    if (leftRank == null || rightRank == null)
      throw new TypeError("Constraint is missing its solver-order class");
    // Compile stages explicitly own their generic finite-solver insertion
    // phase. Provenance cardinality is evidence, not a numerical class.
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftSources = canonicalConstraintSourceIds(left),
      rightSources = canonicalConstraintSourceIds(right),
      sharedLength = Math.min(leftSources.length, rightSources.length);
    // Within an explicit numerical class, authored source identity is the
    // canonical tie-breaker. This preserves one deterministic Gauss-Seidel
    // insertion sequence without inferring numerical policy from topology.
    for (let index = 0; index < sharedLength; index++) {
      const sourceOrder = compareCompiledIds(
        leftSources[index],
        rightSources[index],
      );
      if (sourceOrder) return sourceOrder;
    }
    if (leftSources.length !== rightSources.length)
      return leftSources.length - rightSources.length;
    return canonicalRecordOrder(left, right);
  });
}

/**
 * @template T
 * @param {T} networks
 * @returns {T}
 */
function canonicalNetworks(networks) {
  return /** @type {T} */ (
    Object.fromEntries(
      Object.entries(networks).map(([kind, records]) => [
        kind,
        canonicalRecords(records),
      ]),
    )
  );
}

const DIAGNOSTIC_REMEDIES = Object.freeze({
  SELF_CONNECTION: "Connect two distinct component endpoints.",
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
      partId == null ? null : context.partScopedId("part", partId),
      connectionId == null
        ? null
        : context.connectionScopedId("connection", connectionId),
      connection ? context.partScopedId("part", connection.a) : null,
      connection ? context.partScopedId("part", connection.b) : null,
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
  const compiled = {
    version: /** @type {1} */ (1),
    sourceRevision: context.snapshot?.revision || 0,
    // Authored array order is not a physical parameter. Every collection that
    // can drive runtime construction or per-tick iteration leaves the compiler
    // in one exact authority order, so the order-insensitive semantic
    // fingerprint and solver execution describe the same authority.
    parts: /** @type {any} */ (canonicalRecords(context.parts)),
    bodies: canonicalRecords(context.bodies),
    // Sequential solvers are sensitive to row insertion order. Preserve the
    // explicit condensed-connector/direct-connection conditioning classes and
    // canonical authored source identity within each class, so equivalent
    // authored arrays share one physical execution order.
    constraints: canonicalConstraintRecords(context.constraints),
    rigidClusters: canonicalRecords(context.rigidClusters),
    collisionExclusions: canonicalRecords(context.collisionExclusions),
    forceElements: canonicalRecords(context.forceElements),
    ...(hasFlexibleLines
      ? { flexibleLines: canonicalRecords(context.flexibleLines) }
      : {}),
    actuators: canonicalRecords(context.actuators),
    contactRegions: canonicalRecords(context.contactRegions),
    networks: canonicalNetworks(context.networks),
    diagnostics: Object.freeze(diagnosticRecords),
    stats: Object.freeze({
      partCount: context.parts.length,
      bodyCount: context.bodies.length,
      constraintCount: context.constraints.length,
      rigidClusterCount: context.rigidClusters.length,
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
  };
  deepFreeze(compiled);
  return registerOwnedImmutable(Object.freeze(compiled));
}
