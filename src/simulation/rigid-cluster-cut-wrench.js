import { validatePhysicalInertiaTensor } from "../model/physical-inertia-validation.js";
import { composeRigidBodyMassProperties } from "../model/assembly-compiler-mass-properties.js";
import { isCompilerOwnedRigidCluster } from "../model/assembly-compiler.js";
import { requireInertPlainData } from "../model/plain-data-contract.js";
import { compareCompiledIds } from "../model/primitives.js";

const stableIdOrder = compareCompiledIds;
const RUNTIME_MASS_CONTRIBUTOR_KINDS = Object.freeze([
  "material-store-v1",
  "ablative-material-v1",
  "tire-chamber-v1",
  "ideal-gas-control-volume-v1",
]);
const CUT_WRENCH_PLAIN_DATA_CODE = "INVALID_RIGID_CLUSTER_CUT_PLAIN_DATA";

function finiteVector(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite three-vector`);
  return value;
}

function finiteMatrix(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(
      (row) =>
        Array.isArray(row) && row.length === 3 && row.every(Number.isFinite),
    )
  )
    throw new TypeError(`${label} must be a finite 3x3 matrix`);
  return value;
}

/** @returns {[number, number, number, number]} */
function finiteQuaternion(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite quaternion`);
  if (Math.abs(Math.hypot(...value) - 1) > 1e-10)
    throw new RangeError(`${label} must be unit length`);
  return /** @type {[number, number, number, number]} */ (value);
}

const add = (left, right) => left.map((value, index) => value + right[index]);
const subtract = (left, right) =>
  left.map((value, index) => value - right[index]);
const scale = (value, factor) => value.map((component) => component * factor);

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function matrixVector(matrix, vector) {
  return matrix.map((row) =>
    row.reduce((sum, value, index) => sum + value * vector[index], 0),
  );
}

function rotateByQuaternion([x, y, z, w], vector) {
  const quaternionVector = [x, y, z],
    firstCross = cross(quaternionVector, vector),
    secondCross = cross(quaternionVector, firstCross);
  return add(vector, add(scale(firstCross, 2 * w), scale(secondCross, 2)));
}

function exactVectorsEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every(Number.isFinite) &&
    right.every(Number.isFinite) &&
    left.every((value, index) => value === right[index])
  );
}

const exactScalarEqual = (left, right) =>
  Number.isFinite(left) && Number.isFinite(right) && left === right;

const magnitude = (value) => Math.hypot(...value);

function memberRecord(member) {
  const massKg = member?.massKg,
    inertiaTensorWorldKgM2 = finiteMatrix(
      member.inertiaTensorWorldKgM2,
      `member ${String(member.partId)} inertia`,
    );
  if (typeof massKg !== "number" || !(massKg > 0) || !Number.isFinite(massKg))
    throw new RangeError(`member ${String(member?.partId)} has invalid mass`);
  validatePhysicalInertiaTensor(
    inertiaTensorWorldKgM2,
    `member ${String(member.partId)} inertia`,
  );
  return {
    partId: member.partId,
    massKg,
    comPositionWorldM: finiteVector(
      member.comPositionWorldM,
      `member ${String(member.partId)} COM`,
    ),
    linearAccelerationWorldMps2: finiteVector(
      member.linearAccelerationWorldMps2,
      `member ${String(member.partId)} linear acceleration`,
    ),
    angularVelocityWorldRadS: finiteVector(
      member.angularVelocityWorldRadS,
      `member ${String(member.partId)} angular velocity`,
    ),
    angularAccelerationWorldRadS2: finiteVector(
      member.angularAccelerationWorldRadS2,
      `member ${String(member.partId)} angular acceleration`,
    ),
    inertiaTensorWorldKgM2,
  };
}

function externalRecord(wrench) {
  if (
    !wrench ||
    !Object.hasOwn(wrench, "loadId") ||
    !Object.hasOwn(wrench, "partId") ||
    !Object.hasOwn(wrench, "forceWorldN") ||
    !Object.hasOwn(wrench, "applicationPointWorldM") ||
    !Object.hasOwn(wrench, "coupleWorldNm") ||
    !(
      (typeof wrench.loadId === "string" && wrench.loadId.length > 0) ||
      (typeof wrench.loadId === "number" && Number.isSafeInteger(wrench.loadId))
    )
  )
    throw new TypeError(
      "external wrench requires an explicit canonical load identity, application point, and couple",
    );
  const forceWorldN = finiteVector(
      wrench.forceWorldN,
      `external wrench ${String(wrench.loadId)} force`,
    ),
    applicationPointWorldM = finiteVector(
      wrench.applicationPointWorldM,
      `external wrench ${String(wrench.loadId)} application point`,
    ),
    coupleWorldNm = finiteVector(
      wrench.coupleWorldNm,
      `external wrench ${String(wrench.loadId)} couple`,
    );
  return {
    loadId: wrench.loadId,
    partId: wrench.partId,
    forceWorldN,
    applicationPointWorldM,
    coupleWorldNm,
  };
}

