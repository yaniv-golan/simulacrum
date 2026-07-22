import { DomainValidationError } from "./primitives.js";

const pairKey = (left, right) => [left, right].sort().join("::");

const freezePair = (pair) =>
  Object.freeze({ ...pair, materials: Object.freeze([...pair.materials]) });

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
