import { TYPES } from "./component-catalog.js";
import { DomainValidationError, immutableClone } from "./primitives.js";

const PORT_PRESENTATION = Object.freeze({
  POWER: {
    medium: "ELECTRICAL POWER",
    description:
      "Carries electrical energy; it does not carry commands or rotation.",
  },
  "POWER IN": {
    medium: "ELECTRICAL POWER INPUT",
    description: "Receives electrical energy into a distribution bus.",
  },
  "POWER OUT": {
    medium: "ELECTRICAL POWER OUTPUT",
    description: "Distributes source energy to downstream consumers.",
  },
  CONTROL: {
    medium: "COMMAND INPUT",
    description:
      "Receives controller commands; it does not supply electrical power.",
  },
  SIGNAL: {
    medium: "DATA SIGNAL",
    description:
      "Carries measurements or commands; it transmits no torque or electrical power.",
  },
  "IN A": {
    medium: "DATA INPUT",
    description: "Receives sensor data or upstream command values.",
  },
  "IN B": {
    medium: "DATA INPUT",
    description: "Receives a second sensor or upstream command values.",
  },
  OUT: {
    medium: "COMMAND OUTPUT",
    description:
      "Sends this controller's commands to connected smart components.",
  },
  OUTLET: {
    medium: "MATERIAL RESOURCE OUTPUT",
    description:
      "Feeds one explicitly declared material medium; it carries no power or commands.",
  },
  PROPELLANT: {
    medium: "PROPELLANT INPUT",
    description:
      "Receives only the exact declared propellant medium through a physical feed connection.",
  },
  SHAFT: {
    medium: "ROTATING MECHANICAL",
    description:
      "Mounts coaxially to transfer or measure physical rotation and torque.",
  },
  AXLE: {
    medium: "ROTATING MECHANICAL",
    description: "Mounts coaxially on an axle and transfers physical rotation.",
  },
  MESH: {
    medium: "GEAR-TOOTH CONTACT",
    description:
      "Meshes gear teeth at their pitch circles to transfer torque and ratio.",
  },
});

/** @param {any} component @param {Record<string, any>} [catalog] */
export function portIds(component, catalog = TYPES) {
  const type = typeof component === "string" ? component : component?.type;
  return (catalog[type]?.ports || []).map((descriptor) => descriptor.id);
}

/** @param {any} part @param {any} port @param {Record<string, any>} [catalog] */
export function portDefinition(part, port, catalog = TYPES) {
  const descriptor = (catalog[part?.type]?.ports || []).find(
    (candidate) => candidate.id === port,
  );
  if (!descriptor)
    throw new DomainValidationError(
      "UNKNOWN_PORT",
      `Port ${String(port)} is not declared by ${String(part?.type)}`,
      { details: { partType: part?.type, port } },
    );
  return immutableClone(descriptor);
}

/** @param {any} part @param {any} port @param {Record<string, any>} [catalog] */
export function portPresentation(part, port, catalog = TYPES) {
  const descriptor = portDefinition(part, port, catalog);
  if (part?.type === "sensor" && port === "SHAFT")
    return {
      medium: "MEASUREMENT INPUT",
      description:
        "Mount coaxially to the rotating part whose signed RPM should be measured.",
    };
  return immutableClone(
    PORT_PRESENTATION[port] ||
      (descriptor.behavior === "structural-surface"
        ? {
            medium: "STRUCTURAL SURFACE",
            description:
              "Creates load-bearing attachments at distinct local surface anchors.",
          }
        : descriptor.kind === "mechanical"
          ? {
              medium: "MECHANICAL ATTACHMENT",
              description:
                "Creates one load-bearing physical attachment to another component.",
            }
          : {
              medium: descriptor.kind.toUpperCase(),
              description: `Carries ${descriptor.kind} through an explicit ${descriptor.behavior} port.`,
            }),
  );
}

function directionsCompatible(left, right) {
  if (left === "bidirectional" || right === "bidirectional") return true;
  return (
    (left === "source" && right === "sink") ||
    (left === "sink" && right === "source")
  );
}