function canonicalWrenchOrder(left, right) {
  const identityOrder = stableIdOrder(left.loadId, right.loadId);
  if (identityOrder) return identityOrder;
  const leftJson = JSON.stringify(left),
    rightJson = JSON.stringify(right);
  return leftJson === rightJson ? 0 : leftJson < rightJson ? -1 : 1;
}

function sumVectors(values) {
  return values.reduce((sum, value) => add(sum, value), [0, 0, 0]);
}

function cutTopologyState(topology) {
  if (!topology || !Array.isArray(topology.cuts)) return "unknown";
  if (
    !Array.isArray(topology.fixedConstraintEdges) ||
    topology.fixedConstraintEdges.some(
      (edge) =>
        !edge ||
        !isNonemptyString(edge.constraintId) ||
        !isCanonicalIdentity(edge.a) ||
        !isCanonicalIdentity(edge.b) ||
        edge.a === edge.b ||
        typeof edge.breakForceN !== "number" ||
        !Number.isFinite(edge.breakForceN) ||
        edge.breakForceN < 0 ||
        typeof edge.breakTorqueNm !== "number" ||
        !Number.isFinite(edge.breakTorqueNm) ||
        edge.breakTorqueNm < 0,
    ) ||
    new Set(topology.fixedConstraintEdges.map((edge) => edge.constraintId))
      .size !== topology.fixedConstraintEdges.length
  )
    return "invalid";
  if (topology.kind === "singleton-v1")
    return topology.cycleRank === 0 &&
      topology.fixedConstraintEdges.length === 0 &&
      topology.cuts.length === 0
      ? "singleton"
      : "invalid";
  if (topology.kind === "statically-indeterminate-loop-v1")
    return Number.isSafeInteger(topology.cycleRank) &&
      topology.cycleRank > 0 &&
      topology.cuts.length === 0
      ? "loop"
      : "invalid";
  if (topology.kind === "tree-newton-euler-cuts-v1")
    return topology.cycleRank === 0 ? "tree" : "invalid";
  return "unknown";
}

function sameIdentitySet(left, right) {
  return (
    left.size === right.size &&
    [...left].every((identity) => right.has(identity))
  );
}

function isCanonicalIdentity(value) {
  return (
    (typeof value === "number" && Number.isSafeInteger(value)) ||
    (typeof value === "string" && value.length > 0 && value.length <= 160)
  );
}

function isNonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isFiniteThreeVector(value) {
  return (
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
  );
}

function isUnitQuaternion(value) {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(Number.isFinite) &&
    Math.abs(Math.hypot(...value) - 1) <= 1e-10
  );
}

function validAttachmentFrame(frame, partId, side, member = null) {
  const structurallyValid = Boolean(
    frame &&
    typeof frame === "object" &&
    frame.partId === partId &&
    frame.side === side &&
    isNonemptyString(frame.portId) &&
    isCanonicalIdentity(frame.sourceConnectionId) &&
    isFiniteThreeVector(frame.positionPartM) &&
    isUnitQuaternion(frame.orientationPart) &&
    isFiniteThreeVector(frame.positionClusterM) &&
    isUnitQuaternion(frame.orientationCluster),
  );
  // A compiler-owned attachment frame is the single physical frame record.
  // Recomputing it from duplicated member fields would create a second
  // floating authority and force either tolerance-based equality or false
  // rejection of an algebraically equivalent compiler result.
  void member;
  return structurallyValid;
}

function validCutProvenance(cut) {
  if (
    !Array.isArray(cut.sourceConnectionIds) ||
    cut.sourceConnectionIds.length === 0 ||
    cut.sourceConnectionIds.length > 2 ||
    cut.sourceConnectionIds.some(
      (identity) => !isCanonicalIdentity(identity),
    ) ||
    new Set(cut.sourceConnectionIds).size !== cut.sourceConnectionIds.length ||
    !Array.isArray(cut.failureAttachments) ||
    cut.failureAttachments.length !== 2
  )
    return false;
  const attachmentFrameBySide = {
      [cut.parentAttachmentFrame?.side]: cut.parentAttachmentFrame,
      [cut.childAttachmentFrame?.side]: cut.childAttachmentFrame,
    },
    sourceConnectionBySide = {
      A: attachmentFrameBySide.A?.sourceConnectionId,
      B: attachmentFrameBySide.B?.sourceConnectionId,
    },
    expectedSourceConnectionIds =
      sourceConnectionBySide.A === sourceConnectionBySide.B
        ? [sourceConnectionBySide.A]
        : [sourceConnectionBySide.A, sourceConnectionBySide.B],
    sourceConnectionSet = new Set(cut.sourceConnectionIds),
    sidesBySource = new Map(
      cut.sourceConnectionIds.map((connectionId) => [connectionId, new Set()]),
    ),
    occupiedSides = new Set();
  if (
    cut.sourceConnectionIds.length !== expectedSourceConnectionIds.length ||
    cut.sourceConnectionIds.some(
      (connectionId, index) =>
        connectionId !== expectedSourceConnectionIds[index],
    ) ||
    !cut.failureAttachments.every((attachment) => {
      if (
        !attachment ||
        !isCanonicalIdentity(attachment.connectionId) ||
        !sourceConnectionSet.has(attachment.connectionId) ||
        !["A", "B"].includes(attachment.side) ||
        attachment.connectionId !== sourceConnectionBySide[attachment.side] ||
        occupiedSides.has(attachment.side)
      )
        return false;
      const expectedPartId =
        attachment.side === cut.parentSide
          ? cut.parentPartId
          : attachment.side === cut.childSide
            ? cut.childPartId
            : null;
      occupiedSides.add(attachment.side);
      sidesBySource.get(attachment.connectionId).add(attachment.side);
      return expectedPartId != null && attachment.bodyPartId === expectedPartId;
    })
  )
    return false;
  return (
    occupiedSides.size === 2 &&
    cut.sourceConnectionIds.every(
      (connectionId) => sidesBySource.get(connectionId).size > 0,
    )
  );
}

