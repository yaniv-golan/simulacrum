import { portDefinition, portsCompatible } from "../model/ports.js";
import { componentHasControlContract } from "../model/component-contracts.js";

const hasRollingContact = (part) =>
  Boolean(part?.mechanism?.config?.tireConstitutiveLaw);

function transmitsRotation(connection, byId) {
  if (connection.failed) return false;
  const left = byId.get(connection.a),
    right = byId.get(connection.b);
  if (!left || !right || left.detached || right.detached) return false;
  if (
    !["mechanical", "mesh"].includes(connection.kind) ||
    !connection.portA ||
    !connection.portB
  )
    return false;
  try {
    const leftPort = portDefinition(left, connection.portA),
      rightPort = portDefinition(right, connection.portB);
    if (!portsCompatible(left, connection.portA, right, connection.portB))
      return false;
    if (connection.kind === "mesh")
      return leftPort.behavior === "gear" && rightPort.behavior === "gear";
    const transmitting = new Set(["rotary-coupling", "rotary-actuator-output"]);
    return (
      transmitting.has(leftPort.behavior) &&
      transmitting.has(rightPort.behavior)
    );
  } catch {
    return false;
  }
}

/** Returns motors whose rotating mechanical component contains a wheel. */
export function wheelDriveMotorIds(parts, connections) {
  const byId = new Map(parts.map((part) => [part.id, part])),
    adjacency = new Map(parts.map((part) => [part.id, []]));
  for (const connection of connections) {
    if (!transmitsRotation(connection, byId)) continue;
    adjacency.get(connection.a).push(connection.b);
    adjacency.get(connection.b).push(connection.a);
  }
  const wheelIds = new Set(
      parts
        .filter((part) => hasRollingContact(part) && !part.detached)
        .map((part) => part.id),
    ),
    result = new Set();
  for (const motor of parts.filter(
    (part) =>
      componentHasControlContract(part, "rotary-drive-v1") && !part.detached,
  )) {
    const visited = new Set([motor.id]),
      queue = [motor.id];
    while (queue.length) {
      const id = queue.shift();
      if (wheelIds.has(id)) {
        result.add(motor.id);
        break;
      }
      for (const neighbor of adjacency.get(id) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return result;
}