const COMPATIBLE_BEHAVIOR_PAIRS = new Set([
  "fixed:fixed",
  "fixed:structural-surface",
  "structural-surface:fixed",
  "structural-surface:structural-surface",
  "flexible-termination:fixed",
  "fixed:flexible-termination",
  "flexible-termination:structural-surface",
  "structural-surface:flexible-termination",
  "rotary-coupling:rotary-coupling",
  "revolute-support:rotary-coupling",
  "rotary-coupling:revolute-support",
  "rotary-actuator-output:rotary-coupling",
  "rotary-coupling:rotary-actuator-output",
  "rotary-position-actuator-output:fixed",
  "fixed:rotary-position-actuator-output",
  "rotary-position-actuator-output:structural-surface",
  "structural-surface:rotary-position-actuator-output",
  "linear-guide-output:fixed",
  "fixed:linear-guide-output",
  "linear-guide-output:structural-surface",
  "structural-surface:linear-guide-output",
  "linear-position-actuator-output:fixed",
  "fixed:linear-position-actuator-output",
  "linear-position-actuator-output:structural-surface",
  "structural-surface:linear-position-actuator-output",
  "rotary-measurement:rotary-coupling",
  "rotary-coupling:rotary-measurement",
  "gear:gear",
  "electrical-network:electrical-network",
  "signal-network:signal-network",
  "material-resource:material-resource",
]);

/**
 * @param {any} sourcePart
 * @param {any} sourcePort
 * @param {any} targetPart
 * @param {any} targetPort
 * @param {Record<string, any>} [catalog]
 */
export function portsCompatible(
  sourcePart,
  sourcePort,
  targetPart,
  targetPort,
  catalog = TYPES,
) {
  const source = portDefinition(sourcePart, sourcePort, catalog),
    target = portDefinition(targetPart, targetPort, catalog);
  return (
    source.kind === target.kind &&
    (source.kind !== "resource" ||
      (typeof source.mediumId === "string" &&
        source.mediumId.length > 0 &&
        source.mediumId === target.mediumId)) &&
    directionsCompatible(source.direction, target.direction) &&
    COMPATIBLE_BEHAVIOR_PAIRS.has(`${source.behavior}:${target.behavior}`)
  );
}

function portUseCount(partId, port, connections) {
  return connections.filter(
    (connection) =>
      !connection.failed &&
      ((connection.a === partId && connection.portA === port) ||
        (connection.b === partId && connection.portB === port)),
  ).length;
}

/**
 * @param {any} sourcePart
 * @param {any} sourcePort
 * @param {any} targetPart
 * @param {any} targetPort
 * @param {any[]} [connections]
 * @param {Record<string, any>} [catalog]
 * @param {any} [candidate]
 */
