import { componentDefinition } from "./component-contracts.js";
import {
  cloneCompiledValue,
  compiledPortDefinition,
  compiledVector,
  PHYSICAL_CONNECTION_KINDS,
  worldPortFrame,
} from "./assembly-compiler-shared.js";
import { rotateVectorByQuaternion } from "./primitives.js";

const finitePositive = (value) => Number.isFinite(value) && value > 0;
const MAXIMUM_FLEXIBLE_ENTITY_COUNT = 512;

function endpointConnections(context, part, portId) {
  return context.connections.filter(
    (connection) =>
      !connection.failed &&
      PHYSICAL_CONNECTION_KINDS.has(connection.kind) &&
      ((connection.a === part.id && connection.portA === portId) ||
        (connection.b === part.id && connection.portB === portId)),
  );
}

function attachmentFor(context, part, portId, endpointIndex) {
  const connections = endpointConnections(context, part, portId);
  if (connections.length > 1) {
    context.diagnostics.push({
      severity: "error",
      code: "FLEXIBLE_ENDPOINT_MULTIPLY_ATTACHED",
      partId: part.id,
      connectionId: connections[1].id,
      message: `Flexible endpoint ${portId} has ${connections.length} physical attachments.`,
    });
    return null;
  }
  const connection = connections[0];
  if (!connection)
    return { kind: "free-v1", endpointPortId: portId, endpointIndex };
  const lineIsA = connection.a === part.id,
    neighborId = lineIsA ? connection.b : connection.a,
    neighbor = context.partById.get(neighborId),
    neighborPortId = lineIsA ? connection.portB : connection.portA,
    neighborAnchor = lineIsA ? connection.anchorB : connection.anchorA;
  if (
    !neighbor ||
    componentDefinition(neighbor, context.catalog)?.flexibleLine?.kind ===
      "flexible-line-v1"
  ) {
    context.diagnostics.push({
      severity: "error",
      code: "FLEXIBLE_ENDPOINT_BODY_REQUIRED",
      partId: part.id,
      connectionId: connection.id,
      message: `Flexible endpoint ${portId} requires one ordinary physical body.`,
    });
    return null;
  }
  const port = compiledPortDefinition(
      neighbor,
      neighborPortId,
      context.catalog,
    ),
    frame = worldPortFrame(neighbor, port, neighborAnchor);
  context.consumedConnections.add(connection.id);
  return {
    id: `flex:${part.id}:attachment:${endpointIndex}`,
    kind: "point-attachment-v1",
    sourcePartId: part.id,
    endpointPortId: portId,
    endpointIndex,
    sourceConnectionId: connection.id,
    targetPartId: neighbor.id,
    targetBodyId: `body:${neighbor.id}`,
    targetPortId: neighborPortId,
    anchorPartM: compiledVector(
      neighborAnchor || port.localFramePart?.positionM,
    ),
    anchorWorldM: compiledVector(frame.positionWorld),
    ultimateForceN: connection.capacity.ultimateForceN,
  };
}

function initialEndpoints(part, contract, attachments, lengthM) {
  const attached = attachments.map((attachment) =>
      attachment?.kind === "point-attachment-v1"
        ? attachment.anchorWorldM
        : null,
    ),
    axis = rotateVectorByQuaternion(
      compiledVector(contract.initialAxisPart, [0, -1, 0]),
      part.orientation,
    ),
    center = compiledVector(part.pos),
    scaledAxis = axis.map((value) => value * lengthM);
  if (attached[0] && attached[1]) return attached;
  if (attached[0] || attached[1]) {
    const attachedIndex = attached[0] ? 0 : 1,
      anchor = attached[attachedIndex],
      towardAuthoredCenter = center.map(
        (value, index) => value - anchor[index],
      ),
      centerDistanceM = Math.hypot(...towardAuthoredCenter),
      fallback = attachedIndex === 0 ? axis : axis.map((value) => -value),
      direction =
        centerDistanceM > 1e-9
          ? towardAuthoredCenter.map((value) => value / centerDistanceM)
          : fallback,
      freeEndpoint = anchor.map(
        (value, index) => value + direction[index] * lengthM,
      );
    return attachedIndex === 0
      ? [anchor, freeEndpoint]
      : [freeEndpoint, anchor];
  }
  return [
    center.map((value, i) => value - scaledAxis[i] / 2),
    center.map((value, i) => value + scaledAxis[i] / 2),
  ];
}

