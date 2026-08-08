import { componentDefinition } from "./component-contracts.js";
import { compilePartCapabilities } from "./assembly-compiler-capabilities.js";
import { composePointMasses } from "./assembly-compiler-mass-properties.js";
import {
  cloneCompiledValue,
  compiledPortDefinition,
  compiledVector,
  orientationFor,
  PHYSICAL_CONNECTION_KINDS,
} from "./assembly-compiler-shared.js";

function connectionMatchesPointMass(connection, point) {
  const forward =
      connection?.a === point.sourcePartId &&
      connection?.portA === point.sourcePortId &&
      connection?.b === point.targetPartId &&
      connection?.portB === point.targetPortId,
    reverse =
      connection?.b === point.sourcePartId &&
      connection?.portB === point.sourcePortId &&
      connection?.a === point.targetPartId &&
      connection?.portA === point.targetPortId;
  return forward || reverse;
}

function pointMassConnectionIsAuthoritative(context, part, point, connection) {
  return Boolean(
    point.targetPartId === part.id &&
    point.positionFramePartId === part.id &&
    connection &&
    PHYSICAL_CONNECTION_KINDS.has(connection.kind) &&
    !context.rejectedConnectionIds.has(connection.id) &&
    !connection.failed &&
    context.forceElementParts.has(point.sourcePartId) &&
    connectionMatchesPointMass(connection, point),
  );
}

function expectedPointMassPosition(context, part, point, connection) {
  const targetIsA = connection.a === part.id,
    targetPort = compiledPortDefinition(
      part,
      point.targetPortId,
      context.catalog,
    ),
    structuralAnchor =
      targetPort.behavior === "structural-surface"
        ? targetIsA
          ? connection.anchorA
          : connection.anchorB
        : null;
  return compiledVector(
    structuralAnchor ??
      context.geometryFor(part).portFrames[point.targetPortId].framePart
        .positionM,
  );
}

function sameVector(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateEndpointPointMassTopology(context, part, pointMasses) {
  const seenConnections = new Set();
  for (const point of pointMasses) {
    const connection = context.connections.find(
      (candidate) => candidate.id === point.sourceConnectionId,
    );
    if (
      seenConnections.has(point.sourceConnectionId) ||
      !pointMassConnectionIsAuthoritative(context, part, point, connection)
    )
      throw new TypeError(
        `endpoint point mass ${String(point.sourceConnectionId)} has contradictory compiled topology`,
      );
    const expectedPosition = expectedPointMassPosition(
      context,
      part,
      point,
      connection,
    );
    if (!sameVector(point.positionPartM, expectedPosition))
      throw new TypeError(
        `endpoint point mass ${String(point.sourceConnectionId)} has contradictory position-frame authority`,
      );
    seenConnections.add(point.sourceConnectionId);
  }
}

function compileContactRegions(context, part, geometry) {
  for (const region of geometry.collisionPrimitives)
    if (region.contactRole === "tire-envelope")
      context.contactRegions.push({
        id: `${context.partScopedId("contact", part.id)}:${region.semanticKey}`,
        kind: "rolling-contact-v1",
        sourcePartId: part.id,
        bodyId: context.partScopedId("body", part.id),
        regionId: region.id,
        localAxleAxis: [0, 0, 1],
        radiusM: part.mechanism.config.radiusM,
        widthM: part.mechanism.config.widthM,
        shoulderRadiusM: part.mechanism.config.shoulderRadiusM,
        semanticRegions: cloneCompiledValue(region.semanticRegions),
        tireConstitutiveLaw: cloneCompiledValue(
          part.mechanism.config.tireConstitutiveLaw,
        ),
      });
}

export function compileBodies(context) {
  for (const part of context.parts) {
    if (
      context.forceElementParts.has(part.id) ||
      context.flexibleLineParts.has(part.id)
    )
      continue;
    const definition = componentDefinition(part, context.catalog) || {},
      geometry = context.geometryFor(part),
      endpointPointMasses = context.endpointPointMasses.get(part.id) || [];
    if (Object.hasOwn(geometry.massProperties, "endpointPointMasses"))
      throw new TypeError(
        `part ${String(part.id)} geometry cannot pre-author compiled endpoint point-mass provenance`,
      );
    validateEndpointPointMassTopology(context, part, endpointPointMasses);
    const massProperties = composePointMasses(
        geometry.massProperties,
        endpointPointMasses,
      ),
      mass = massProperties.massKg;
    context.bodies.push({
      id: context.partScopedId("body", part.id),
      partId: part.id,
      type: part.type,
      mass,
      massProperties,
      position: compiledVector(part.pos),
      orientation: orientationFor(part),
      geometry,
      capabilities: compilePartCapabilities(
        part,
        definition,
        geometry,
        context.catalog,
      ),
      linearDamping: part.config?.linearDamping ?? 0.04,
      angularDamping: part.config?.angularDamping ?? 0.08,
    });
    compileContactRegions(context, part, geometry);
    if (definition.actuator)
      context.actuators.push({
        id: context.partScopedId("actuator", part.id),
        sourcePartId: part.id,
        ...cloneCompiledValue(definition.actuator),
      });
  }
}