export function validatePortConnection(
  sourcePart,
  sourcePort,
  targetPart,
  targetPort,
  connections = [],
  catalog = TYPES,
  candidate = null,
) {
  if (!sourcePort || !targetPort)
    throw new DomainValidationError(
      "MISSING_ENDPOINT_PORT",
      "Both endpoint ports are required for a newly authored connection",
    );
  if (
    !portIds(sourcePart, catalog).includes(sourcePort) ||
    !portIds(targetPart, catalog).includes(targetPort)
  )
    throw new DomainValidationError(
      "UNKNOWN_PORT",
      "Connection endpoints must name ports declared by their component types",
      {
        details: {
          sourceType: sourcePart?.type,
          sourcePort,
          targetType: targetPart?.type,
          targetPort,
        },
      },
    );
  if (!portsCompatible(sourcePart, sourcePort, targetPart, targetPort, catalog))
    throw new DomainValidationError(
      "INCOMPATIBLE_PORTS",
      `${sourcePort} cannot connect to ${targetPort}`,
      {
        details: {
          source: portDefinition(sourcePart, sourcePort, catalog),
          target: portDefinition(targetPart, targetPort, catalog),
        },
      },
    );
  if (
    candidate &&
    connections.some(
      (connection) =>
        !connection.failed &&
        ((connection.a === candidate.a &&
          connection.b === candidate.b &&
          connection.portA === candidate.portA &&
          connection.portB === candidate.portB) ||
          (connection.a === candidate.b &&
            connection.b === candidate.a &&
            connection.portA === candidate.portB &&
            connection.portB === candidate.portA)),
    )
  )
    throw new DomainValidationError(
      "DUPLICATE_ENDPOINT_CONNECTION",
      "These exact component endpoints are already connected",
    );
  for (const [part, port, endpoint] of [
    [sourcePart, sourcePort, "A"],
    [targetPart, targetPort, "B"],
  ]) {
    const definition = portDefinition(part, port, catalog);
    if (
      definition.multiplicity === "one" &&
      portUseCount(part.id, port, connections) > 0
    )
      throw new DomainValidationError(
        "PORT_OCCUPIED",
        `${port} on part ${part.id} already has a connection`,
        { details: { partId: part.id, port } },
      );
    if (candidate?.capacity && definition.behavior === "structural-surface") {
      const anchorName = `anchor${endpoint}`,
        anchor = candidate[anchorName];
      if (
        !Array.isArray(anchor) ||
        anchor.length !== 3 ||
        anchor.some((value) => !Number.isFinite(value))
      )
        throw new DomainValidationError(
          "MISSING_SURFACE_ANCHOR",
          `${anchorName} must locate the ${port} surface attachment in local metres`,
          { details: { partId: part.id, port, anchorName } },
        );
      for (const connection of connections) {
        const existingAnchor =
          connection.a === part.id && connection.portA === port
            ? connection.anchorA
            : connection.b === part.id && connection.portB === port
              ? connection.anchorB
              : null;
        if (
          Array.isArray(existingAnchor) &&
          Math.hypot(
            anchor[0] - existingAnchor[0],
            anchor[1] - existingAnchor[1],
            anchor[2] - existingAnchor[2],
          ) < 0.01
        )
          throw new DomainValidationError(
            "SURFACE_ANCHOR_OCCUPIED",
            `${port} on part ${part.id} already has an attachment at this anchor`,
            { details: { partId: part.id, port, anchor } },
          );
      }
    }
  }
  return true;
}

/** Exact endpoint-aware lookup used by inspectors and connection tooling. */
export function connectionUsesPort(connection, part, port) {
  if (connection?.a === part?.id) return connection.portA === port;
  if (connection?.b === part?.id) return connection.portB === port;
  return false;
}

/** @param {any} sourcePart @param {any} sourcePort @param {any} targetPart @param {Record<string, any>} catalog @param {any[]} [connections] */
export function compatibleTargetPorts(
  sourcePart,
  sourcePort,
  targetPart,
  catalog,
  connections = [],
) {
  if (!sourcePort) return [];
  return portIds(targetPart, catalog).filter((targetPort) => {
    if (
      !portsCompatible(sourcePart, sourcePort, targetPart, targetPort, catalog)
    )
      return false;
    const definition = portDefinition(targetPart, targetPort, catalog);
    return (
      definition.multiplicity !== "one" ||
      portUseCount(targetPart.id, targetPort, connections) === 0
    );
  });
}

/**
 * Selects and persists the target endpoint instead of leaving a physical
 * connection half-described. Ranking is based on port contracts, not demos.
 */
export function selectCompatibleTargetPort(
  sourcePart,
  sourcePort,
  targetPart,
  catalog,
  connections = [],
) {
  const compatible = compatibleTargetPorts(
    sourcePart,
    sourcePort,
    targetPart,
    catalog,
    connections,
  );
  if (!compatible.length) return null;
  const source = portDefinition(sourcePart, sourcePort, catalog),
    ranked = [...compatible].sort((left, right) => {
      const score = (port) => {
        const definition = portDefinition(targetPart, port, catalog);
        let value = definition.behavior === source.behavior ? 10 : 0;
        if (port === sourcePort) value += 4;
        return value;
      };
      return score(right) - score(left);
    });
  return ranked[0];
}

export function inferConnectionKind(partA, partB, selectedPort = null) {
  if (selectedPort) return portDefinition(partA, selectedPort).kind;
  if (partA?.config?.teeth && partB?.config?.teeth) return "mesh";
  if (partA?.type === "battery" || partB?.type === "battery") return "power";
  if (
    [partA, partB].some(
      (part) => part?.type === "computer" || part?.config?.readings?.length,
    )
  )
    return "signal";
  return "mechanical";
}
