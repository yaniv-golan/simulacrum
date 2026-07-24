import { DomainValidationError, immutableClone } from "./primitives.js";

const MATERIALS = Object.freeze({
  "nylon-rope": Object.freeze({
    id: "nylon-rope",
    name: "Braided nylon",
    densityKgPerM3: 1_140,
    packingFactor: 0.62,
    referenceDiameterM: 0.04,
    axialStiffnessNPerM: 120_000,
    axialDampingNsPerM: 90,
    ultimateStressPa: 48_000_000,
    contactMaterialKey: "nylon-rope",
    failureLaw: "maximum-tension-v1",
  }),
});

export const FLEXIBLE_LINE_MATERIALS = MATERIALS;

export function flexibleLineMaterial(id) {
  const material = MATERIALS[id];
  if (!material)
    throw new DomainValidationError(
      "UNKNOWN_FLEXIBLE_LINE_MATERIAL",
      `Unknown flexible-line material ${String(id)}`,
      { path: ["materialKey"] },
    );
  return immutableClone(material);
}

export function expandFlexibleLineMaterial(config) {
  const material = flexibleLineMaterial(config.materialKey),
    areaM2 = (Math.PI * config.diameterM ** 2) / 4,
    referenceAreaM2 = (Math.PI * material.referenceDiameterM ** 2) / 4,
    strengthN = material.ultimateStressPa * areaM2;
  return immutableClone({
    ...config,
    linearDensityKgPerM:
      material.densityKgPerM3 * material.packingFactor * areaM2,
    axialStiffnessNPerM:
      material.axialStiffnessNPerM * (areaM2 / referenceAreaM2),
    axialDampingNsPerM:
      material.axialDampingNsPerM * (areaM2 / referenceAreaM2),
    ultimateTensionN: strengthN * 0.62,
  });
}

export function validateFlexibleLineConfig(config, path = ["config"]) {
  const material = flexibleLineMaterial(config?.materialKey),
    areaM2 = (Math.PI * Number(config?.diameterM) ** 2) / 4,
    materialLimitN = material.ultimateStressPa * areaM2;
  if (Number(config?.ultimateTensionN) > materialLimitN)
    throw new DomainValidationError(
      "FLEXIBLE_LINE_STRENGTH_EXCEEDS_MATERIAL",
      "Rope break load cannot exceed the selected material stress limit",
      { path: [...path, "ultimateTensionN"] },
    );
  return immutableClone(config);
}
