import { builtInDemo } from "../../src/model/demo-blueprints.js";
import {
  portDefinition,
  portIds,
  portsCompatible,
} from "../../src/model/ports.js";

export const BUILT_IN_KINDS = Object.freeze([
  "gearbox",
  "cart",
  "humanoid",
  "drone",
  "mission",
]);

function issueKey(issue) {
  return [
    issue.demo,
    issue.code,
    issue.connectionId ?? "-",
    issue.endpoint ?? "-",
    issue.partId ?? "-",
    issue.port ?? "-",
  ].join(":");
}

/** Enumerates raw producer topology debt without invoking decoder repair. */
export function probeBuiltInTopology() {
  const issues = [];
  for (const demo of BUILT_IN_KINDS) {
    const blueprint = builtInDemo(demo).blueprint,
      parts = new Map(blueprint.parts.map((part) => [part.id, part])),
      occupancy = new Map(),
      surfaceAnchors = new Map();
    for (const connection of blueprint.connections) {
      const left = parts.get(connection.a),
        right = parts.get(connection.b),
        physical =
          connection.kind === "mechanical" || connection.kind === "mesh",
        endpoints = [
          { endpoint: "A", part: left, port: connection.portA },
          { endpoint: "B", part: right, port: connection.portB },
        ];
      if (
        physical &&
        (!Number.isFinite(connection.capacity?.ultimateForceN) ||
          connection.capacity.ultimateForceN <= 0 ||
          !Number.isFinite(connection.capacity?.ultimateTorqueNm) ||
          connection.capacity.ultimateTorqueNm <= 0)
      )
        issues.push({
          demo,
          code: "MISSING_CONNECTION_CAPACITY",
          connectionId: connection.id,
          endpoint: "AB",
          partId: null,
          port: null,
        });
      if (
        !physical &&
        (connection.capacity || connection.anchorA || connection.anchorB)
      )
        issues.push({
          demo,
          code: "NETWORK_STRUCTURAL_CONTRACT",
          connectionId: connection.id,
          endpoint: "AB",
          partId: null,
          port: null,
        });
      for (const { endpoint, part, port } of endpoints) {
        if (!port) {
          issues.push({
            demo,
            code: "MISSING_ENDPOINT_PORT",
            connectionId: connection.id,
            endpoint,
            partId: part?.id ?? null,
            port: null,
          });
          continue;
        }
        if (!part || !portIds(part).includes(port)) {
          issues.push({
            demo,
            code: "UNKNOWN_PORT",
            connectionId: connection.id,
            endpoint,
            partId: part?.id ?? null,
            port,
          });
          continue;
        }
        const key = `${part.id}\0${port}`;
        const use = occupancy.get(key) || { part, port, connectionIds: [] };
        use.connectionIds.push(connection.id);
        occupancy.set(key, use);
        if (
          physical &&
          portDefinition(part, port).behavior === "structural-surface"
        ) {
          const anchor = connection[`anchor${endpoint}`],
            prior = surfaceAnchors.get(key) || [];
          if (
            !Array.isArray(anchor) ||
            anchor.length !== 3 ||
            anchor.some((value) => !Number.isFinite(value))
          )
            issues.push({
              demo,
              code: "MISSING_SURFACE_ANCHOR",
              connectionId: connection.id,
              endpoint,
              partId: part.id,
              port,
            });
          else {
            if (
              prior.some(
                (existing) =>
                  Math.hypot(
                    anchor[0] - existing[0],
                    anchor[1] - existing[1],
                    anchor[2] - existing[2],
                  ) < 0.01,
              )
            )
              issues.push({
                demo,
                code: "SURFACE_ANCHOR_OCCUPIED",
                connectionId: connection.id,
                endpoint,
                partId: part.id,
                port,
              });
            prior.push(anchor);
            surfaceAnchors.set(key, prior);
          }
        }
      }
      if (
        left &&
        right &&
        connection.portA &&
        connection.portB &&
        portIds(left).includes(connection.portA) &&
        portIds(right).includes(connection.portB)
      ) {
        const leftPort = portDefinition(left, connection.portA),
          rightPort = portDefinition(right, connection.portB);
        if (
          leftPort.kind !== connection.kind ||
          rightPort.kind !== connection.kind ||
          !portsCompatible(left, connection.portA, right, connection.portB)
        )
          issues.push({
            demo,
            code: "INCOMPATIBLE_PORTS",
            connectionId: connection.id,
            endpoint: "AB",
            partId: null,
            port: `${connection.portA}->${connection.portB}`,
          });
      }
    }
    for (const { part, port, connectionIds } of occupancy.values()) {
      if (
        portDefinition(part, port).multiplicity === "one" &&
        connectionIds.length > 1
      )
        issues.push({
          demo,
          code: "PORT_OCCUPIED",
          connectionId: connectionIds.join(","),
          endpoint: "*",
          partId: part.id,
          port,
        });
    }
  }
  return issues
    .map((issue) => ({ ...issue, key: issueKey(issue) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}
