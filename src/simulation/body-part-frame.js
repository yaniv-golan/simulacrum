/**
 * Converts Cannon's principal-inertia body frame back to the authored part
 * frame compiled into `body.userData.massFrame`.
 *
 * Callers provide reusable targets so fixed-step systems do not allocate.
 */
export function writePartToWorldQuaternion(body, target, inverseTarget) {
  const massFrame = body.userData?.massFrame;
  if (!massFrame)
    throw new Error("Physics body is missing its compiled part mass frame");
  massFrame.principalToPart.conjugate(inverseTarget);
  body.quaternion.mult(inverseTarget, target);
  return target;
}

/** Writes the authored part origin in world coordinates. */
export function writePartWorldPosition(
  body,
  partToWorld,
  target,
  offsetTarget,
) {
  const massFrame = body.userData?.massFrame;
  if (!massFrame)
    throw new Error("Physics body is missing its compiled part mass frame");
  partToWorld.vmult(massFrame.comPart, offsetTarget);
  body.position.vsub(offsetTarget, target);
  return target;
}
