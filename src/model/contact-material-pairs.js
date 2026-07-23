import { DomainValidationError } from "./primitives.js";

const pairKey = (left, right) => [left, right].sort().join("::");

const SUPPORT_RESPONSE = Object.freeze({
  "workshop-steel": [null, 0, 1],
  "workshop-aluminum": [null, 0, 1],
  "tire-rubber": [null, 0, 1],
  "compacted-soil": [2_400_000, 0.04, 1.8],
  "dry-asphalt": [null, 0, 0.9],
  "wet-asphalt": [null, 0, 0.95],
  "short-grass": [1_400_000, 0.06, 2.2],
  "loose-gravel": [1_000_000, 0.08, 2.8],
  "dry-sand": [450_000, 0.14, 4.5],
  "saturated-mud": [250_000, 0.18, 5.5],
  "low-grip-polymer": [null, 0, 1.1],
  "natural-terrain": [1_600_000, 0.05, 1.9],
  "generic-ground": [null, 0, 1.2],
  "generic-structure": [null, 0, 1],
  "weathered-concrete": [null, 0, 0.95],
  "wood-bark": [null, 0, 1.3],
  "weathered-stone": [null, 0, 1.2],
});

const freezePair = (pair) => {
  const supportMaterial = pair.materials.find(
      (material) => material !== "tire-rubber",
    ),
    response = SUPPORT_RESPONSE[supportMaterial || "tire-rubber"];
  if (!response)
    throw new Error(`Missing tire support response for ${supportMaterial}`);
  return Object.freeze({
    ...pair,
    materials: Object.freeze([...pair.materials]),
    foundationStiffnessNPerM: response[0],
    maximumSinkageM: response[1],
    rollingResistanceMultiplier: response[2],
  });
};

export function supportMaterialResponse(materialKey) {
  const response = SUPPORT_RESPONSE[materialKey];
  if (!response)
    throw new DomainValidationError(
      "UNKNOWN_SUPPORT_MATERIAL",
      `No foundation response is authored for ${materialKey}`,
      { path: ["supportMaterialResponse", materialKey] },
    );
  return Object.freeze({
    foundationStiffnessNPerM: response[0],
    maximumSinkageM: response[1],
    rollingResistanceMultiplier: response[2],
  });
}

const pairs = new Map(
  [
    {
      materials: ["tire-rubber", "workshop-steel"],
      longitudinalFrictionCoefficient: 0.92,
      lateralFrictionCoefficient: 0.84,
      restitutionCoefficient: 0.01,
    },
    {
      materials: ["tire-rubber", "workshop-aluminum"],
      longitudinalFrictionCoefficient: 0.78,
      lateralFrictionCoefficient: 0.7,
      restitutionCoefficient: 0.015,
    },
    {
      materials: ["tire-rubber", "tire-rubber"],
      longitudinalFrictionCoefficient: 1.05,
      lateralFrictionCoefficient: 0.95,
      restitutionCoefficient: 0.02,
    },
    {
      materials: ["compacted-soil", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.78,
      lateralFrictionCoefficient: 0.7,
      restitutionCoefficient: 0,
    },
    {
      materials: ["dry-asphalt", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.96,
      lateralFrictionCoefficient: 0.88,
      restitutionCoefficient: 0.01,
    },
    {
      materials: ["wet-asphalt", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.62,
      lateralFrictionCoefficient: 0.56,
      restitutionCoefficient: 0.005,
    },
    {
      materials: ["short-grass", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.58,
      lateralFrictionCoefficient: 0.52,
      restitutionCoefficient: 0,
    },
    {
      materials: ["loose-gravel", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.54,
      lateralFrictionCoefficient: 0.48,
      restitutionCoefficient: 0.015,
    },
    {
      materials: ["dry-sand", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.42,
      lateralFrictionCoefficient: 0.38,
      restitutionCoefficient: 0,
    },
    {
      materials: ["saturated-mud", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.32,
      lateralFrictionCoefficient: 0.28,
      restitutionCoefficient: 0,
    },
    {
      materials: ["low-grip-polymer", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.18,
      lateralFrictionCoefficient: 0.16,
      restitutionCoefficient: 0.005,
    },
    {
      materials: ["natural-terrain", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.72,
      lateralFrictionCoefficient: 0.65,
      restitutionCoefficient: 0,
    },
    {
      materials: ["generic-ground", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.82,
      lateralFrictionCoefficient: 0.74,
      restitutionCoefficient: 0.01,
    },
    {
      materials: ["generic-structure", "tire-rubber"],
      longitudinalFrictionCoefficient: 0.68,
      lateralFrictionCoefficient: 0.62,
      restitutionCoefficient: 0.02,
    },
    {
      materials: ["tire-rubber", "weathered-concrete"],
      longitudinalFrictionCoefficient: 0.9,
      lateralFrictionCoefficient: 0.82,
      restitutionCoefficient: 0.01,
    },
    {
      materials: ["tire-rubber", "wood-bark"],
      longitudinalFrictionCoefficient: 0.65,
      lateralFrictionCoefficient: 0.58,
      restitutionCoefficient: 0.02,
    },
    {
      materials: ["tire-rubber", "weathered-stone"],
      longitudinalFrictionCoefficient: 0.8,
      lateralFrictionCoefficient: 0.72,
      restitutionCoefficient: 0.01,
    },
  ].map((pair) => [pairKey(...pair.materials), freezePair(pair)]),
);

/**
 * Resolves the symmetric physical law for a pair of authored contact
 * materials. Every participant must carry an explicit material identity; a
 * missing identity or unknown named pair is an error, never an implicit
 * coefficient.
 */
export function contactMaterialPair(leftMaterialKey, rightMaterialKey) {
  if (!leftMaterialKey || !rightMaterialKey)
    throw new DomainValidationError(
      "MISSING_CONTACT_MATERIAL_IDENTITY",
      "Both contact participants require an explicit material identity",
      { path: ["contactMaterialPair"] },
    );
  const pair = pairs.get(pairKey(leftMaterialKey, rightMaterialKey));
  if (!pair)
    throw new DomainValidationError(
      "UNKNOWN_CONTACT_MATERIAL_PAIR",
      `No contact material pair is authored for ${leftMaterialKey} and ${rightMaterialKey}`,
      { path: ["contactMaterialPair", leftMaterialKey, rightMaterialKey] },
    );
  return pair;
}

export const CONTACT_MATERIAL_PAIRS = Object.freeze([...pairs.values()]);