function validClusterDescriptorAuthority(clusterDescriptor) {
  if (!isCompilerOwnedRigidCluster(clusterDescriptor)) return false;
  const memberPartIds = clusterDescriptor?.memberPartIds,
    memberBodyIds = clusterDescriptor?.memberBodyIds,
    members = clusterDescriptor?.members,
    fixedConstraintIds = clusterDescriptor?.fixedConstraintIds,
    failureBoundaryConstraintIds =
      clusterDescriptor?.failureBoundaryConstraintIds,
    boundaryConstraints = clusterDescriptor?.boundaryConstraints,
    boundaryConstraintIds = clusterDescriptor?.boundaryConstraintIds,
    dynamicMassPartIds = clusterDescriptor?.dynamicMassPartIds;
  if (
    !Array.isArray(memberPartIds) ||
    !Array.isArray(memberBodyIds) ||
    !Array.isArray(members) ||
    !Array.isArray(fixedConstraintIds) ||
    !Array.isArray(failureBoundaryConstraintIds) ||
    !Array.isArray(boundaryConstraints) ||
    !Array.isArray(boundaryConstraintIds) ||
    !Array.isArray(dynamicMassPartIds) ||
    memberPartIds.length === 0 ||
    memberBodyIds.length !== memberPartIds.length ||
    members.length !== memberPartIds.length ||
    memberPartIds.some((identity) => !isCanonicalIdentity(identity)) ||
    new Set(memberPartIds).size !== memberPartIds.length ||
    memberBodyIds.some((identity) => !isNonemptyString(identity)) ||
    new Set(memberBodyIds).size !== memberBodyIds.length ||
    fixedConstraintIds.some((identity) => !isNonemptyString(identity)) ||
    new Set(fixedConstraintIds).size !== fixedConstraintIds.length ||
    failureBoundaryConstraintIds.some(
      (identity) => !isNonemptyString(identity),
    ) ||
    new Set(failureBoundaryConstraintIds).size !==
      failureBoundaryConstraintIds.length ||
    boundaryConstraintIds.some((identity) => !isNonemptyString(identity)) ||
    new Set(boundaryConstraintIds).size !== boundaryConstraintIds.length ||
    dynamicMassPartIds.some((identity) => !isCanonicalIdentity(identity)) ||
    new Set(dynamicMassPartIds).size !== dynamicMassPartIds.length
  )
    return false;
  const memberByPart = new Map();
  for (let index = 0; index < members.length; index++) {
    const member = members[index];
    if (
      !member ||
      !isCanonicalIdentity(member.partId) ||
      memberByPart.has(member.partId) ||
      !isNonemptyString(member.bodyId) ||
      member.massPropertySourceBodyId !== member.bodyId ||
      member.geometrySourceBodyId !== member.bodyId ||
      typeof member.massKg !== "number" ||
      !Number.isFinite(member.massKg) ||
      member.massKg <= 0 ||
      !isFiniteThreeVector(member.positionClusterM) ||
      !isUnitQuaternion(member.orientationCluster) ||
      !Array.isArray(member.runtimeMassContributorKinds) ||
      new Set(member.runtimeMassContributorKinds).size !==
        member.runtimeMassContributorKinds.length ||
      member.runtimeMassContributorKinds.some(
        (kind) => !RUNTIME_MASS_CONTRIBUTOR_KINDS.includes(kind),
      ) ||
      member.runtimeMassContributorKinds.some(
        (kind, kindIndex) =>
          kindIndex > 0 &&
          RUNTIME_MASS_CONTRIBUTOR_KINDS.indexOf(
            member.runtimeMassContributorKinds[kindIndex - 1],
          ) >= RUNTIME_MASS_CONTRIBUTOR_KINDS.indexOf(kind),
      )
    )
      return false;
    if (
      member.partId !== memberPartIds[index] ||
      member.bodyId !== memberBodyIds[index]
    )
      return false;
    memberByPart.set(member.partId, member);
  }
  const rootMember = memberByPart.get(clusterDescriptor.rootPartId),
    partIdentityKey = (value) =>
      typeof value === "number"
        ? `number:${String(value)}`
        : `string:${String(value.length)}:${value}`,
    isStrictlyOrdered = (values, comparator) =>
      values.every(
        (value, index) =>
          index === 0 || comparator(values[index - 1], value) < 0,
      ),
    fixedConstraintSet = new Set(fixedConstraintIds),
    memberSet = new Set(memberPartIds),
    fixedConstraintEdges =
      clusterDescriptor.cutWrenchTopology?.fixedConstraintEdges,
    expectedFixedConstraintIds = Array.isArray(fixedConstraintEdges)
      ? fixedConstraintEdges.map((edge) => edge.constraintId)
      : [],
    expectedFailureBoundaryConstraintIds = Array.isArray(fixedConstraintEdges)
      ? fixedConstraintEdges
          .filter((edge) => edge.breakForceN > 0 || edge.breakTorqueNm > 0)
          .map((edge) => edge.constraintId)
      : [],
    expectedBoundaryConstraintIds = boundaryConstraints.map(
      (constraint) => constraint?.constraintId,
    ),
    expectedDynamicMassPartIds = members
      .filter((member) => member.runtimeMassContributorKinds.length > 0)
      .map((member) => member.partId),
    sameOrderedValues = (left, right) =>
      left.length === right.length &&
      left.every((value, index) => value === right[index]);
  if (
    !rootMember ||
    rootMember.bodyId !== clusterDescriptor.rootBodyId ||
    clusterDescriptor.id !==
      `rigid-cluster:${partIdentityKey(clusterDescriptor.rootPartId)}` ||
    !exactVectorsEqual(rootMember.positionClusterM, [0, 0, 0]) ||
    !exactVectorsEqual(rootMember.orientationCluster, [0, 0, 0, 1]) ||
    !isStrictlyOrdered(memberPartIds, compareCompiledIds) ||
    !isStrictlyOrdered(fixedConstraintIds, compareCompiledIds) ||
    !isStrictlyOrdered(failureBoundaryConstraintIds, compareCompiledIds) ||
    !isStrictlyOrdered(boundaryConstraintIds, compareCompiledIds) ||
    !isStrictlyOrdered(dynamicMassPartIds, compareCompiledIds) ||
    !sameOrderedValues(fixedConstraintIds, expectedFixedConstraintIds) ||
    !sameOrderedValues(
      failureBoundaryConstraintIds,
      expectedFailureBoundaryConstraintIds,
    ) ||
    !sameOrderedValues(boundaryConstraintIds, expectedBoundaryConstraintIds) ||
    !sameOrderedValues(dynamicMassPartIds, expectedDynamicMassPartIds) ||
    boundaryConstraints.some(
      (constraint, index) =>
        !constraint ||
        !isNonemptyString(constraint.constraintId) ||
        (index > 0 &&
          (!isNonemptyString(boundaryConstraints[index - 1]?.constraintId) ||
            compareCompiledIds(
              boundaryConstraints[index - 1].constraintId,
              constraint.constraintId,
            ) >= 0)) ||
        typeof constraint.kind !== "string" ||
        !constraint.kind ||
        constraint.kind === "measurement" ||
        !isCanonicalIdentity(constraint.insidePartId) ||
        !memberSet.has(constraint.insidePartId) ||
        !isCanonicalIdentity(constraint.outsidePartId) ||
        memberSet.has(constraint.outsidePartId) ||
        fixedConstraintSet.has(constraint.constraintId),
    )
  )
    return false;
  const sourceMassKg = members.reduce((sum, member) => sum + member.massKg, 0),
    massProperties = clusterDescriptor.massProperties,
    memberMassPropertySources = massProperties?.memberMassPropertySources;
  if (
    !exactScalarEqual(clusterDescriptor.sourceMassKg, sourceMassKg) ||
    !Array.isArray(memberMassPropertySources) ||
    memberMassPropertySources.length !== members.length ||
    memberMassPropertySources.some((source, index) => {
      const member = members[index];
      return (
        !source ||
        source.bodyId !== member.bodyId ||
        !exactVectorsEqual(source.positionClusterM, member.positionClusterM) ||
        !exactVectorsEqual(
          source.orientationCluster,
          member.orientationCluster,
        ) ||
        !exactScalarEqual(source.massProperties?.massKg, member.massKg)
      );
    })
  )
    return false;
  try {
    const recomposedMassProperties = composeRigidBodyMassProperties(
      memberMassPropertySources,
    );
    if (
      JSON.stringify(recomposedMassProperties) !==
      JSON.stringify(massProperties)
    )
      return false;
  } catch {
    return false;
  }
  return true;
}

