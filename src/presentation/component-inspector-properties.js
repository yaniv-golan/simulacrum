import { TYPES } from "../model/component-catalog.js";
import { materialMedium } from "../model/material-media.js";

const ARTICULATED_ROLES_BY_TYPE = Object.freeze({
  plate: ["pelvis", "torso", "footL", "footR"],
  beam: [
    "torso",
    "thighL",
    "thighR",
    "shinL",
    "shinR",
    "upperArmL",
    "upperArmR",
    "forearmL",
    "forearmR",
  ],
  sensor: ["head"],
  hinge: [
    "hipL",
    "hipR",
    "kneeL",
    "kneeR",
    "ankleL",
    "ankleR",
    "shoulderL",
    "shoulderR",
    "elbowL",
    "elbowR",
  ],
});

export function articulatedRolesForType(type) {
  return ARTICULATED_ROLES_BY_TYPE[type] || [];
}

/**
 * @typedef {[string, string, number, number, number, string, number?]} PropertySpec
 * @param {{type:string,config:Record<string,number|boolean|string>}} part
 * @returns {PropertySpec[]}
 */
export function componentInspectorProperties(part) {
  const type = TYPES[part.type];
  /** @type {PropertySpec[]} */
  const output = [];
  if ("rpm" in type)
    output.push(["RPM", "rpm", Number(part.config.rpm) || 0, 0, 600, "rpm"]);
  if ("power" in type)
    output.push([
      "POWER",
      "power",
      Number(part.config.power) || 0,
      0,
      100,
      "%",
    ]);
  if ("direction" in type)
    output.push([
      "DIRECTION",
      "direction",
      Number(part.config.direction) || 1,
      -1,
      1,
      "",
    ]);
  if ("angle" in type)
    output.push([
      "REST ANGLE",
      "angle",
      Number(part.config.angle) || 0,
      -90,
      90,
      "°",
    ]);
  if ("capacityWh" in type)
    output.push([
      "CAPACITY",
      "capacityWh",
      Number(part.config.capacityWh),
      0,
      200,
      "Wh",
    ]);
  if (type.flexibleLine) {
    output.push(
      [
        "CUT LENGTH",
        "lengthM",
        Number(part.config.lengthM),
        0.5,
        16,
        " m",
        0.05,
      ],
      [
        "DIAMETER",
        "diameterM",
        Number(part.config.diameterM),
        0.005,
        0.1,
        " m",
        0.001,
      ],
      [
        "LINEAR DENSITY",
        "linearDensityKgPerM",
        Number(part.config.linearDensityKgPerM),
        0.05,
        5,
        " kg/m",
        0.005,
      ],
      [
        "AXIAL STIFFNESS",
        "axialStiffnessNPerM",
        Number(part.config.axialStiffnessNPerM),
        1_000,
        1_000_000,
        " N/m",
        1_000,
      ],
      [
        "AXIAL DAMPING",
        "axialDampingNsPerM",
        Number(part.config.axialDampingNsPerM),
        0,
        1_000,
        " N·s/m",
        1,
      ],
      [
        "BREAK LOAD",
        "ultimateTensionN",
        Number(part.config.ultimateTensionN),
        100,
        100_000,
        " N",
        100,
      ],
      [
        "ELEMENT LENGTH",
        "targetElementLengthM",
        Number(part.config.targetElementLengthM),
        0.1,
        1,
        " m",
        0.05,
      ],
    );
  }
  return output;
}

const AUTHORABLE_MECHANISM_ROOTS = new Set([
  "actuation",
  "angleRangeRad",
  "commandLaw",
  "dampingLaw",
  "elasticLaw",
  "forceSpeedEnvelope",
  "friction",
  "guideFriction",
  "lengthRangeM",
  "lowerStop",
  "powerLaw",
  "referenceCoordinateM",
  "referenceLaw",
  "thermalLimits",
  "tireConstitutiveLaw",
  "travelRangeM",
  "unpoweredLaw",
  "upperStop",
]);

function mechanismUnit(path) {
  const key = String(path.at(-1));
  if (/pressurepa$/i.test(key)) return "Pa";
  if (/volumem3$/i.test(key)) return "m³";
  if (/aream2$/i.test(key)) return "m²";
  if (/temperaturek$/i.test(key)) return "K";
  if (/massjperk$/i.test(key)) return "J/K";
  if (/wperk$/i.test(key)) return "W/K";
  if (/nmsperrad$/i.test(key)) return "N·m·s/rad";
  if (/nmperrad$/i.test(key)) return "N·m/rad";
  if (/nms$/i.test(key)) return "N·m·s";
  if (/nm$/i.test(key)) return "N·m";
  if (/nsperm$/i.test(key)) return "N·s/m";
  if (/nperm$/i.test(key)) return "N/m";
  if (/mspers$/i.test(key)) return "m/s";
  if (/radpers$/i.test(key)) return "rad/s";
  if (/rad$/i.test(key)) return "rad";
  if (/force[n]?$/i.test(key) || /loadn$/i.test(key)) return "N";
  if (/powerw$/i.test(key) || /watts$/i.test(key)) return "W";
  if (/masskg$/i.test(key)) return "kg";
  if (/m$/i.test(key)) return "m";
  return "ratio";
}

