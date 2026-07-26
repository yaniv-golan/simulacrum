import { DomainValidationError } from "./primitives.js";
import { cloneCompiledValue } from "./assembly-compiler-shared.js";
import { materialStoreContract } from "./material-resource-contracts.js";
import { pressureNozzleContract } from "./pressure-nozzle-contracts.js";
import {
  componentPneumaticContract,
  componentPorts,
} from "./component-contracts.js";
import { rotorAerodynamicContract } from "./rotor-aerodynamics-contracts.js";
import { rangeSensorContract } from "./range-sensor-contracts.js";

const ACTUATOR_CAPABILITY_COMPILERS = new Map([
  ["rotary-actuator-v1", ({ kind }) => ({ kind })],
  ["linear-actuator-v1", ({ kind }) => ({ kind })],
  ["luminaire-v1", (descriptor) => cloneCompiledValue(descriptor)],
]);

const PROPULSION_CAPABILITY_COMPILERS = new Map([
  ["pressure-nozzle-v1", pressureNozzleContract],
  ["shaft-rotor-aerodynamics-v1", rotorAerodynamicContract],
]);

function compilePropulsion(part, definition, geometry, catalog) {
  const descriptor = definition.flight?.propulsion;
  if (!descriptor) return null;
  const compiler = PROPULSION_CAPABILITY_COMPILERS.get(descriptor.kind);
  if (!compiler)
    throw new DomainValidationError(
      "UNKNOWN_COMPILED_CAPABILITY",
      `Unknown propulsion capability kind ${String(descriptor.kind)}.`,
      { path: ["parts", part.id, "propulsion", "kind"] },
    );
  return compiler(part, definition, geometry, catalog);
}

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

function pneumaticValue(part, descriptor, fieldName) {
  return Number(part.config?.[descriptor[fieldName]]);
}

function invalidPressureRatioMap(map) {
  if (!Array.isArray(map) || map.length < 2) return true;
  return map.some((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) return true;
    const pressureRatio = Number(point[0]),
      flowFraction = Number(point[1]),
      previousRatio = index ? Number(map[index - 1][0]) : 0;
    return (
      !Number.isFinite(pressureRatio) ||
      !Number.isFinite(flowFraction) ||
      pressureRatio < 1 ||
      flowFraction < 0 ||
      flowFraction > 1 ||
      pressureRatio <= previousRatio
    );
  });
}

function validateCompressor(part, descriptor) {
  const value = (field) => pneumaticValue(part, descriptor, field),
    values = {
      maximumGaugePressurePa: value("maximumGaugePressureField"),
      maximumMassFlowKgS: value("maximumMassFlowField"),
      electricalPowerW: value("electricalPowerField"),
      electricalEfficiency: value("electricalEfficiencyField"),
      responseTimeS: value("responseTimeField"),
      reliefAbsolutePressurePa: value("reliefAbsolutePressureField"),
      motorThermalMassJPerK: value("motorThermalMassField"),
      motorCoolingWPerK: value("motorCoolingField"),
      maximumMotorTemperatureK: value("maximumMotorTemperatureField"),
    },
    invalid =
      Object.values(values).some((entry) => !Number.isFinite(entry)) ||
      values.maximumGaugePressurePa <= 0 ||
      values.maximumMassFlowKgS <= 0 ||
      values.electricalPowerW <= 0 ||
      values.electricalEfficiency <= 0 ||
      values.electricalEfficiency > 1 ||
      values.responseTimeS <= 0 ||
      values.reliefAbsolutePressurePa <= 101_325 ||
      values.motorThermalMassJPerK <= 0 ||
      values.motorCoolingWPerK < 0 ||
      values.maximumMotorTemperatureK <= 293.15 ||
      invalidPressureRatioMap(
        part.config?.[descriptor.pressureRatioFlowMapField],
      );
  if (invalid)
    throw new DomainValidationError(
      "INVALID_PNEUMATIC_COMPRESSOR",
      `Part ${String(part.id)} has an invalid pneumatic compressor contract`,
      { path: ["parts", part.id, "config"] },
    );
}

