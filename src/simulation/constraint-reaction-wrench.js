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

function normalizedRowKind(value) {
  const result = String(value || "equation")
    .replace(/Equation$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[^A-Za-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return result || "equation";
}

function bodyIdentity(body) {
  if (body?.userData?.partId != null)
    return `part:${String(body.userData.partId)}`;
  if (body?.userData?.externalBodyId != null)
    return String(body.userData.externalBodyId);
  return null;
}

function worldApplicationPoint(constraint, anchorFromCom, side) {
  const body = constraint[`body${side}`],
    position = body?.position;
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
  return localAnchor && body?.quaternion
    ? vectorComponents(body.quaternion.vmult(localAnchor))
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
  const ordinals = new Map();
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
        [...new Set(sourceConnectionIds || [])].map(String).sort(),
      ),
      sourceContactIds: Object.freeze(
        [...new Set(equation.simulacrumSourceContactIds || [])]
          .map(String)
          .sort(),
      ),
    });
  }
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
  if (side !== "A" && side !== "B")
    throw new RangeError(`Unknown constraint wrench side ${side}`);
  const suffix = side,
    records = [];
  for (const equation of constraint?.equations || []) {
    if (!equation.enabled) continue;
    const multiplier = Number(equation.multiplier || 0),
      jacobian = equation[`jacobianElement${suffix}`];
    if (!jacobian || !Number.isFinite(multiplier)) continue;
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
      row = equation.simulacrumEvidenceRow || {},
      rowKind = normalizedRowKind(
        row.rowKind || equation.constructor?.name || "equation",
      ),
      localOrdinal = Number.isSafeInteger(row.localOrdinal)
        ? row.localOrdinal
        : records.length,
      constraintId = row.constraintId ?? metadata.constraintId ?? null,
      tick = metadata.tick ?? null,
      rowId = row.rowIdPrefix
        ? `${row.rowIdPrefix}:${side}:${row.rowIdSuffix}`
        : row.rowId ||
          `constraint:${String(tick)}:${String(
            constraintId,
          )}:${side}:${rowKind}:${localOrdinal}`;
    records.push(
      Object.freeze({
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
        sourceConnectionIds: Object.freeze(
          [
            ...new Set(
              row.sourceConnectionIds || metadata.sourceConnectionIds || [],
            ),
          ]
            .map(String)
            .sort(),
        ),
        sourceContactIds: Object.freeze(
          [...new Set(row.sourceContactIds || metadata.sourceContactIds || [])]
            .map(String)
            .sort(),
        ),
        forceWorldN: Object.freeze(forceWorldN),
        momentAtApplicationPointWorldNm: Object.freeze({
          x: momentAtComNm.x - forceMomentAtCom.x,
          y: momentAtComNm.y - forceMomentAtCom.y,
          z: momentAtComNm.z - forceMomentAtCom.z,
        }),
        applicationPointWorldM: Object.freeze(
          worldApplicationPoint(constraint, anchorFromCom, side),
        ),
        forceMagnitudeN: magnitude(forceWorldN),
        momentMagnitudeNm: magnitude({
          x: momentAtComNm.x - forceMomentAtCom.x,
          y: momentAtComNm.y - forceMomentAtCom.y,
          z: momentAtComNm.z - forceMomentAtCom.z,
        }),
        multiplier,
        validity: "measured",
      }),
    );
  }
  return Object.freeze(records);
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