function exactTopologyState(
  topology,
  memberPartIds,
  {
    cutFrameIds = null,
    expectedRootPartId = null,
    expectedFixedConstraintIds = null,
    memberAuthorityByPart = null,
  } = {},
) {
  const metadataState = cutTopologyState(topology);
  if (metadataState === "unknown" || metadataState === "invalid")
    return metadataState;
  if (!Array.isArray(memberPartIds) || memberPartIds.length === 0)
    return "invalid";
  const memberSet = new Set(memberPartIds);
  if (memberSet.size !== memberPartIds.length) return "invalid";
  const topologyFixedSet = new Set(
      topology.fixedConstraintEdges.map((edge) => edge.constraintId),
    ),
    edgeById = new Map(
      topology.fixedConstraintEdges.map((edge) => [edge.constraintId, edge]),
    ),
    frameIds = cutFrameIds == null ? null : [...cutFrameIds],
    frameSet = frameIds == null ? null : new Set(frameIds),
    fixedIds = Array.isArray(expectedFixedConstraintIds)
      ? [...expectedFixedConstraintIds]
      : expectedFixedConstraintIds == null
        ? null
        : false,
    fixedSet = Array.isArray(fixedIds) ? new Set(fixedIds) : null;
  if (frameIds && frameSet.size !== frameIds.length) return "invalid";
  if (fixedIds === false) return "invalid";
  if (
    fixedIds &&
    (fixedSet.size !== fixedIds.length ||
      fixedIds.some((identity) => !isNonemptyString(identity)))
  )
    return "invalid";
  if (fixedSet && !sameIdentitySet(fixedSet, topologyFixedSet))
    return "invalid";
  const topologyNeighbors = new Map(
    memberPartIds.map((partId) => [partId, new Set()]),
  );
  for (const edge of topology.fixedConstraintEdges) {
    if (!memberSet.has(edge.a) || !memberSet.has(edge.b)) return "invalid";
    topologyNeighbors.get(edge.a).add(edge.b);
    topologyNeighbors.get(edge.b).add(edge.a);
  }
  const reachable = new Set([memberPartIds[0]]),
    pending = [memberPartIds[0]];
  while (pending.length) {
    const current = pending.pop();
    for (const neighbor of topologyNeighbors.get(current))
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        pending.push(neighbor);
      }
  }
  const exactCycleRank =
    topology.fixedConstraintEdges.length - memberSet.size + 1;
  if (
    reachable.size !== memberSet.size ||
    exactCycleRank !== topology.cycleRank
  )
    return "invalid";
  if (
    expectedRootPartId != null &&
    (!memberSet.has(expectedRootPartId) ||
      [...memberSet].sort(stableIdOrder)[0] !== expectedRootPartId)
  )
    return "invalid";

  if (metadataState === "singleton")
    return memberSet.size === 1 &&
      (!frameSet || frameSet.size === 0) &&
      topologyFixedSet.size === 0
      ? "singleton"
      : "invalid";
  if (metadataState === "loop")
    return memberSet.size >= 2 &&
      (!frameSet || frameSet.size === 0) &&
      topologyFixedSet.size === memberSet.size - 1 + topology.cycleRank
      ? "loop"
      : "invalid";
  if (memberSet.size < 2 || topology.cuts.length !== memberSet.size - 1)
    return "invalid";

  const cutIds = new Set(),
    childIds = new Set(),
    childrenByPart = new Map(
      memberPartIds.map((partId) => [partId, new Set()]),
    ),
    cutByChild = new Map();
  for (const cut of topology.cuts) {
    if (
      !cut ||
      cut.constraintId == null ||
      !isNonemptyString(cut.constraintId) ||
      cutIds.has(cut.constraintId) ||
      !edgeById.has(cut.constraintId) ||
      cut.parentPartId === cut.childPartId ||
      !memberSet.has(cut.parentPartId) ||
      !memberSet.has(cut.childPartId) ||
      childIds.has(cut.childPartId) ||
      !Array.isArray(cut.subtreePartIds) ||
      !["A", "B"].includes(cut.parentSide) ||
      !["A", "B"].includes(cut.childSide) ||
      cut.parentSide === cut.childSide ||
      !validCutProvenance(cut) ||
      !validAttachmentFrame(
        cut.parentAttachmentFrame,
        cut.parentPartId,
        cut.parentSide,
        memberAuthorityByPart?.get(cut.parentPartId),
      ) ||
      !validAttachmentFrame(
        cut.childAttachmentFrame,
        cut.childPartId,
        cut.childSide,
        memberAuthorityByPart?.get(cut.childPartId),
      ) ||
      !(
        (edgeById.get(cut.constraintId).a === cut.parentPartId &&
          edgeById.get(cut.constraintId).b === cut.childPartId) ||
        (edgeById.get(cut.constraintId).a === cut.childPartId &&
          edgeById.get(cut.constraintId).b === cut.parentPartId)
      )
    )
      return "invalid";
    cutIds.add(cut.constraintId);
    childIds.add(cut.childPartId);
    childrenByPart.get(cut.parentPartId).add(cut.childPartId);
    cutByChild.set(cut.childPartId, cut);
  }
  if (frameSet && !sameIdentitySet(frameSet, cutIds)) return "invalid";
  if (!sameIdentitySet(topologyFixedSet, cutIds)) return "invalid";

  const roots = memberPartIds.filter((partId) => !childIds.has(partId));
  if (
    roots.length !== 1 ||
    (expectedRootPartId != null && roots[0] !== expectedRootPartId)
  )
    return "invalid";
  const visited = new Set(),
    active = new Set();
  const visit = (partId) => {
    if (active.has(partId)) return false;
    if (visited.has(partId)) return true;
    active.add(partId);
    for (const childId of childrenByPart.get(partId))
      if (!visit(childId)) return false;
    active.delete(partId);
    visited.add(partId);
    return true;
  };
  if (!visit(roots[0]) || visited.size !== memberSet.size) return "invalid";

  const descendants = (partId) => {
    const result = new Set(),
      pending = [partId];
    while (pending.length) {
      const current = pending.pop();
      if (result.has(current)) return null;
      result.add(current);
      pending.push(...childrenByPart.get(current));
    }
    return result;
  };
  for (const [childId, cut] of cutByChild) {
    const authored = new Set(cut.subtreePartIds),
      expected = descendants(childId);
    if (
      authored.size !== cut.subtreePartIds.length ||
      !expected ||
      !sameIdentitySet(authored, expected)
    )
      return "invalid";
  }
  return "tree";
}

