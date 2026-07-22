export const BlueprintAcquisition = Object.freeze({
  LOCAL_AUTHORING: "LOCAL_AUTHORING",
  BUILT_IN: "BUILT_IN",
  FILE_IMPORT: "FILE_IMPORT",
  SHARE_IMPORT: "SHARE_IMPORT",
  UNKNOWN_UNTRUSTED: "UNKNOWN_UNTRUSTED",
});

const VALUES = new Set(Object.values(BlueprintAcquisition));

export function assertBlueprintAcquisition(value) {
  if (!VALUES.has(value))
    throw new TypeError(
      "Blueprint load requires an explicit acquisition boundary",
    );
  return value;
}

export function normalizeBlueprintAcquisition(value) {
  return VALUES.has(value) ? value : BlueprintAcquisition.UNKNOWN_UNTRUSTED;
}

export function acquisitionFromShareOrigin(origin) {
  if (origin === "local") return BlueprintAcquisition.LOCAL_AUTHORING;
  if (origin === "file") return BlueprintAcquisition.FILE_IMPORT;
  if (origin === "link") return BlueprintAcquisition.SHARE_IMPORT;
  return BlueprintAcquisition.UNKNOWN_UNTRUSTED;
}

export function requiresExplicitProgramTrust(acquisition) {
  return ![
    BlueprintAcquisition.LOCAL_AUTHORING,
    BlueprintAcquisition.BUILT_IN,
  ].includes(normalizeBlueprintAcquisition(acquisition));
}
