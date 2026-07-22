import { actuatorChannels } from "./actuator-contracts.js";

/**
 * Derives the editor-facing capability index from one immutable compiler result.
 * Runtime availability remains a separate live-network concern.
 */
export function compiledAssemblyCapabilities(compiled, catalog) {
  return Object.freeze({
    wheels: compiled.contactRegions.some(
      (region) => region.kind === "rolling-contact-v1",
    ),
    articulation: compiled.constraints.some(
      (constraint) =>
        constraint.kind === "revolute" &&
        "controlled" in constraint &&
        constraint.controlled &&
        "sourcePartId" in constraint &&
        constraint.sourcePartId != null,
    ),
    commandChannelsByPart: new Map(
      compiled.parts
        .map((part) => [part.id, actuatorChannels(part, catalog)])
        .filter(([, channels]) => channels.length),
    ),
  });
}
