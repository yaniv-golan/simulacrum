import {
  COORDINATE_CONSTRAINT_KINDS,
  requiresRotarySupport,
} from "./assembly-compiler-shared.js";
import { composeRigidBodyMassProperties } from "./assembly-compiler-mass-properties.js";
import {
  canonicalizeQuaternion,
  compareCanonicalIds,
  compareCompiledIds,
} from "./primitives.js";

const stablePartOrder = compareCanonicalIds;
const stableCompiledOrder = compareCompiledIds;

function stableLegacyStringOrder(left, right) {
  if (left === right) return 0;
  const collationOrder = left.localeCompare(right, "en-US");
  return collationOrder || (left < right ? -1 : 1);
}

function stableLegacyDefaultOrder(left, right) {
  const leftString = String(left),
    rightString = String(right);
  if (leftString !== rightString) return leftString < rightString ? -1 : 1;
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
  return 0;
}

function partIdentityKey(value) {
  return typeof value === "number"
    ? `number:${String(value)}`
    : `string:${String(value.length)}:${value}`;
}

function canonicalPair(a, b, identityTokenForPart = String) {
  const ordered = stablePartOrder(a, b) <= 0,
    first = ordered ? a : b,
    second = ordered ? b : a,
    key = JSON.stringify([partIdentityKey(first), partIdentityKey(second)]),
    firstProjection = identityTokenForPart(first),
    secondProjection = identityTokenForPart(second),
    projectionKey =
      firstProjection.includes(":") || secondProjection.includes(":")
        ? key
        : `${firstProjection}:${secondProjection}`;
  return {
    key,
    projectionKey,
    a: first,
    b: second,
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

function quaternionConjugate([x, y, z, w]) {
  return [-x, -y, -z, w];
}

function quaternionProduct(left, right) {
  const [lx, ly, lz, lw] = left,
    [rx, ry, rz, rw] = right;
  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz,
  ];
}

function rotateVector(quaternion, [x, y, z]) {
  return quaternionProduct(
    quaternionProduct(quaternion, [x, y, z, 0]),
    quaternionConjugate(quaternion),
  ).slice(0, 3);
}

function runtimeMassContributorKinds(body) {
  const capabilities = body.capabilities,
    pneumaticKind = capabilities?.pneumatic?.kind,
    kinds = [];
  if (capabilities?.materialStore) kinds.push("material-store-v1");
  if (capabilities?.aerothermal?.material?.ablative === true)
    kinds.push("ablative-material-v1");
  if (pneumaticKind === "tire-chamber-v1") kinds.push("tire-chamber-v1");
  if (pneumaticKind === "ideal-gas-control-volume-v1")
    kinds.push("ideal-gas-control-volume-v1");
  return kinds;
}

function attachmentInCluster(
  frame,
  partId,
  side,
  sourceConnectionId,
  memberByPart,
) {
  const member = memberByPart.get(partId),
    attachmentOffset = rotateVector(
      member.orientationCluster,
      frame.positionPartM,
    );
  return {
    partId,
    side,
    portId: frame.portId,
    sourceConnectionId,
    positionPartM: [...frame.positionPartM],
    orientationPart: [...frame.orientationPart],
    positionClusterM: member.positionClusterM.map(
      (value, index) => value + attachmentOffset[index],
    ),
    orientationCluster: canonicalizeQuaternion(
      quaternionProduct(member.orientationCluster, frame.orientationPart),
    ),
  };
}

/** @returns {import("./rigid-cluster-contract.js").RigidClusterCutTopologyV1} */
function rigidClusterCutTopology(
  rootPartId,
  memberPartIds,
  fixedConstraints,
  members,
) {
  const memberByPart = new Map(
    members.map((member) => [member.partId, member]),
  );
  const cycleRank = Math.max(
    0,
    fixedConstraints.length - memberPartIds.length + 1,
  );
  const fixedConstraintEdges = fixedConstraints
    .map((constraint) => ({
      constraintId: constraint.id,
      a: constraint.a,
      b: constraint.b,
      breakForceN: Number(constraint.breakForce ?? 0),
      breakTorqueNm: Number(constraint.breakTorque ?? 0),
    }))
    .sort((left, right) =>
      stableCompiledOrder(left.constraintId, right.constraintId),
    );
  if (memberPartIds.length === 1)
    return {
      kind: "singleton-v1",
      cycleRank: 0,
      fixedConstraintEdges,
      cuts: [],
    };
  if (cycleRank > 0)
    return {
      kind: "statically-indeterminate-loop-v1",
      cycleRank,
      fixedConstraintEdges,
      cuts: [],
    };

  const adjacency = new Map(memberPartIds.map((partId) => [partId, []]));
  for (const constraint of fixedConstraints) {
    adjacency.get(constraint.a).push({
      neighbor: constraint.b,
      constraint,
    });
    adjacency.get(constraint.b).push({
      neighbor: constraint.a,
      constraint,
    });
  }
  for (const entries of adjacency.values())
    entries.sort(
      (left, right) =>
        stableCompiledOrder(left.constraint.id, right.constraint.id) ||
        stablePartOrder(left.neighbor, right.neighbor),
    );

  const parentByPart = new Map([[rootPartId, null]]),
    parentConstraintByPart = new Map(),
    childrenByPart = new Map(memberPartIds.map((partId) => [partId, []])),
    queue = [rootPartId];
  while (queue.length) {
    const parent = queue.shift();
    for (const { neighbor, constraint } of adjacency.get(parent)) {
      if (parentByPart.has(neighbor)) continue;
      parentByPart.set(neighbor, parent);
      parentConstraintByPart.set(neighbor, constraint);
      childrenByPart.get(parent).push(neighbor);
      queue.push(neighbor);
    }
  }
  const descendants = (partId) => {
    const result = [],
      pending = [partId];
    while (pending.length) {
      const current = pending.pop();
      result.push(current);
      pending.push(...(childrenByPart.get(current) || []));
    }
    return result.sort(stablePartOrder);
  };
  const cuts = memberPartIds
    .filter((partId) => partId !== rootPartId)
    .map((childPartId) => {
      const constraint = parentConstraintByPart.get(childPartId),
        parentPartId = parentByPart.get(childPartId),
        parentSide = constraint.a === parentPartId ? "A" : "B",
        childSide = parentSide === "A" ? "B" : "A",
        sourceConnectionBySide = Object.fromEntries(
          (constraint.failureAttachments || []).map((attachment) => [
            attachment.side,
            attachment.connectionId,
          ]),
        );
      return {
        constraintId: constraint.id,
        parentPartId,
        childPartId,
        parentSide,
        childSide,
        subtreePartIds: descendants(childPartId),
        sourceConnectionIds: [...(constraint.sourceConnectionIds || [])],
        failureAttachments: structuredClone(
          constraint.failureAttachments || [],
        ),
        parentAttachmentFrame: attachmentInCluster(
          constraint[`attachmentFrame${parentSide}`],
          parentPartId,
          parentSide,
          sourceConnectionBySide[parentSide],
          memberByPart,
        ),
        childAttachmentFrame: attachmentInCluster(
          constraint[`attachmentFrame${childSide}`],
          childPartId,
          childSide,
          sourceConnectionBySide[childSide],
          memberByPart,
        ),
      };
    })
    .sort((left, right) =>
      stableCompiledOrder(left.constraintId, right.constraintId),
    );
  return {
    kind: "tree-newton-euler-cuts-v1",
    cycleRank: 0,
    fixedConstraintEdges,
    cuts,
  };
}

/** @returns {import("./rigid-cluster-contract.js").RigidClusterDescriptorV1[]} */
function rigidClusterDescriptors(context, topology) {
  const bodyByPart = new Map(context.bodies.map((body) => [body.partId, body])),
    visited = new Set(),
    descriptors =
      /** @type {import("./rigid-cluster-contract.js").RigidClusterDescriptorV1[]} */ ([]);
  for (const seed of [...bodyByPart.keys()].sort(stablePartOrder)) {
    if (visited.has(seed)) continue;
    const memberPartIds = [...rigidCluster(topology.neighbors, seed)]
        .filter((partId) => bodyByPart.has(partId))
        .sort(stablePartOrder),
      rootPartId = memberPartIds[0],
      rootBody = bodyByPart.get(rootPartId),
      inverseRootOrientation = quaternionConjugate(rootBody.orientation),
      memberSet = new Set(memberPartIds),
      fixedConstraints = context.constraints
        .filter(
          (constraint) =>
            constraint.kind === "fixed" &&
            memberSet.has(constraint.a) &&
            memberSet.has(constraint.b),
        )
        .sort((left, right) => stableCompiledOrder(left.id, right.id)),
      boundaryConstraints = context.constraints
        .filter(
          (constraint) =>
            constraint.kind !== "measurement" &&
            memberSet.has(constraint.a) !== memberSet.has(constraint.b),
        )
        .map((constraint) => {
          const aInside = memberSet.has(constraint.a);
          return {
            constraintId: constraint.id,
            kind: constraint.kind,
            insidePartId: aInside ? constraint.a : constraint.b,
            outsidePartId: aInside ? constraint.b : constraint.a,
          };
        })
        .sort((left, right) =>
          stableCompiledOrder(left.constraintId, right.constraintId),
        ),
      boundaryConstraintIds = boundaryConstraints.map(
        (constraint) => constraint.constraintId,
      ),
      members = memberPartIds.map((partId) => {
        const body = bodyByPart.get(partId),
          offsetWorld = body.position.map(
            (value, index) => value - rootBody.position[index],
          );
        return {
          partId,
          bodyId: body.id,
          // The root owns the cluster frame by definition. Emitting its exact
          // identity records avoids creating a duplicate near-identity owner
          // through inverse floating quaternion arithmetic.
          positionClusterM:
            partId === rootPartId
              ? [0, 0, 0]
              : rotateVector(inverseRootOrientation, offsetWorld),
          orientationCluster:
            partId === rootPartId
              ? [0, 0, 0, 1]
              : canonicalizeQuaternion(
                  quaternionProduct(inverseRootOrientation, body.orientation),
                ),
          massKg: body.mass,
          massPropertySourceBodyId: body.id,
          geometrySourceBodyId: body.id,
          runtimeMassContributorKinds: runtimeMassContributorKinds(body),
        };
      }),
      massProperties = composeRigidBodyMassProperties(
        members.map((member) => ({
          ...member,
          massProperties: bodyByPart.get(member.partId).massProperties,
        })),
      ),
      cutWrenchTopology = rigidClusterCutTopology(
        rootPartId,
        memberPartIds,
        fixedConstraints,
        members,
      );
    for (const partId of memberPartIds) visited.add(partId);
    descriptors.push({
      id: `rigid-cluster:${partIdentityKey(rootPartId)}`,
      kind: "fixed-rigid-cluster-v1",
      rootPartId,
      rootBodyId: rootBody.id,
      memberPartIds,
      memberBodyIds: members.map((member) => member.bodyId),
      members,
      fixedConstraintIds: fixedConstraints.map((constraint) => constraint.id),
      cutWrenchTopology,
      failureBoundaryConstraintIds: fixedConstraints
        .filter((constraint) => {
          const edge = cutWrenchTopology.fixedConstraintEdges.find(
            (candidate) => candidate.constraintId === constraint.id,
          );
          return edge.breakForceN > 0 || edge.breakTorqueNm > 0;
        })
        .map((constraint) => constraint.id),
      boundaryConstraints,
      boundaryConstraintIds,
      dynamicMassPartIds: members
        .filter((member) => member.runtimeMassContributorKinds.length > 0)
        .map((member) => member.partId),
      sourceMassKg: members.reduce((sum, member) => sum + member.massKg, 0),
      massProperties,
    });
  }
  return descriptors;
}

function exclusionCollector(identityTokenForPart) {
  const exclusionsByPair = new Map();
  return {
    add(a, b, kind, sourceConstraintIds, sourceConnectionIds) {
      if (a === b) return;
      const pair = canonicalPair(a, b, identityTokenForPart);
      if (!exclusionsByPair.has(pair.key))
        exclusionsByPair.set(pair.key, {
          id: `collision-exclusion:${pair.projectionKey}`,
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
          sourceConnectionIds: [...new Set(exclusion.sourceConnectionIds)].sort(
            stableLegacyDefaultOrder,
          ),
        }))
        .sort((left, right) => stableLegacyStringOrder(left.id, right.id));
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

function collisionExclusionsFor(constraints, identityTokenForPart) {
  const topology = fixedTopology(constraints),
    exclusions = exclusionCollector(identityTokenForPart);
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
  const fixed = fixedTopology(context.constraints);
  context.collisionExclusions = collisionExclusionsFor(
    context.constraints,
    context.partIdentityToken,
  );
  context.rigidClusters = rigidClusterDescriptors(context, fixed);
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