function compileLine(context, part, contract) {
  const config = part.config || {},
    required = [
      "lengthM",
      "diameterM",
      "linearDensityKgPerM",
      "axialStiffnessNPerM",
      "axialDampingNsPerM",
      "ultimateTensionN",
      "targetElementLengthM",
      "materialKey",
    ],
    invalid = required.filter((key) =>
      key === "materialKey"
        ? typeof config[key] !== "string" || !config[key]
        : !finitePositive(config[key]),
    );
  if (invalid.length) {
    context.diagnostics.push({
      severity: "error",
      code: "INVALID_FLEXIBLE_LINE_CONFIG",
      partId: part.id,
      message: `Flexible line has invalid fields: ${invalid.join(", ")}.`,
    });
    return;
  }
  const elementCount = Math.max(
    2,
    Math.ceil(config.lengthM / config.targetElementLengthM),
  );
  if (elementCount > (contract.maximumElementCount || 128)) {
    context.diagnostics.push({
      severity: "error",
      code: "FLEXIBLE_LINE_ELEMENT_BUDGET_EXCEEDED",
      partId: part.id,
      message: `Flexible line requests ${elementCount} elements; maximum is ${contract.maximumElementCount || 128}.`,
    });
    return;
  }
  const requestedEntityCount = elementCount + 1,
    existingEntityCount = context.flexibleLines.reduce(
      (sum, line) => sum + line.entities.length,
      0,
    );
  if (
    existingEntityCount + requestedEntityCount >
    MAXIMUM_FLEXIBLE_ENTITY_COUNT
  ) {
    context.diagnostics.push({
      severity: "error",
      code: "FLEXIBLE_LINE_GLOBAL_ENTITY_BUDGET_EXCEEDED",
      partId: part.id,
      message: `Flexible lines request ${existingEntityCount + requestedEntityCount} entities; maximum is ${MAXIMUM_FLEXIBLE_ENTITY_COUNT}.`,
    });
    return;
  }
  context.flexibleLineParts.add(part.id);
  const attachments = [
      attachmentFor(context, part, contract.endpointPortA, 0),
      attachmentFor(context, part, contract.endpointPortB, 1),
    ],
    endpoints = initialEndpoints(part, contract, attachments, config.lengthM),
    restLengthM = config.lengthM / elementCount,
    totalMassKg = config.linearDensityKgPerM * config.lengthM,
    entityMassKg = totalMassKg / (elementCount + 1),
    entities = Array.from({ length: elementCount + 1 }, (_, index) => ({
      id: `flex:${part.id}:node:${index}`,
      sourcePartId: part.id,
      nodeIndex: index,
      massKg: entityMassKg,
      radiusM: config.diameterM / 2,
      positionWorldM: endpoints[0].map(
        (value, axis) =>
          value + ((endpoints[1][axis] - value) * index) / elementCount,
      ),
    })),
    internalEdges = Array.from({ length: elementCount }, (_, index) => ({
      id: `flex:${part.id}:edge:${index}`,
      sourcePartId: part.id,
      edgeIndex: index,
      entityAId: entities[index].id,
      entityBId: entities[index + 1].id,
      restLengthM,
      axialStiffnessNPerM: config.axialStiffnessNPerM,
      axialDampingNsPerM: config.axialDampingNsPerM,
      ultimateTensionN: config.ultimateTensionN,
    }));
  context.flexibleLines.push({
    id: `flexible-line:${part.id}`,
    kind: "flexible-line-v1",
    sourcePartId: part.id,
    lengthM: config.lengthM,
    diameterM: config.diameterM,
    materialKey: config.materialKey,
    totalMassKg,
    discretization: {
      kind: "flexible-line-discretization-v1",
      targetElementLengthM: config.targetElementLengthM,
      elementCount,
    },
    attachments: cloneCompiledValue(attachments),
    entities,
    internalEdges,
  });
}

export function compileFlexibleLines(context) {
  for (const part of context.parts) {
    const contract = componentDefinition(part, context.catalog)?.flexibleLine;
    if (contract?.kind === "flexible-line-v1")
      compileLine(context, part, contract);
  }
}