/**
 * Resolves each unique tree cut at the authored child-side attachment. The
 * child frame is the boundary of the reported child subtree, so the resulting
 * Newton-Euler wrench has an unambiguous parent-on-child sign convention.
 * @param {import("../model/rigid-cluster-contract.js").RigidClusterDescriptorV1} clusterDescriptor
 * @param {import("../model/rigid-cluster-contract.js").RigidClusterRootPoseV1} rootPose
 * @returns {import("../model/rigid-cluster-contract.js").RigidClusterCutFrameWorldV1[]}
 */
function cutFramesWorldForInertPose(clusterDescriptor, rootPose) {
  // WeakSet identity is the only check that can reject an untrusted descriptor
  // (including a Proxy) without reading any caller-controlled property.
  if (!isCompilerOwnedRigidCluster(clusterDescriptor))
    throw new RangeError("cluster has contradictory member authority");
  if (clusterDescriptor.kind !== "fixed-rigid-cluster-v1")
    throw new TypeError(
      "cut frames require a fixed-rigid-cluster-v1 descriptor",
    );
  if (!validClusterDescriptorAuthority(clusterDescriptor))
    throw new RangeError("cluster has contradictory member authority");
  const { positionWorldM, orientationWorld } = rootPose;
  const topologyState = exactTopologyState(
    clusterDescriptor.cutWrenchTopology,
    clusterDescriptor.memberPartIds,
    {
      expectedRootPartId: clusterDescriptor.rootPartId,
      expectedFixedConstraintIds: clusterDescriptor.fixedConstraintIds,
      memberAuthorityByPart: new Map(
        clusterDescriptor.members.map((member) => [member.partId, member]),
      ),
    },
  );
  if (topologyState === "unknown")
    throw new TypeError("cluster has an unknown cut-wrench topology");
  if (topologyState === "invalid")
    throw new RangeError("cluster has contradictory cut-wrench topology");
  const rootPosition = finiteVector(positionWorldM, "cluster root position"),
    rootOrientation = finiteQuaternion(
      orientationWorld,
      "cluster root orientation",
    );
  return [...clusterDescriptor.cutWrenchTopology.cuts]
    .sort((left, right) => stableIdOrder(left.constraintId, right.constraintId))
    .map((cut) => {
      const positionWorldM = add(
        rootPosition,
        rotateByQuaternion(
          rootOrientation,
          finiteVector(
            cut.childAttachmentFrame.positionClusterM,
            `cut ${String(cut.constraintId)} child attachment`,
          ),
        ),
      );
      return {
        constraintId: cut.constraintId,
        positionWorldM: [
          ...finiteVector(
            positionWorldM,
            `cut ${String(cut.constraintId)} world frame`,
          ),
        ],
        source: "authored-child-attachment-v1",
      };
    });
}

