import { componentIsPayload } from "./component-contracts.js";
import { finiteOr as finite } from "./finite-or.js";

const PHYSICAL_KINDS = new Set(["mechanical", "mesh"]);

function bodyMass(body) {
  return Math.max(
    0.001,
    (body.descriptors || []).reduce(
      (sum, descriptor) => sum + finite(descriptor.massKg, 1),
      0,
    ),
  );
}

function componentLabel(parts) {
  const types = new Set(parts.map((part) => part.type));
  if (types.has("rocket") && types.has("wheel")) return "HYBRID VEHICLE";
  if (types.has("rocket")) return "FLIGHT VEHICLE";
  if (types.has("wheel")) return "GROUND VEHICLE";
  if (parts.some((part) => part.rigRole === "pelvis"))
    return "ARTICULATED MACHINE";
  return "PHYSICAL ASSEMBLY";
}

function storedEnergyWh(parts) {
  return parts.reduce(
    (sum, part) =>
      sum +
      (part.energyJ != null
        ? finite(part.energyJ) / 3600
        : finite(part.storedEnergyWh, part.config?.capacityWh)),
    0,
  );
}

/**
 * Projects measurements onto the canonical physical-component index published
 * by simulation. It never reconstructs a competing connectivity identity from
 * the presentation-oriented run snapshot.
 */
export function physicalComponents(telemetry) {
  const run = telemetry?.run || {},
    parts = run.parts || [],
    connections = run.connections || [],
    bodies = telemetry?.bodies?.bodies || [],
    bodyByPart = new Map(
      (telemetry?.bodies?.bodyByPart || []).map((entry) => [
        entry.partId,
        entry.bodyId,
      ]),
    ),
    bodiesById = new Map(bodies.map((body) => [body.bodyId, body])),
    partsById = new Map(parts.map((part) => [part.id, part])),
    indexedComponents = telemetry?.systems?.physicalAssembly?.components || [];
  const components = [],
    fluidByPart = telemetry?.systems?.fluids?.byPart || {};
  for (const indexed of indexedComponents) {
    const partIds = Array.isArray(indexed.partIds) ? [...indexed.partIds] : [],
      bodyPartIds = Array.isArray(indexed.bodyPartIds)
        ? indexed.bodyPartIds
        : partIds;
    const componentParts = partIds
        .map((id) => partsById.get(id))
        .filter(Boolean),
      componentBodies = [
        ...new Set(bodyPartIds.map((id) => bodyByPart.get(id)).filter(Boolean)),
      ]
        .map((id) => bodiesById.get(id))
        .filter(Boolean);
    if (!componentBodies.length) continue;
    let mass = 0,
      x = 0,
      y = 0,
      z = 0,
      vx = 0,
      vy = 0,
      vz = 0;
    for (const body of componentBodies) {
      const bodyMassKg = bodyMass(body);
      mass += bodyMassKg;
      x += finite(body.pose?.position?.x) * bodyMassKg;
      y += finite(body.pose?.position?.y) * bodyMassKg;
      z += finite(body.pose?.position?.z) * bodyMassKg;
      vx += finite(body.velocity?.x) * bodyMassKg;
      vy += finite(body.velocity?.y) * bodyMassKg;
      vz += finite(body.velocity?.z) * bodyMassKg;
    }
    const partSet = new Set(partIds),
      payloadPartIds = componentParts
        .filter((part) => componentIsPayload(part))
        .map((part) => part.id),
      securedPayloadPartIds = payloadPartIds.filter((payloadId) =>
        connections.some(
          (connection) =>
            PHYSICAL_KINDS.has(connection.kind) &&
            !connection.failed &&
            (connection.a === payloadId || connection.b === payloadId) &&
            partSet.has(
              connection.a === payloadId ? connection.b : connection.a,
            ),
        ),
      ),
      touchingConnections = connections.filter(
        (connection) => partSet.has(connection.a) || partSet.has(connection.b),
      ),
      failedConnections = touchingConnections.filter(
        (connection) => connection.failed,
      ),
      grounded = componentBodies.some((body) =>
        (body.contacts || []).some(
          (contact) =>
            String(contact.otherBodyId || "").startsWith("environment:") &&
            finite(contact.normal?.y) > 0.2,
        ),
      ),
      inWater = partIds.some(
        (id) => finite(fluidByPart[String(id)]?.submerged) > 0,
      ),
      pelvis = componentParts.find((part) => part.rigRole === "pelvis"),
      pelvisBody = pelvis ? bodiesById.get(bodyByPart.get(pelvis.id)) : null,
      upY = pelvisBody
        ? 1 -
          2 *
            (finite(pelvisBody.pose?.quaternion?.x) ** 2 +
              finite(pelvisBody.pose?.quaternion?.z) ** 2)
        : 1,
      footHeights = componentParts
        .filter((part) => ["footL", "footR"].includes(part.rigRole))
        .map(
          (part) => bodiesById.get(bodyByPart.get(part.id))?.pose?.position?.y,
        )
        .filter((value) => Number.isFinite(Number(value)))
        .map(Number),
      fallen = pelvisBody
        ? upY < 0.35 ||
          (footHeights.length > 0 &&
            finite(pelvisBody.pose.position.y) <
              Math.min(...footHeights) + 0.75)
        : componentBodies.every((body) => finite(body.pose?.position?.y) < -5);
    components.push({
      id: String(indexed.id),
      partIds,
      bodyIds: componentBodies.map((body) => body.bodyId),
      label: componentLabel(componentParts),
      position: { x: x / mass, y: y / mass, z: z / mass },
      velocity: { x: vx / mass, y: vy / mass, z: vz / mass },
      speedMps: Math.hypot(vx / mass, vy / mass, vz / mass),
      massKg: mass,
      partCount: componentParts.length,
      energyWh: storedEnergyWh(componentParts),
      grounded,
      fallen,
      inWater,
      payloadPartIds,
      securedPayloadPartIds,
      payloadSecured: securedPayloadPartIds.length > 0,
      failedConnectionIds: failedConnections.map((connection) => connection.id),
      detachedPartIds: componentParts
        .filter((part) => part.detached)
        .map((part) => part.id),
      worstFatigue: Math.max(
        0,
        ...touchingConnections.map((connection) => finite(connection.fatigue)),
      ),
    });
  }
  return components;
}
