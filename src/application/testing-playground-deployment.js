import { deepFreeze, stableStringify } from "../model/primitives.js";

const transformView = (part) => ({
  id: part.id,
  pos: [...part.pos],
  orientation: [...part.orientation],
});

/** Captures the exact stopped assembly placement associated with a staging pad. */
export function captureTestingPlaygroundDeployment({
  siteId,
  padId,
  pose = null,
  parts,
}) {
  return deepFreeze({
    siteId,
    padId,
    pose: pose ? structuredClone(pose) : null,
    partTransforms: parts
      .map(transformView)
      .sort((left, right) => left.id - right.id),
  });
}

/** Rejects a stale pad label when any part was subsequently moved or replaced. */
export function deploymentForBlueprint(deployment, blueprint) {
  if (!deployment || !blueprint?.parts) return null;
  const current = blueprint.parts
    .map(transformView)
    .sort((left, right) => left.id - right.id);
  return stableStringify(current) === stableStringify(deployment.partTransforms)
    ? deployment
    : null;
}
