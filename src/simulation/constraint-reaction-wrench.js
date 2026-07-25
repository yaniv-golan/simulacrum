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
