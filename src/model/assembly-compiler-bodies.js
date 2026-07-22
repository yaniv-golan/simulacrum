import { componentDefinition } from "./component-contracts.js";
import { compilePartCapabilities } from "./assembly-compiler-capabilities.js";
import { composePointMasses } from "./assembly-compiler-mass-properties.js";
import {
  cloneCompiledValue,
  compiledVector,
  orientationFor,
} from "./assembly-compiler-shared.js";

function compileContactRegions(context, part, geometry) {
  for (const region of geometry.collisionRegions || [])
    if (region.contactRole === "tire-envelope")
      context.contactRegions.push({
        id: `contact:${part.id}:${region.semanticKey}`,
        kind: "rolling-contact-v1",
        sourcePartId: part.id,
        bodyId: `body:${part.id}`,
        regionId: region.id,
        localAxleAxis: [0, 0, 1],
        radiusM: part.mechanism.config.radiusM,
        widthM: part.mechanism.config.widthM,
        shoulderRadiusM: part.mechanism.config.shoulderRadiusM,
        semanticRegions: cloneCompiledValue(geometry.collisionRegions),
        tireConstitutiveLaw: cloneCompiledValue(
          part.mechanism.config.tireConstitutiveLaw,
        ),
      });
}

export function compileBodies(context) {
  for (const part of context.parts) {
    if (context.forceElementParts.has(part.id)) continue;
    const definition = componentDefinition(part, context.catalog) || {},
      geometry = context.geometryFor(part),
      massProperties = composePointMasses(
        geometry.massProperties,
        context.endpointPointMasses.get(part.id) || [],
      ),
      mass = massProperties.massKg;
    context.bodies.push({
      id: `body:${part.id}`,
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
        id: `actuator:${part.id}`,
        sourcePartId: part.id,
        ...cloneCompiledValue(definition.actuator),
      });
  }
}
