import { TYPES } from "../model/component-catalog.js";
import {
  completeConnectionContract,
  isPhysicalConnectionKind,
} from "../model/connection-contracts.js";
import { validatePortConnection } from "../model/ports.js";

function transform(part) {
  return {
    ...part,
    pos: part.mesh.position.toArray(),
    orientation: [
      part.mesh.quaternion.x,
      part.mesh.quaternion.y,
      part.mesh.quaternion.z,
      part.mesh.quaternion.w,
    ],
  };
}

/** Clones, re-anchors, validates, and appends one editor connection atomically. */
export function appendClonedEditorConnection({
  connections,
  connection,
  left,
  right,
  operation,
}) {
  const physical = isPhysicalConnectionKind(connection.kind),
    capacity = physical ? connection.capacity : null,
    candidate = completeConnectionContract(
      {
        ...structuredClone(connection),
        id: `${connection.id}:${operation}:${connections.length}`,
        a: left.id,
        b: right.id,
      },
      transform(left),
      transform(right),
      { capacity },
    );
  try {
    validatePortConnection(
      left,
      candidate.portA,
      right,
      candidate.portB,
      connections,
      TYPES,
      candidate,
    );
    connections.push(candidate);
    return { ok: true, error: null, connection: candidate };
  } catch (error) {
    return { ok: false, error, connection: null };
  }
}