/**
 * @param {import("../model/rigid-cluster-contract.js").RigidClusterDescriptorV1} clusterDescriptor
 * @param {string} rootPose
 * @returns {import("../model/rigid-cluster-contract.js").RigidClusterCutFrameWorldV1[]}
 */
export function rigidClusterCutFramesWorld(clusterDescriptor, rootPose) {
  const inertRootPose =
    /** @type {import("../model/rigid-cluster-contract.js").RigidClusterRootPoseV1} */ (
      /** @type {unknown} */ (
        requireInertPlainData(rootPose, {
          code: CUT_WRENCH_PLAIN_DATA_CODE,
          message:
            "Rigid-cluster root pose must be serialized JSON or an exported immutable data root",
          path: ["rootPose"],
        })
      )
    );
  return cutFramesWorldForInertPose(clusterDescriptor, inertRootPose);
}

/**
 * Reconstructs the wrench exerted by each parent side on its child subtree.
 *
 * For every unique tree cut, Newton-Euler balance gives
 *   F_cut = sum(m a) - sum(F_external)
 * and the equivalent moment balance about the authored cut point. Internal
 * subtree forces cancel, so this oracle is independent of solver rows and
 * constraint multipliers. Loops deliberately return unavailable because a
 * unique internal load split does not follow from rigid-body balance alone.
 * The caller-supplied load set cannot prove that every real external load was
 * observed. Therefore a computed result is explicitly conditional and cannot
 * be consumed as structural-failure authority.
 * @param {import("../model/rigid-cluster-contract.js").RigidClusterDescriptorV1} clusterDescriptor
 * @param {string} input
 * @returns {import("../model/rigid-cluster-contract.js").RigidClusterCutWrenchResultV1}
 */
