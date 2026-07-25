import { TYPES } from "./component-catalog.js";
import { componentDefaults } from "./component-resolver.js";
import { isMechanismComponentType } from "./mechanism-component-definitions.js";

const PROPERTY_SCHEMAS = Object.freeze({
  mass: { type: "number", exclusiveMinimum: 0 },
  size: { $ref: "#/$defs/vector3" },
  payload: { type: "boolean" },
  noseRadius: { type: "number", minimum: 0 },
  heatLimit: { type: "number", minimum: 0 },
  pyrolysisTemperatureK: { type: "number", minimum: 0 },
  heatOfAblationJkg: { type: "number", minimum: 0 },
  liftSlope: { type: "number" },
  rpm: { type: "number" },
  teeth: { type: "number", exclusiveMinimum: 0 },
  radius: { type: "number", exclusiveMinimum: 0 },
  power: { type: "number", minimum: 0 },
  direction: { type: "number", enum: [-1, 1] },
  angle: { type: "number" },
  channel: { $ref: "#/$defs/identifier" },
  readings: {
    type: "array",
    items: { $ref: "#/$defs/identifier" },
    uniqueItems: true,
  },
  sensingAxis: { $ref: "#/$defs/vector3" },
  emitterOffsetM: { $ref: "#/$defs/vector3" },
  fieldOfViewDeg: {
    type: "number",
    exclusiveMinimum: 0,
    exclusiveMaximum: 180,
  },
  maximumRangeM: { type: "number", exclusiveMinimum: 0 },
  rangeResolutionM: { type: "number", exclusiveMinimum: 0 },
  maxTorqueNm: { type: "number", minimum: 0 },
  momentumCapacityNms: { type: "number", minimum: 0 },
  capacityWh: { type: "number", minimum: 0 },
  maxOutputWatts: { type: "number", minimum: 0 },
  dischargeEfficiency: {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 1,
  },
  electricalEfficiency: {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 1,
  },
  lumens: { type: "number", minimum: 0 },
  powerWatts: { type: "number", minimum: 0 },
  maximumMassFlowKgS: { type: "number", exclusiveMinimum: 0 },
  exitAreaM2: { type: "number", exclusiveMinimum: 0 },
  throttleTimeConstantS: { type: "number", exclusiveMinimum: 0 },
  minimumStableThrottle: {
    type: "number",
    exclusiveMinimum: 0,
    exclusiveMaximum: 1,
  },
  thermalLossFraction: {
    type: "number",
    minimum: 0,
    exclusiveMaximum: 1,
  },
  capacityKg: { type: "number", exclusiveMinimum: 0 },
  initialUsableMassKg: { type: "number", minimum: 0 },
  lengthM: { type: "number", exclusiveMinimum: 0 },
  diameterM: { type: "number", exclusiveMinimum: 0 },
  linearDensityKgPerM: { type: "number", exclusiveMinimum: 0 },
  axialStiffnessNPerM: { type: "number", exclusiveMinimum: 0 },
  axialDampingNsPerM: { type: "number", minimum: 0 },
  ultimateTensionN: { type: "number", exclusiveMinimum: 0 },
  targetElementLengthM: { type: "number", exclusiveMinimum: 0 },
  materialKey: { $ref: "#/$defs/identifier" },
  hubRadiusM: { type: "number", exclusiveMinimum: 0 },
  hubThicknessM: { type: "number", exclusiveMinimum: 0 },
  radiusM: { type: "number", exclusiveMinimum: 0 },
  bladeCount: { type: "integer", minimum: 2, maximum: 8 },
  bladeChordM: { type: "number", exclusiveMinimum: 0 },
  fixedPitchDeg: { type: "number", minimum: 2, maximum: 35 },
  handedness: { type: "integer", enum: [-1, 1] },
  profileId: { $ref: "#/$defs/identifier" },
  ratedRpm: { type: "number", exclusiveMinimum: 0 },
  maximumRpm: { type: "number", exclusiveMinimum: 0 },
});

export function componentConfigKeys(type) {
  if (!Object.hasOwn(TYPES, type)) return Object.freeze([]);
  return Object.freeze(Object.keys(componentDefaults(type)).sort());
}

export function componentConfigSchema(type) {
  const defaults = componentDefaults(type),
    keys = Object.keys(defaults).sort(),
    properties = {};
  for (const key of keys) {
    const schema = PROPERTY_SCHEMAS[key];
    if (!schema)
      throw new Error(
        `Component ${type} behavior property ${key} has no wire schema`,
      );
    properties[key] = { ...structuredClone(schema), default: defaults[key] };
  }
  return Object.freeze({
    type: "object",
    required: keys,
    properties,
    additionalProperties: false,
  });
}

/** Builds the catalog-discriminated part union consumed by schema generation. */
export function componentPartUnionSchema(basePartSchema) {
  const variants = Object.keys(TYPES)
    .sort()
    .map((type) => {
      const variant = structuredClone(basePartSchema);
      variant.properties.type = { const: type };
      if (isMechanismComponentType(type)) {
        variant.required = variant.required.filter((key) => key !== "config");
        variant.required.push("mechanism");
        delete variant.properties.config;
        variant.properties.mechanism = {
          type: "object",
          required: ["componentType"],
          properties: { componentType: { const: type } },
        };
      } else {
        variant.properties.config = componentConfigSchema(type);
        delete variant.properties.mechanism;
      }
      if (type === "computer")
        variant.required.push(
          "scriptLanguage",
          "scriptSources",
          "controllerBindings",
        );
      else {
        delete variant.properties.scriptLanguage;
        delete variant.properties.scriptSources;
        delete variant.properties.controllerBindings;
      }
      if (type === "battery") variant.required.push("storedEnergyWh");
      else delete variant.properties.storedEnergyWh;
      return variant;
    });
  return Object.freeze({
    type: "object",
    discriminator: { propertyName: "type" },
    oneOf: variants,
  });
}

export function assertResolvedComponentConfig(type, config) {
  const expected = componentConfigKeys(type),
    actual = Object.keys(config || {}).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, index) => key !== actual[index])
  )
    throw new Error(
      `Component ${type} config keys must be exactly ${expected.join(", ")}`,
    );
}
