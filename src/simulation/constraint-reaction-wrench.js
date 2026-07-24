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

/**
 * Reconstructs the signed wrench applied by a solved Cannon constraint.
 *
 * Equation multipliers act through each equation's complete Jacobian. The
 * rotational Jacobian includes both a genuine constraint moment and the
 * moment made by a pivot force about the body's centre of mass. Translating
 * that result back to the constraint anchor avoids counting the same load as
 * both force and torque.
 */
export function constraintReactionWrench(constraint, side = "A") {
  if (side !== "A" && side !== "B")
    throw new RangeError(`Unknown constraint wrench side ${side}`);
  const suffix = side,
    body = constraint[`body${suffix}`],
    pivot = constraint[`pivot${suffix}`],
    force = { x: 0, y: 0, z: 0 },
    momentAtCom = { x: 0, y: 0, z: 0 };
  for (const equation of constraint.equations || []) {
    if (!equation.enabled) continue;
    const multiplier = Number(equation.multiplier || 0),
      jacobian = equation[`jacobianElement${suffix}`];
    if (!jacobian || !Number.isFinite(multiplier)) continue;
    addScaled(force, jacobian.spatial, multiplier);
    addScaled(momentAtCom, jacobian.rotational, multiplier);
  }
  const anchorFromCom = pivot
      ? vectorComponents(body.quaternion.vmult(pivot))
      : { x: 0, y: 0, z: 0 },
    forceMomentAtCom = cross(anchorFromCom, force),
    moment = {
      x: momentAtCom.x - forceMomentAtCom.x,
      y: momentAtCom.y - forceMomentAtCom.y,
      z: momentAtCom.z - forceMomentAtCom.z,
    };
  return Object.freeze({
    force: Object.freeze(force),
    moment: Object.freeze(moment),
    forceN: magnitude(force),
    torqueNm: magnitude(moment),
  });
}