export function reconstructTreeCutWrenches(clusterDescriptor, input) {
  const detachedInput =
    /** @type {{rootPose:import("../model/rigid-cluster-contract.js").RigidClusterRootPoseV1,members:import("../model/rigid-cluster-contract.js").RigidClusterMemberStateV1[],externalWrenches:import("../model/rigid-cluster-contract.js").RigidClusterExternalWrenchV1[],gravityWorldMps2:number[]}} */ (
      /** @type {unknown} */ (
        requireInertPlainData(input, {
          code: CUT_WRENCH_PLAIN_DATA_CODE,
          message:
            "Cut-wrench state must be serialized JSON or an exported immutable data root",
          path: ["input"],
        })
      )
    );
  if (
    !detachedInput ||
    typeof detachedInput !== "object" ||
    Array.isArray(detachedInput)
  )
    throw new TypeError("cut-wrench reconstruction requires a plain input");
  if (Object.hasOwn(detachedInput, "cutFrames"))
    throw new TypeError(
      "cut-wrench reconstruction derives authored frames from the cluster descriptor",
    );
  const { rootPose, members, externalWrenches, gravityWorldMps2 } =
    detachedInput;
  if (!isCompilerOwnedRigidCluster(clusterDescriptor))
    return {
      available: false,
      reason: "invalid-cut-topology-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    };
  const cutWrenchTopology = clusterDescriptor.cutWrenchTopology;
  if (
    clusterDescriptor.kind !== "fixed-rigid-cluster-v1" ||
    !validClusterDescriptorAuthority(clusterDescriptor)
  )
    return {
      available: false,
      reason: "invalid-cut-topology-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    };
  const validatedRootPose = {
    positionWorldM: [
      ...finiteVector(rootPose?.positionWorldM, "cluster root position"),
    ],
    orientationWorld: [
      ...finiteQuaternion(
        rootPose?.orientationWorld,
        "cluster root orientation",
      ),
    ],
  };
  const metadataState = cutTopologyState(cutWrenchTopology);
  if (metadataState === "invalid")
    return {
      available: false,
      reason: "invalid-cut-topology-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    };
  if (metadataState === "unknown")
    throw new TypeError(
      "cut-wrench topology must be a tree, loop, or singleton",
    );

  const memberByPart = new Map();
  for (const source of members || []) {
    const member = memberRecord(source);
    if (memberByPart.has(member.partId))
      throw new TypeError(`duplicate member state ${String(member.partId)}`);
    memberByPart.set(member.partId, member);
  }
  const descriptorMemberSet = new Set(clusterDescriptor.memberPartIds);
  if (
    memberByPart.size !== descriptorMemberSet.size ||
    [...memberByPart.keys()].some((partId) => !descriptorMemberSet.has(partId))
  )
    return {
      available: false,
      reason: "invalid-cut-topology-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    };
  const topologyState = exactTopologyState(
    cutWrenchTopology,
    [...memberByPart.keys()],
    {
      expectedRootPartId: clusterDescriptor.rootPartId,
      expectedFixedConstraintIds: clusterDescriptor.fixedConstraintIds,
      memberAuthorityByPart: new Map(
        clusterDescriptor.members.map((member) => [member.partId, member]),
      ),
    },
  );
  if (topologyState === "invalid")
    return {
      available: false,
      reason: "invalid-cut-topology-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    };
  if (topologyState === "loop")
    return {
      available: false,
      reason: "statically-indeterminate-loop-v1",
      authority: "unavailable-v1",
      failureAuthority: false,
      wrenches: [],
    };
  if (
    !Object.hasOwn(detachedInput, "externalWrenches") ||
    !Array.isArray(externalWrenches)
  )
    throw new TypeError(
      "cut-wrench reconstruction requires an explicit external load set",
    );
  if (!Object.hasOwn(detachedInput, "gravityWorldMps2"))
    throw new TypeError(
      "cut-wrench reconstruction requires an explicit gravity vector",
    );
  const gravity = finiteVector(gravityWorldMps2, "gravity");

  const sourceCutFrames = cutFramesWorldForInertPose(
      clusterDescriptor,
      validatedRootPose,
    ),
    cutFrameByConstraint = new Map(
      sourceCutFrames.map((frame) => [
        frame.constraintId,
        finiteVector(
          frame.positionWorldM,
          `cut ${String(frame.constraintId)} frame`,
        ),
      ]),
    );

  const resolvedExternal = externalWrenches
      .map((wrench) => {
        const member = memberByPart.get(wrench.partId);
        if (!member)
          throw new RangeError(
            `external wrench references unknown member ${String(wrench.partId)}`,
          );
        return externalRecord(wrench);
      })
      .sort(canonicalWrenchOrder),
    externalLoadIds = resolvedExternal.map((wrench) => wrench.loadId);
  if (new Set(externalLoadIds).size !== externalLoadIds.length)
    throw new TypeError("external load identities must be unique");
  const suppliedLoadSet = {
    gravityWorldMps2: [...gravity],
    externalWrenches: resolvedExternal.map((wrench) => ({
      loadId: wrench.loadId,
      partId: wrench.partId,
      forceWorldN: [...wrench.forceWorldN],
      applicationPointWorldM: [...wrench.applicationPointWorldM],
      coupleWorldNm: [...wrench.coupleWorldNm],
    })),
  };
  if (topologyState === "singleton")
    return {
      available: true,
      reason: null,
      authority: "conditional-supplied-load-set-v1",
      failureAuthority: false,
      suppliedLoadSet,
      wrenches: [],
    };

  const seenCuts = new Set(),
    wrenches = [...cutWrenchTopology.cuts]
      .sort((left, right) =>
        stableIdOrder(left.constraintId, right.constraintId),
      )
      .map((cut) => {
        if (seenCuts.has(cut.constraintId))
          throw new TypeError(
            `duplicate topology cut ${String(cut.constraintId)}`,
          );
        seenCuts.add(cut.constraintId);
        const cutPoint = cutFrameByConstraint.get(cut.constraintId);
        if (!cutPoint)
          throw new RangeError(`missing cut frame ${String(cut.constraintId)}`);
        const subtreeSet = new Set(cut.subtreePartIds);
        if (subtreeSet.size !== cut.subtreePartIds.length)
          throw new TypeError(
            `cut ${String(cut.constraintId)} repeats a subtree member`,
          );
        if (
          !subtreeSet.has(cut.childPartId) ||
          subtreeSet.has(cut.parentPartId)
        )
          throw new RangeError(
            `cut ${String(cut.constraintId)} has an invalid parent/child partition`,
          );
        const subtreePartIds = [...subtreeSet].sort(stableIdOrder),
          subtree = subtreePartIds.map((partId) => {
            const member = memberByPart.get(partId);
            if (!member)
              throw new RangeError(
                `cut ${String(cut.constraintId)} lacks member ${String(partId)}`,
              );
            return member;
          }),
          external = resolvedExternal.filter((wrench) =>
            subtreeSet.has(wrench.partId),
          ),
          inertialForces = subtree.map((member) =>
            scale(member.linearAccelerationWorldMps2, member.massKg),
          ),
          inertialForceWorldN = sumVectors(inertialForces),
          gravityForces = subtree.map((member) => ({
            partId: member.partId,
            forceWorldN: scale(gravity, member.massKg),
            applicationPointWorldM: member.comPositionWorldM,
            coupleWorldNm: [0, 0, 0],
          })),
          allExternal = [...gravityForces, ...external],
          externalForceWorldN = sumVectors(
            allExternal.map((wrench) => wrench.forceWorldN),
          ),
          inertialTorqueWorldNm = sumVectors(
            subtree.map((member, index) => {
              const angularMomentum = matrixVector(
                  member.inertiaTensorWorldKgM2,
                  member.angularVelocityWorldRadS,
                ),
                rotational = add(
                  matrixVector(
                    member.inertiaTensorWorldKgM2,
                    member.angularAccelerationWorldRadS2,
                  ),
                  cross(member.angularVelocityWorldRadS, angularMomentum),
                ),
                momentArm = subtract(member.comPositionWorldM, cutPoint);
              return add(rotational, cross(momentArm, inertialForces[index]));
            }),
          ),
          externalTorqueWorldNm = sumVectors(
            allExternal.map((wrench) =>
              add(
                wrench.coupleWorldNm,
                cross(
                  subtract(wrench.applicationPointWorldM, cutPoint),
                  wrench.forceWorldN,
                ),
              ),
            ),
          ),
          forceWorldN = subtract(inertialForceWorldN, externalForceWorldN),
          torqueWorldNm = subtract(
            inertialTorqueWorldNm,
            externalTorqueWorldNm,
          ),
          finiteResults = [
            [inertialForceWorldN, "inertial force"],
            [externalForceWorldN, "external force"],
            [inertialTorqueWorldNm, "inertial torque"],
            [externalTorqueWorldNm, "external torque"],
            [forceWorldN, "cut force"],
            [torqueWorldNm, "cut torque"],
          ];
        for (const [value, label] of finiteResults)
          finiteVector(
            value,
            `cut ${String(cut.constraintId)} ${String(label)}`,
          );
        const forceMagnitudeN = magnitude(forceWorldN),
          torqueMagnitudeNm = magnitude(torqueWorldNm);
        if (
          !Number.isFinite(forceMagnitudeN) ||
          !Number.isFinite(torqueMagnitudeNm)
        )
          throw new RangeError(
            `cut ${String(cut.constraintId)} wrench magnitude is not finite`,
          );
        return {
          constraintId: cut.constraintId,
          parentPartId: cut.parentPartId,
          childPartId: cut.childPartId,
          subtreePartIds,
          applicationPointWorldM: [...cutPoint],
          forceWorldN,
          torqueWorldNm,
          forceMagnitudeN,
          torqueMagnitudeNm,
          balance: {
            inertialForceWorldN,
            externalForceWorldN,
            inertialTorqueWorldNm,
            externalTorqueWorldNm,
          },
        };
      });
  return {
    available: true,
    reason: null,
    authority: "conditional-supplied-load-set-v1",
    failureAuthority: false,
    suppliedLoadSet,
    wrenches,
  };
}
