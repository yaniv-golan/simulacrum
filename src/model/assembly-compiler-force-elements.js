import {
  cloneCompiledValue,
  compiledPortDefinition,
  compiledVector,
  isAxialForceElement,
  PHYSICAL_CONNECTION_KINDS,
  worldPoint,
} from "./assembly-compiler-shared.js";
import { validateConnectionFrameInvariant } from "./connection-frame-invariants.js";

function physicalEdgesFor(context, connector) {
  return context.connections.filter(
    (connection) =>
      PHYSICAL_CONNECTION_KINDS.has(connection.kind) &&
      !connection.failed &&
      (connection.a === connector.id || connection.b === connector.id),
  );
}

function orderedConnectorEdges(connector, edges) {
  const mechanismConfig = connector.mechanism.config,
    connectorPort = (edge) =>
      edge.a === connector.id ? edge.portA : edge.portB;
  return {
    connectorPort,
    edges: [
      edges.find(
        (edge) => connectorPort(edge) === mechanismConfig.endpointPortA,
      ),
      edges.find(
        (edge) => connectorPort(edge) === mechanismConfig.endpointPortB,
      ),
    ],
  };
}

function resolveAttachments(context, connector, orderedEdges, neighbors) {
  return orderedEdges.map((edge, index) => {
    const neighbor = context.partById.get(neighbors[index]),
      neighborPort = edge.a === connector.id ? edge.portB : edge.portA,
      port = compiledPortDefinition(neighbor, neighborPort, context.catalog),
      frame = context.geometryFor(neighbor).portFrames[neighborPort],
      structuralAnchor =
        port.behavior === "structural-surface"
          ? edge.a === neighbor.id
            ? edge.anchorA
            : edge.anchorB
          : null,
      resolvedFrame = structuralAnchor
        ? {
            ...frame,
            framePart: {
              ...frame.framePart,
              positionM: compiledVector(structuralAnchor),
            },
          }
        : frame;
    return { edge, neighbor, neighborPort, frame: resolvedFrame };
  });
}

function compileEndpointPointMasses(
  context,
  connector,
  attachments,
  neighbors,
  connectorPort,
) {
  const massModel = connector.mechanism.config.massModel;
  if (massModel.kind !== "lumped-endpoints-v1") return;
  const fractions = [
    massModel.endpointMassFractionA,
    1 - massModel.endpointMassFractionA,
  ];
  for (let index = 0; index < neighbors.length; index++) {
    const { edge, neighbor, frame } = attachments[index],
      points = context.endpointPointMasses.get(neighbor.id) || [];
    points.push({
      sourcePartId: connector.id,
      sourceConnectionId: edge.id,
      endpointPort: connectorPort(edge),
      massKg: massModel.totalMassKg * fractions[index],
      positionPartM: compiledVector(frame.framePart.positionM),
    });
    context.endpointPointMasses.set(neighbor.id, points);
  }
}

function forceElementBase(connector, orderedEdges, neighbors, attachments) {
  return {
    id: `connector:${connector.id}`,
    sourcePartId: connector.id,
    sourceConnectionIds: orderedEdges.map((edge) => edge.id),
    a: neighbors[0],
    b: neighbors[1],
    anchorA: worldPoint(
      attachments[0].neighbor,
      attachments[0].frame.framePart.positionM,
    ),
    anchorB: worldPoint(
      attachments[1].neighbor,
      attachments[1].frame.framePart.positionM,
    ),
    breakForce: Math.min(
      ...orderedEdges.map((edge) => edge.capacity.ultimateForceN),
    ),
    breakTorque: Math.min(
      ...orderedEdges.map((edge) => edge.capacity.ultimateTorqueNm),
    ),
  };
}

