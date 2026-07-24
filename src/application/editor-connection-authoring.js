import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "../model/connection-contracts.js";

function authoringTransform(part) {
  return {
    ...part,
    pos: part.mesh.position.toArray(),
    orientation: part.mesh.quaternion.toArray(),
    rotation: [
      part.mesh.rotation.x,
      part.mesh.rotation.y,
      part.mesh.rotation.z,
    ],
  };
}

/** Builds the current persistent DTO after presentation snapping completes. */
export function createEditorConnection({
  left,
  right,
  kind,
  sourcePort,
  targetPort,
  index,
  targetAnchorLocalM = null,
}) {
  const physical = kind === "mechanical" || kind === "mesh",
    capacity =
      kind === "mesh"
        ? CONNECTION_CAPACITIES.gear
        : CONNECTION_CAPACITIES.standard;
  return completeConnectionContract(
    {
      id: `${kind}:${Math.min(left.id, right.id)}:${Math.max(left.id, right.id)}:${index}`,
      a: left.id,
      b: right.id,
      kind,
      portA: sourcePort,
      portB: targetPort,
      ...(Array.isArray(targetAnchorLocalM)
        ? { anchorB: [...targetAnchorLocalM] }
        : {}),
    },
    authoringTransform(left),
    authoringTransform(right),
    { capacity: physical ? capacity : null },
  );
}