function mechanismLabel(path) {
  return path
    .map((segment) =>
      typeof segment === "number"
        ? `POINT ${segment + 1}`
        : segment
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replaceAll("_", " ")
            .toUpperCase(),
    )
    .join(" · ");
}

/** Exact, SI-valued mechanism fields safe to edit independently. */
export function mechanismInspectorProperties(part) {
  const config = part?.mechanism?.config;
  if (!config || typeof config !== "object") return [];
  const fields = [];
  const visit = (value, path) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (!AUTHORABLE_MECHANISM_ROOTS.has(String(path[0]))) return;
      fields.push({
        path,
        pathKey: path.join("/"),
        label: mechanismLabel(path),
        unit: mechanismUnit(path),
        value,
        curvePoint: path.some((segment) => typeof segment === "number"),
        primary:
          path.join("/") ===
          "tireConstitutiveLaw/pneumaticChamber/initialColdGaugePressurePa",
      });
      return;
    }
    if (Array.isArray(value))
      value.forEach((child, index) => visit(child, [...path, index]));
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value))
        visit(child, [...path, key]);
  };
  for (const [key, value] of Object.entries(config)) visit(value, [key]);
  return fields;
}

export function componentLiveMeasurement(part, inspection) {
  if (part.type === "sensor")
    return `<br><strong id="sensor-live-rpm">MEASURED SHAFT SPEED · ${inspection.observation.specialized.measuredRpm.toFixed(1)} RPM</strong>`;
  if (part.type === "wheel" && Number.isFinite(part.tireGaugePressurePa)) {
    const maximumDeflectionM =
        part.mechanism?.config?.tireConstitutiveLaw?.normalModel
          ?.maximumDeflectionM || 0,
      rimMarginM = Math.max(
        0,
        maximumDeflectionM - Number(part.tireDeflectionM || 0),
      ),
      failure = part.tirePneumaticFailureMode
        ? ` · FAILURE ${part.tirePneumaticFailureMode}`
        : "";
    return `<br><strong id="tire-live-pressure" role="status">TIRE PRESSURE · ${(part.tireGaugePressurePa / 1000).toFixed(1)} kPa GAUGE · ${Number(part.tireGasTemperatureK || 0).toFixed(1)} K<br>GAS ${Number(part.tireGasMassKg || 0).toFixed(3)} kg · DEFLECTION ${(Number(part.tireDeflectionM || 0) * 1000).toFixed(1)} mm · RIM MARGIN ${(rimMarginM * 1000).toFixed(1)} mm<br>FLOW IN ${Number(part.tireMassInKg || 0).toFixed(4)} kg · OUT ${Number(part.tireMassOutKg || 0).toFixed(4)} kg · TRANSACTION #${Number(part.tirePneumaticTransactionId || 0)}${failure}</strong>`;
  }
  return "";
}

export function mechanismDisplayField(field, displayUnits) {
  if (displayUnits !== "engineering")
    return { value: field.value, unit: field.unit, factor: 1 };
  const conversions = {
      m: [1000, "mm"],
      N: [0.001, "kN"],
      "N/m": [0.001, "kN/m"],
      "N·m": [0.001, "kN·m"],
      W: [0.001, "kW"],
      Pa: [0.001, "kPa"],
    },
    [factor, unit] = conversions[field.unit] || [1, field.unit];
  return { value: field.value * factor, unit, factor };
}

export function pneumaticAuthoringSummary(part, ambientPressurePa = 101_325) {
  const chamber =
    part?.mechanism?.config?.tireConstitutiveLaw?.pneumaticChamber;
  if (!chamber) return null;
  const medium = materialMedium(chamber.mediumId),
    absolutePressurePa =
      Number(ambientPressurePa) + chamber.initialColdGaugePressurePa,
    gasMassKg =
      (absolutePressurePa * chamber.referenceInternalVolumeM3) /
      (medium.specificGasConstantJPerKgK * chamber.initialGasTemperatureK);
  return {
    absolutePressurePa,
    gasMassKg,
    internalVolumeM3: chamber.referenceInternalVolumeM3,
    minimumGaugePressurePa: chamber.limits.minimumGaugePressurePa,
    maximumWorkingGaugePressurePa:
      chamber.limits.maximumAbsolutePressurePa - Number(ambientPressurePa),
    burstGaugePressurePa:
      chamber.limits.burstAbsolutePressurePa - Number(ambientPressurePa),
  };
}