function validateValve(part, descriptor) {
  const value = (field) => pneumaticValue(part, descriptor, field),
    values = {
      orificeAreaM2: value("orificeAreaField"),
      dischargeCoefficient: value("dischargeCoefficientField"),
      electricalPowerW: value("electricalPowerField"),
      openingTimeS: value("openingTimeField"),
      deadband: value("deadbandField"),
      leakageAreaM2: value("leakageAreaField"),
      failPosition: value("failPositionField"),
    },
    invalid =
      Object.values(values).some((entry) => !Number.isFinite(entry)) ||
      values.orificeAreaM2 <= 0 ||
      values.dischargeCoefficient <= 0 ||
      values.dischargeCoefficient > 1 ||
      values.electricalPowerW <= 0 ||
      values.openingTimeS <= 0 ||
      values.deadband < 0 ||
      values.deadband >= 1 ||
      values.leakageAreaM2 < 0 ||
      values.leakageAreaM2 > values.orificeAreaM2 ||
      Math.abs(values.failPosition) > 1;
  if (invalid)
    throw new DomainValidationError(
      "INVALID_PNEUMATIC_VALVE",
      `Part ${String(part.id)} has an invalid pneumatic valve contract`,
      { path: ["parts", part.id, "config"] },
    );
}

function validateControlVolume(part, descriptor) {
  const value = (field) => pneumaticValue(part, descriptor, field),
    volumeM3 = value("volumeField"),
    initialGaugePressurePa = value("initialGaugePressureField"),
    initialTemperatureK = value("initialTemperatureField"),
    conductanceWPerK = value("gasToShellConductanceField"),
    maximumAbsolutePressurePa = value("maximumAbsolutePressureField"),
    burstAbsolutePressurePa = value("burstAbsolutePressureField");
  if (
    !Number.isFinite(volumeM3) ||
    volumeM3 <= 0 ||
    !Number.isFinite(initialGaugePressurePa) ||
    101_325 + initialGaugePressurePa <= 0 ||
    !Number.isFinite(initialTemperatureK) ||
    initialTemperatureK <= 0 ||
    !Number.isFinite(conductanceWPerK) ||
    conductanceWPerK < 0 ||
    !Number.isFinite(maximumAbsolutePressurePa) ||
    maximumAbsolutePressurePa <= 0 ||
    !Number.isFinite(burstAbsolutePressurePa) ||
    maximumAbsolutePressurePa >= burstAbsolutePressurePa ||
    101_325 + initialGaugePressurePa > maximumAbsolutePressurePa
  )
    throw new DomainValidationError(
      "INVALID_PNEUMATIC_CONTROL_VOLUME",
      `Part ${String(part.id)} has an invalid pneumatic control-volume contract`,
      { path: ["parts", part.id, "config"] },
    );
}

function compiledPneumaticDevice(part, descriptor) {
  if (!descriptor) return null;
  const compiled = {
    ...cloneCompiledValue(descriptor),
    config: cloneCompiledValue(part.config || {}),
  };
  if (descriptor.kind === "ambient-air-compressor-v1")
    validateCompressor(part, descriptor);
  else if (descriptor.kind === "three-way-valve-v1")
    validateValve(part, descriptor);
  else if (descriptor.kind === "ideal-gas-control-volume-v1")
    validateControlVolume(part, descriptor);
  return compiled;
}

export function compilePartCapabilities(part, definition, geometry, catalog) {
  const authoredActuator = part.mechanism?.config?.actuation
      ? { kind: "rotary-actuator-v1" }
      : part.mechanism?.config?.commandLaw
        ? { kind: "linear-actuator-v1" }
        : definition.actuator || null,
    context = { part, definition },
    measurement = rangeSensorContract(part, definition, catalog),
    pneumaticContract = componentPneumaticContract(part, catalog),
    pneumaticChamber =
      part.mechanism?.config?.tireConstitutiveLaw?.pneumaticChamber;
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
    propulsion: compilePropulsion(part, definition, geometry, catalog),
    materialStore: materialStoreContract(part, catalog, geometry),
    materialPorts: componentPorts(part, catalog)
      .filter(
        (port) =>
          port.kind === "resource" && port.behavior === "material-resource",
      )
      .map((port) => ({
        id: port.id,
        mediumId: port.mediumId,
        direction: port.direction,
        multiplicity: port.multiplicity,
      })),
    pneumatic: pneumaticChamber
      ? {
          kind: "tire-chamber-v1",
          chamber: cloneCompiledValue(pneumaticChamber),
        }
      : pneumaticContract
        ? compiledPneumaticDevice(part, pneumaticContract)
        : null,
    aerodynamics: {
      surfaces: cloneCompiledValue(geometry.aerodynamicSurfaces || []),
    },
    aerothermal: cloneCompiledValue(geometry.aerothermal),
  };
}
