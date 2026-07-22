import { DomainValidationError, immutableClone } from "./primitives.js";

const MEDIA = Object.freeze({
  "hydrogen-peroxide-90-v1": Object.freeze({
    id: "hydrogen-peroxide-90-v1",
    name: "90% hydrogen peroxide monopropellant",
    densityKgM3: 1_390,
    specificAvailableEnergyJkg: 2_700_000,
  }),
});

/** Returns the immutable physical properties for one declared medium. */
export function materialMedium(mediumId) {
  const medium = MEDIA[String(mediumId || "")];
  if (!medium)
    throw new DomainValidationError(
      "UNKNOWN_MATERIAL_MEDIUM",
      `Unknown material medium ${String(mediumId)}`,
      { details: { mediumId } },
    );
  return immutableClone(medium);
}

export const MATERIAL_MEDIA = MEDIA;