const FORCE_ELEMENT_COMPILERS = new Map([
  [
    "release-coupler-v1",
    (context, connector, base, mechanismConfig) => {
      const descriptor = {
        ...base,
        kind: "fixed",
        breakForce: Math.min(
          base.breakForce,
          mechanismConfig.loadLimits.ultimateForceN,
        ),
        breakTorque: Math.min(
          base.breakTorque,
          mechanismConfig.loadLimits.ultimateTorqueNm,
        ),
        mechanism: cloneCompiledValue(mechanismConfig),
      };
      context.constraints.push(descriptor);
      context.actuators.push({
        id: `actuator:${connector.id}`,
        kind: "release-coupler-v1",
        sourcePartId: connector.id,
        constraintId: descriptor.id,
        sourceConnectionIds: [...descriptor.sourceConnectionIds],
        breakawayConnectionIds: context.connections
          .filter(
            (connection) =>
              connection.releaseCouplerPartId === connector.id &&
              !connection.failed,
          )
          .map((connection) => connection.id)
          .sort((left, right) => String(left).localeCompare(String(right))),
        law: cloneCompiledValue(mechanismConfig.releaseLaw),
      });
    },
  ],
  [
    "linear-actuator-v1",
    (context, connector, base, mechanismConfig) => {
      const descriptor = {
        ...base,
        kind: "linear-actuator",
        mechanism: cloneCompiledValue(mechanismConfig),
      };
      context.constraints.push(descriptor);
      context.actuators.push({
        id: `actuator:${connector.id}`,
        kind: "linear-actuator-v1",
        sourcePartId: connector.id,
        constraintId: descriptor.id,
        law: cloneCompiledValue(mechanismConfig),
      });
    },
  ],
  [
    "axial-spring-v1",
    (context, connector, base, mechanismConfig) => {
      const reference = mechanismConfig.referenceLaw,
        restLength =
          reference.kind === "zero-force-length-v1"
            ? reference.freeLengthM
            : reference.referenceLengthM,
        descriptor = {
          ...base,
          kind: "spring",
          stiffness:
            mechanismConfig.elasticLaw.kind === "linear-v1"
              ? mechanismConfig.elasticLaw.stiffnessNPerM
              : null,
          damping:
            mechanismConfig.dampingLaw.kind === "linear-v1"
              ? mechanismConfig.dampingLaw.dampingNsPerM
              : null,
          restLength,
          mechanism: cloneCompiledValue(mechanismConfig),
        };
      context.constraints.push(descriptor);
      context.forceElements.push({
        id: `force:${connector.id}`,
        kind: "axial-spring-v1",
        sourcePartId: connector.id,
        constraintId: descriptor.id,
        law: cloneCompiledValue(mechanismConfig),
      });
    },
  ],
  [
    "axial-damper-v1",
    (context, connector, base, mechanismConfig) => {
      context.constraints.push({
        ...base,
        kind: "damper",
        mechanism: cloneCompiledValue(mechanismConfig),
      });
      context.forceElements.push({
        id: `force:${connector.id}`,
        kind: "axial-damper-v1",
        sourcePartId: connector.id,
        constraintId: `connector:${connector.id}`,
        law: cloneCompiledValue(mechanismConfig),
      });
    },
  ],
]);

function forceElementKind(mechanismConfig) {
  if (mechanismConfig.releaseLaw) return "release-coupler-v1";
  if (mechanismConfig.commandLaw) return "linear-actuator-v1";
  if (mechanismConfig.elasticLaw) return "axial-spring-v1";
  return "axial-damper-v1";
}

function compileConnector(context, connector) {
  const edges = physicalEdgesFor(context, connector);
  if (edges.length !== 2) {
    context.diagnostics.push({
      severity: connector.mechanism.config.releaseLaw ? "error" : "warning",
      code: connector.mechanism.config.releaseLaw
        ? "INVALID_RELEASE_COUPLER_TOPOLOGY"
        : "INCOMPLETE_CONNECTOR",
      partId: connector.id,
      message: `${connector.type} #${connector.id} needs exactly two physical attachments; found ${edges.length}.`,
    });
    return;
  }
  const { connectorPort, edges: orderedEdges } = orderedConnectorEdges(
    connector,
    edges,
  );
  if (orderedEdges.some((edge) => !edge)) {
    context.diagnostics.push({
      severity: "error",
      code: "FORCE_ELEMENT_ENDPOINT_PORT_MISMATCH",
      partId: connector.id,
      message: `${connector.type} #${connector.id} attachments must use ${connector.mechanism.config.endpointPortA} and ${connector.mechanism.config.endpointPortB}.`,
    });
    return;
  }
  const neighbors = orderedEdges.map((edge) =>
    edge.a === connector.id ? edge.b : edge.a,
  );
  if (neighbors[0] === neighbors[1]) {
    context.diagnostics.push({
      severity: "error",
      code: "SELF_CONNECTOR",
      partId: connector.id,
      message: `${connector.type} #${connector.id} cannot join a body to itself.`,
    });
    return;
  }
  for (const edge of orderedEdges) {
    const partA = context.partById.get(edge.a),
      partB = context.partById.get(edge.b),
      invariant = validateConnectionFrameInvariant({
        connection: edge,
        partA,
        partB,
        portA: compiledPortDefinition(partA, edge.portA, context.catalog),
        portB: compiledPortDefinition(partB, edge.portB, context.catalog),
        geometryA: context.geometryFor(partA),
        geometryB: context.geometryFor(partB),
      });
    if (!invariant.ok) {
      context.diagnostics.push(invariant.diagnostic);
      return;
    }
  }
  const attachments = resolveAttachments(
    context,
    connector,
    orderedEdges,
    neighbors,
  );
  if (attachments.some((attachment) => !attachment.frame)) {
    for (const attachment of attachments.filter((item) => !item.frame))
      context.diagnostics.push({
        severity: "error",
        code: "FORCE_ELEMENT_ATTACHMENT_FRAME_MISSING",
        partId: connector.id,
        connectionId: attachment.edge.id,
        message: `${connector.type} #${connector.id} requires an authored frame for ${attachment.neighbor.type} #${attachment.neighbor.id} port ${attachment.neighborPort}.`,
      });
    return;
  }
  context.forceElementParts.add(connector.id);
  compileEndpointPointMasses(
    context,
    connector,
    attachments,
    neighbors,
    connectorPort,
  );
  for (const edge of edges) context.consumedConnections.add(edge.id);
  const mechanismConfig = connector.mechanism.config,
    compiler = FORCE_ELEMENT_COMPILERS.get(forceElementKind(mechanismConfig));
  compiler(
    context,
    connector,
    forceElementBase(connector, orderedEdges, neighbors, attachments),
    mechanismConfig,
  );
}

export function compileForceElements(context) {
  for (const connector of context.parts.filter(isAxialForceElement))
    compileConnector(context, connector);
}
