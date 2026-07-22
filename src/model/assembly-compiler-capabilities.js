import { DomainValidationError } from "./primitives.js";
import { cloneCompiledValue } from "./assembly-compiler-shared.js";
import { materialStoreContract } from "./material-resource-contracts.js";
import { pressureNozzleContract } from "./pressure-nozzle-contracts.js";
import { componentPorts } from "./component-contracts.js";
import { rangeSensorContract } from "./range-sensor-contracts.js";

const ACTUATOR_CAPABILITY_COMPILERS = new Map([
  ["rotary-actuator-v1", ({ kind }) => ({ kind })],
  ["linear-actuator-v1", ({ kind }) => ({ kind })],
  ["luminaire-v1", (descriptor) => cloneCompiledValue(descriptor)],
]);

function compileRegistered(registry, descriptor, family, context) {
  if (!descriptor) return null;
  const compiler = registry.get(descriptor.kind);
  if (!compiler)
    throw new DomainValidationError(
      "UNKNOWN_COMPILED_CAPABILITY",
      `Unknown ${family} capability kind ${descriptor.kind}.`,
      {
        path: ["parts", context.part.id, family, "kind"],
        details: { family, kind: descriptor.kind },
      },
    );
  return compiler(descriptor, context);
}

export function compilePartCapabilities(part, definition, geometry, catalog) {
  const authoredActuator = part.mechanism?.config?.actuation
      ? { kind: "rotary-actuator-v1" }
      : part.mechanism?.config?.commandLaw
        ? { kind: "linear-actuator-v1" }
        : definition.actuator || null,
    context = { part, definition },
    measurement = rangeSensorContract(part, definition, catalog);
  return {
    actuator: compileRegistered(
      ACTUATOR_CAPABILITY_COMPILERS,
      authoredActuator,
      "actuator",
      context,
    ),
    sensor:
      Array.isArray(definition.readings) && definition.readings.length
        ? {
            readings: [...definition.readings],
            ...(measurement ? { measurement } : {}),
          }
        : null,
    controller: part.scriptSources
      ? {
          kind: "program-controller-v1",
          bindings: cloneCompiledValue(part.controllerBindings),
        }
      : null,
    propulsion: pressureNozzleContract(part, definition, geometry, catalog),
    materialStore: materialStoreContract(part, catalog, geometry),
    materialPorts: componentPorts(part, catalog)
      .filter((port) => port.kind === "resource")
      .map((port) => ({
        id: port.id,
        mediumId: port.mediumId,
        direction: port.direction,
        multiplicity: port.multiplicity,
      })),
    aerodynamics: {
      surfaces: cloneCompiledValue(geometry.aerodynamicSurfaces || []),
    },
    aerothermal: cloneCompiledValue(geometry.aerothermal),
  };
}
