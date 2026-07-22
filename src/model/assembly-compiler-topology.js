import {
  COORDINATE_CONSTRAINT_KINDS,
  requiresRotarySupport,
} from "./assembly-compiler-shared.js";

function canonicalPair(a, b) {
  const ordered =
    String(a).localeCompare(String(b), undefined, { numeric: true }) <= 0;
  return {
    key: ordered ? `${a}:${b}` : `${b}:${a}`,
    a: ordered ? a : b,
    b: ordered ? b : a,
  };
}

function fixedTopology(constraints) {
  const neighbors = new Map(),
    directPairs = new Set();
  const addNeighbor = (a, b) => {
    const values = neighbors.get(a) || new Set();
    values.add(b);
    neighbors.set(a, values);
  };
  for (const constraint of constraints.filter(
    (candidate) => candidate.kind === "fixed",
  )) {
    addNeighbor(constraint.a, constraint.b);
    addNeighbor(constraint.b, constraint.a);
    directPairs.add(canonicalPair(constraint.a, constraint.b).key);
  }
  return { neighbors, directPairs };
}

function rigidCluster(neighbors, root) {
  const cluster = new Set([root]),
    pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const neighbor of neighbors.get(current) || [])
      if (!cluster.has(neighbor)) {
        cluster.add(neighbor);
        pending.push(neighbor);
      }
  }
  return cluster;
}

function exclusionCollector() {
  const exclusionsByPair = new Map();
  return {
    add(a, b, kind, sourceConstraintIds, sourceConnectionIds) {
      if (a === b) return;
      const pair = canonicalPair(a, b);
      if (!exclusionsByPair.has(pair.key))
        exclusionsByPair.set(pair.key, {
          id: `collision-exclusion:${pair.key}`,
          kinds: [],
          a: pair.a,
          b: pair.b,
          sourceConstraintIds: [],
          sourceConnectionIds: [],
        });
      const exclusion = exclusionsByPair.get(pair.key);
      exclusion.kinds.push(kind);
      exclusion.sourceConstraintIds.push(...sourceConstraintIds);
      exclusion.sourceConnectionIds.push(...sourceConnectionIds);
    },
    finish() {
      return [...exclusionsByPair.values()]
        .map((exclusion) => ({
          ...exclusion,
          kinds: [...new Set(exclusion.kinds)].sort(),
          sourceConstraintIds: [
            ...new Set(exclusion.sourceConstraintIds),
          ].sort(),
          sourceConnectionIds: [
            ...new Set(exclusion.sourceConnectionIds),
          ].sort(),
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
    },
  };
}

function addRigidClusterExclusions(constraints, topology, exclusions) {
  const visitedBodies = new Set();
  for (const bodyId of topology.neighbors.keys()) {
    if (visitedBodies.has(bodyId)) continue;
    const cluster = [...rigidCluster(topology.neighbors, bodyId)];
    for (const member of cluster) visitedBodies.add(member);
    for (let left = 0; left < cluster.length; left++)
      for (let right = left + 1; right < cluster.length; right++) {
        const pair = canonicalPair(cluster[left], cluster[right]);
        if (topology.directPairs.has(pair.key)) continue;
        const supportingConstraints = constraints.filter(
          (candidate) =>
            candidate.kind === "fixed" &&
            cluster.includes(candidate.a) &&
            cluster.includes(candidate.b),
        );
        exclusions.add(
          pair.a,
          pair.b,
          "same-fixed-rigid-cluster-v1",
          supportingConstraints.map((candidate) => candidate.id),
          supportingConstraints.flatMap(
            (candidate) => candidate.sourceConnectionIds || [],
          ),
        );
      }
  }
}

function addCoordinateExclusions(constraints, topology, exclusions) {
  for (const coordinate of constraints.filter((candidate) =>
    COORDINATE_CONSTRAINT_KINDS.has(candidate.kind),
  )) {
    const leftCluster = rigidCluster(topology.neighbors, coordinate.a),
      rightCluster = rigidCluster(topology.neighbors, coordinate.b);
    for (const a of leftCluster)
      for (const b of rightCluster)
        exclusions.add(
          a,
          b,
          "adjacent-coordinate-rigid-clusters-v1",
          [coordinate.id],
          coordinate.sourceConnectionIds || [],
        );
  }
}

function collisionExclusionsFor(constraints) {
  const topology = fixedTopology(constraints),
    exclusions = exclusionCollector();
  addRigidClusterExclusions(constraints, topology, exclusions);
  addCoordinateExclusions(constraints, topology, exclusions);
  return exclusions.finish();
}

function validateDynamicMassTopology(context) {
  const dynamicPartIds = new Set(
    context.bodies
      .filter(
        (body) =>
          body.capabilities?.materialStore ||
          body.capabilities?.aerothermal?.material?.ablative === true,
      )
      .map((body) => body.partId),
  );
  for (const constraint of context.constraints) {
    if (constraint.kind === "fixed" || constraint.kind === "measurement")
      continue;
    const partId = [constraint.a, constraint.b].find((id) =>
      dynamicPartIds.has(id),
    );
    if (partId == null) continue;
    context.diagnostics.push({
      severity: "error",
      code: "DYNAMIC_MASS_CONSTRAINT_UNSUPPORTED",
      partId,
      message: `Dynamic-mass part #${String(partId)} cannot use ${constraint.kind} constraint ${String(constraint.id)}; v1 supports fixed attachments only.`,
    });
  }
}

export function compileTopology(context) {
  validateDynamicMassTopology(context);
  context.collisionExclusions = collisionExclusionsFor(context.constraints);
  const constrained = new Set(
    context.constraints
      .filter((constraint) => constraint.kind !== "measurement")
      .flatMap((constraint) => [constraint.a, constraint.b]),
  );
  for (const part of context.parts)
    if (
      requiresRotarySupport(part, context.catalog) &&
      !constrained.has(part.id)
    )
      context.diagnostics.push({
        severity: "warning",
        code: "UNSUPPORTED_ROTARY_PART",
        partId: part.id,
        message: `${part.type} #${part.id} has no physical support or drivetrain constraint.`,
      });
}
