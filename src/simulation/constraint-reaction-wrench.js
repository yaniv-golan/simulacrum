import {
  identitySetUsesTypedStrings,
  identityToken,
  scopedIdentity,
} from "../model/primitives.js";

function vectorComponents(value) {
  return {
    x: Number(value?.x || 0),
    y: Number(value?.y || 0),
    z: Number(value?.z || 0),
  };
}

function addScaled(target, value, scale) {
  target.x += Number(value?.x || 0) * scale;
  target.y += Number(value?.y || 0) * scale;
  target.z += Number(value?.z || 0) * scale;
}

function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function magnitude(value) {
  return Math.hypot(value.x, value.y, value.z);
}

const normalizedRowKinds = new Map();

function normalizedRowKind(value) {
  const source = String(value || "equation"),
    cached = normalizedRowKinds.get(source);
  if (cached) return cached;
  const result = source
      .replace(/Equation$/u, "")
      .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
      .replace(/[^A-Za-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase(),
    normalized = result || "equation";
  // Equation kinds come from a bounded set of engine/custom constraint
  // classes. Keep hostile or dynamically generated labels from growing a
  // process-lifetime cache without bound.
  if (normalizedRowKinds.size < 128) normalizedRowKinds.set(source, normalized);
  return normalized;
}

function bodyIdentity(body) {
  if (body?.userData?.partId != null)
    return scopedIdentity("part", body.userData.partId, {
      typedStrings: true,
    });
  if (body?.userData?.externalBodyId != null)
    return scopedIdentity("external-body", body.userData.externalBodyId, {
      typedStrings: true,
    });
  if (body?.userData?.compiledBodyId != null) {
    const compiledBodyId = String(body.userData.compiledBodyId);
    return compiledBodyId.startsWith("body:")
      ? `part:${compiledBodyId.slice("body:".length)}`
      : compiledBodyId;
  }
  return null;
}

function worldApplicationPoint(constraint, anchorFromCom, side) {
  const body = constraint[`body${side}`],
    position = body?.previousPosition || body?.position;
  return position
    ? {
        x: Number(position.x || 0) + anchorFromCom.x,
        y: Number(position.y || 0) + anchorFromCom.y,
        z: Number(position.z || 0) + anchorFromCom.z,
      }
    : { ...anchorFromCom };
}

function equationAnchorFromCom(constraint, equation, side) {
  const equationAnchor = side === "A" ? equation.ri : equation.rj;
  if (equationAnchor) return vectorComponents(equationAnchor);
  const suffix = side,
    body = constraint[`body${suffix}`],
    localAnchor =
      constraint[`pivot${suffix}`] || constraint[`localAnchor${suffix}`];
  const orientation = body?.previousQuaternion || body?.quaternion;
  return localAnchor && orientation
    ? vectorComponents(orientation.vmult(localAnchor))
    : { x: 0, y: 0, z: 0 };
}

/**
 * Assigns deterministic semantic metadata to the current equation set.
 * Dynamic constraints may replace their equations every tick, so callers
 * intentionally invoke this after Constraint.update().
 * @param {any} constraint
 * @param {{constraintId?:string|number|null,sourceConnectionIds?:Array<string|number>,tick?:number|null,source?:string}} [options]
 */
export function assignConstraintEvidenceRows(
  constraint,
  { constraintId, sourceConnectionIds = [], tick, source = "constraint" } = {},
) {
  const ordinals = new Map(),
    connectionIdsUseTypedStrings = identitySetUsesTypedStrings(
      sourceConnectionIds || [],
    );
  for (const equation of constraint?.equations || []) {
    const rowKind = normalizedRowKind(
        equation.simulacrumEvidenceRowKind ||
          equation.constructor?.name ||
          "equation",
      ),
      localOrdinal = ordinals.get(rowKind) || 0;
    ordinals.set(rowKind, localOrdinal + 1);
    const rowIdPrefix = `constraint:${String(tick)}:${String(constraintId)}`,
      rowIdSuffix = `${rowKind}:${localOrdinal}`;
    equation.simulacrumEvidenceRow = Object.freeze({
      // The production ledger currently records side A. Keep its directly
      // addressable ID on the equation for contact provenance while retaining
      // the two stable fragments needed when a caller solves side B.
      rowId: `${rowIdPrefix}:A:${rowIdSuffix}`,
      rowIdPrefix,
      rowIdSuffix,
      rowKind,
      localOrdinal,
      source: equation.simulacrumEvidenceSource || source,
      constraintId: constraintId ?? null,
      sourceConnectionIds: Object.freeze(
        [...new Set(sourceConnectionIds || [])]
          .map((identity) =>
            identityToken(identity, {
              typedStrings: connectionIdsUseTypedStrings,
            }),
          )
          .sort(),
      ),
      sourceContactIds: Object.freeze(
        [...new Set(equation.simulacrumSourceContactIds || [])]
          .map(String)
          .sort(),
      ),
    });
  }
}

function contributionTerms(constraint, equation, side) {
  const multiplier = Number(equation.multiplier || 0),
    jacobian = equation[`jacobianElement${side}`];
  if (!equation.enabled || !jacobian || !Number.isFinite(multiplier))
    return null;
  const spatial = vectorComponents(jacobian.spatial),
    rotational = vectorComponents(jacobian.rotational),
    anchorFromCom = equationAnchorFromCom(constraint, equation, side),
    forceWorldN = {
      x: spatial.x * multiplier,
      y: spatial.y * multiplier,
      z: spatial.z * multiplier,
    },
    momentAtComNm = {
      x: rotational.x * multiplier,
      y: rotational.y * multiplier,
      z: rotational.z * multiplier,
    },
    forceMomentAtCom = cross(anchorFromCom, forceWorldN),
    momentAtApplicationPointWorldNm = {
      x: momentAtComNm.x - forceMomentAtCom.x,
      y: momentAtComNm.y - forceMomentAtCom.y,
      z: momentAtComNm.z - forceMomentAtCom.z,
    };
  return {
    multiplier,
    anchorFromCom,
    forceWorldN,
    momentAtApplicationPointWorldNm,
    forceMagnitudeN: magnitude(forceWorldN),
    momentMagnitudeNm: magnitude(momentAtApplicationPointWorldNm),
  };
}

function termsAtApplicationPoint(constraint, side, terms, applicationPoint) {
  if (!terms || !applicationPoint) return terms;
  const solvedPoint = worldApplicationPoint(
      constraint,
      terms.anchorFromCom,
      side,
    ),
    target = vectorComponents(applicationPoint),
    referenceToTarget = {
      x: solvedPoint.x - target.x,
      y: solvedPoint.y - target.y,
      z: solvedPoint.z - target.z,
    },
    translatedMoment = cross(referenceToTarget, terms.forceWorldN);
  addScaled(translatedMoment, terms.momentAtApplicationPointWorldNm, 1);
  return {
    ...terms,
    momentAtApplicationPointWorldNm: translatedMoment,
    momentMagnitudeNm: magnitude(translatedMoment),
    applicationPointWorldM: target,
  };
}

function contributionMagnitudes(constraint, equation, side) {
  const multiplier = Number(equation.multiplier || 0),
    jacobian = equation[`jacobianElement${side}`];
  if (!equation.enabled || !jacobian || !Number.isFinite(multiplier))
    return null;
  const spatial = jacobian.spatial,
    rotational = jacobian.rotational,
    equationAnchor = side === "A" ? equation.ri : equation.rj,
    anchor =
      equationAnchor || equationAnchorFromCom(constraint, equation, side),
    forceX = Number(spatial?.x || 0) * multiplier,
    forceY = Number(spatial?.y || 0) * multiplier,
    forceZ = Number(spatial?.z || 0) * multiplier,
    anchorX = Number(anchor?.x || 0),
    anchorY = Number(anchor?.y || 0),
    anchorZ = Number(anchor?.z || 0),
    momentX =
      Number(rotational?.x || 0) * multiplier -
      (anchorY * forceZ - anchorZ * forceY),
    momentY =
      Number(rotational?.y || 0) * multiplier -
      (anchorZ * forceX - anchorX * forceZ),
    momentZ =
      Number(rotational?.z || 0) * multiplier -
      (anchorX * forceY - anchorY * forceX);
  return {
    forceMagnitudeN: Math.hypot(forceX, forceY, forceZ),
    momentMagnitudeNm: Math.hypot(momentX, momentY, momentZ),
  };
}

function contributionCandidate(
  constraint,
  equation,
  side,
  metadata,
  metadataSourceConnectionIds,
  fallbackOrdinal,
  terms,
) {
  const row = equation.simulacrumEvidenceRow || {},
    rowKind =
      row.rowKind ||
      normalizedRowKind(equation.constructor?.name || "equation"),
    localOrdinal = Number.isSafeInteger(row.localOrdinal)
      ? row.localOrdinal
      : fallbackOrdinal,
    constraintId = row.constraintId ?? metadata.constraintId ?? null,
    tick = metadata.tick ?? null,
    rowId = row.rowIdPrefix
      ? `${row.rowIdPrefix}:${side}:${row.rowIdSuffix}`
      : row.rowId || null,
    firstSeparator = rowId?.indexOf(":") ?? -1,
    secondSeparator =
      firstSeparator >= 0 ? rowId.indexOf(":", firstSeparator + 1) : -1,
    rowOrderKey =
      secondSeparator >= 0
        ? `${rowId.slice(0, firstSeparator)}${rowId.slice(secondSeparator)}`
        : `constraint:${String(
            constraintId,
          )}:${side}:${rowKind}:${localOrdinal}`;
  return {
    constraint,
    equation,
    side,
    metadata,
    tick,
    rowId,
    rowOrderKey,
    rowKind,
    localOrdinal,
    constraintId,
    sourceConnectionIds: Object.hasOwn(metadata, "sourceConnectionIds")
      ? metadataSourceConnectionIds
      : row.sourceConnectionIds || metadataSourceConnectionIds,
    forceMagnitudeN: terms.forceMagnitudeN,
    momentMagnitudeNm: terms.momentMagnitudeNm,
  };
}

function normalizedConnectionIds(values) {
  if (
    Object.isFrozen(values) &&
    values.every((value) => typeof value === "string")
  )
    return values;
  return [...new Set(values || [])].map(String).sort();
}

/** Resolves the exact tick-addressable ID only for a retained candidate. */
export function constraintReactionCandidateRowId(candidate) {
  return (
    candidate.rowId ||
    `constraint:${String(candidate.tick)}:${String(
      candidate.constraintId,
    )}:${candidate.side}:${candidate.rowKind}:${candidate.localOrdinal}`
  );
}

/** True when a retained solved-row candidate would materialize non-finite evidence. */
export function invalidConstraintReactionCandidate(candidate) {
  const side = candidate?.side || "A",
    position = candidate?.constraint?.[`body${side}`]?.position,
    finitePosition =
      !position || [position.x, position.y, position.z].every(Number.isFinite);
  return (
    !Number.isFinite(candidate?.forceMagnitudeN) ||
    !Number.isFinite(candidate?.momentMagnitudeNm) ||
    !finitePosition
  );
}

/** Lightweight solved-row descriptors used for bounded evidence selection. */
export function constraintReactionContributionCandidates(
  constraint,
  side = "A",
  metadata = {},
) {
  if (side !== "A" && side !== "B")
    throw new RangeError(`Unknown constraint wrench side ${side}`);
  const candidates = [],
    metadataSourceConnectionIds = normalizedConnectionIds(
      metadata.sourceConnectionIds || [],
    );
  for (const equation of constraint?.equations || []) {
    const terms = metadata.applicationPointWorldM
      ? termsAtApplicationPoint(
          constraint,
          side,
          contributionTerms(constraint, equation, side),
          metadata.applicationPointWorldM,
        )
      : contributionMagnitudes(constraint, equation, side);
    if (!terms) continue;
    candidates.push(
      contributionCandidate(
        constraint,
        equation,
        side,
        metadata,
        metadataSourceConnectionIds,
        candidates.length,
        terms,
      ),
    );
  }
  return candidates;
}

/** Computes the aggregate wrench and evidence magnitudes in one solved-row pass. */
export function constraintReactionWrenchEvidence(
  constraint,
  side = "A",
  metadata = {},
) {
  if (side !== "A" && side !== "B")
    throw new RangeError(`Unknown constraint wrench side ${side}`);
  const force = { x: 0, y: 0, z: 0 },
    moment = { x: 0, y: 0, z: 0 },
    candidates = [],
    metadataSourceConnectionIds = normalizedConnectionIds(
      metadata.sourceConnectionIds || [],
    );
  for (const equation of constraint?.equations || []) {
    const unshifted = contributionTerms(constraint, equation, side);
    if (!unshifted) continue;
    const terms = termsAtApplicationPoint(
      constraint,
      side,
      unshifted,
      metadata.applicationPointWorldM,
    );
    force.x += terms.forceWorldN.x;
    force.y += terms.forceWorldN.y;
    force.z += terms.forceWorldN.z;
    moment.x += terms.momentAtApplicationPointWorldNm.x;
    moment.y += terms.momentAtApplicationPointWorldNm.y;
    moment.z += terms.momentAtApplicationPointWorldNm.z;
    candidates.push(
      contributionCandidate(
        constraint,
        equation,
        side,
        metadata,
        metadataSourceConnectionIds,
        candidates.length,
        terms,
      ),
    );
  }
  return {
    wrench: Object.freeze({
      force: Object.freeze(force),
      moment: Object.freeze(moment),
      forceN: magnitude(force),
      torqueNm: magnitude(moment),
    }),
    candidates,
  };
}

/** Finds a non-finite solved row without constructing contribution DTOs. */
export function invalidConstraintReactionContributionCandidate(
  constraint,
  side = "A",
  metadata = {},
) {
  for (const [index, equation] of (constraint?.equations || []).entries()) {
    const terms = contributionMagnitudes(constraint, equation, side);
    if (
      terms &&
      (!Number.isFinite(terms.forceMagnitudeN) ||
        !Number.isFinite(terms.momentMagnitudeNm))
    )
      return {
        rowId:
          equation.simulacrumEvidenceRow?.rowId ||
          `constraint:${String(metadata.tick ?? null)}:${String(
            metadata.constraintId ?? null,
          )}:${side}:equation:${index}`,
        ...terms,
      };
  }
  return null;
}

/** Materializes one selected solved-row contribution. */
export function materializeConstraintReactionContribution(
  candidate,
  freeze = true,
) {
  const {
      constraint,
      equation,
      side,
      metadata,
      tick,
      rowId: candidateRowId,
      rowKind,
      localOrdinal,
      constraintId,
      sourceConnectionIds,
    } = candidate,
    suffix = side,
    row = equation.simulacrumEvidenceRow || {},
    terms = termsAtApplicationPoint(
      constraint,
      side,
      contributionTerms(constraint, equation, side),
      metadata.applicationPointWorldM,
    ),
    sourceContactIds =
      row.sourceContactIds ??
      equation.simulacrumEvidenceSourceContactIds?.() ??
      equation.simulacrumSourceContactIds ??
      metadata.sourceContactIds ??
      [];
  if (!terms) return null;
  const rowId = candidateRowId || constraintReactionCandidateRowId(candidate);
  const contribution = {
    tick,
    rowId,
    rowKind,
    localOrdinal,
    source: row.source || metadata.source || "constraint",
    side,
    bodyId: metadata.bodyId ?? bodyIdentity(constraint[`body${suffix}`]),
    otherBodyId:
      metadata.otherBodyId ??
      bodyIdentity(constraint[`body${side === "A" ? "B" : "A"}`]),
    constraintId,
    sourceConnectionIds: [...sourceConnectionIds],
    sourceContactIds: [...new Set(sourceContactIds)].map(String).sort(),
    forceWorldN: terms.forceWorldN,
    momentAtApplicationPointWorldNm: terms.momentAtApplicationPointWorldNm,
    applicationPointWorldM:
      terms.applicationPointWorldM ||
      worldApplicationPoint(constraint, terms.anchorFromCom, side),
    forceMagnitudeN: terms.forceMagnitudeN,
    momentMagnitudeNm: terms.momentMagnitudeNm,
    multiplier: terms.multiplier,
    validity: "measured",
  };
  if (!freeze) return contribution;
  Object.freeze(contribution.sourceConnectionIds);
  Object.freeze(contribution.sourceContactIds);
  Object.freeze(contribution.forceWorldN);
  Object.freeze(contribution.momentAtApplicationPointWorldNm);
  Object.freeze(contribution.applicationPointWorldM);
  return Object.freeze(contribution);
}

/**
 * Returns the signed solved contribution of every usable equation row.
 * Summing these records yields the same wrench as constraintReactionWrench().
 */
export function constraintReactionContributions(
  constraint,
  side = "A",
  metadata = {},
) {
  return Object.freeze(
    constraintReactionContributionCandidates(constraint, side, metadata)
      .map((candidate) => materializeConstraintReactionContribution(candidate))
      .filter(Boolean),
  );
}

/**
 * Reconstructs the signed wrench applied by a solved Cannon constraint.
 *
 * Equation multipliers act through each equation's complete Jacobian. The
 * rotational Jacobian includes both a genuine constraint moment and the
 * moment made by a force about the body's centre of mass. Each equation can
 * act at a different point, so translating every row back to its own anchor
 * avoids counting the same load as both force and torque. The constraint-level
 * pivot/local anchor is only a fallback for synthetic or custom equations that
 * do not publish their solved world-space `ri`/`rj` offset.
 */
export function constraintReactionWrench(constraint, side = "A") {
  if (side !== "A" && side !== "B")
    throw new RangeError(`Unknown constraint wrench side ${side}`);
  const suffix = side,
    force = { x: 0, y: 0, z: 0 },
    moment = { x: 0, y: 0, z: 0 };
  for (const equation of constraint.equations || []) {
    if (!equation.enabled) continue;
    const multiplier = Number(equation.multiplier || 0),
      jacobian = equation[`jacobianElement${suffix}`];
    if (!jacobian || !Number.isFinite(multiplier)) continue;
    const rowForce = vectorComponents(jacobian.spatial),
      rowMomentAtCom = vectorComponents(jacobian.rotational),
      anchorFromCom = equationAnchorFromCom(constraint, equation, side),
      forceMomentAtCom = cross(anchorFromCom, rowForce);
    addScaled(force, rowForce, multiplier);
    addScaled(
      moment,
      {
        x: rowMomentAtCom.x - forceMomentAtCom.x,
        y: rowMomentAtCom.y - forceMomentAtCom.y,
        z: rowMomentAtCom.z - forceMomentAtCom.z,
      },
      multiplier,
    );
  }
  return Object.freeze({
    force: Object.freeze(force),
    moment: Object.freeze(moment),
    forceN: magnitude(force),
    torqueNm: magnitude(moment),
  });
}
