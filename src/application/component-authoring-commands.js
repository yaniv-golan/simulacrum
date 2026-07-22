import { resolveComponentConfig } from "../model/component-resolver.js";
import { decodeMechanismAuthoredComponentOrThrow } from "../model/mechanism-authored-components.js";
import { errorMessage } from "../model/primitives.js";

export function configureComponentPart(part, patch) {
  part.config = resolveComponentConfig(part.type, {
    ...part.config,
    ...patch,
  });
  if (part.type === "battery" && Object.hasOwn(patch, "capacityWh"))
    part.storedEnergyWh = Math.min(
      Number(part.storedEnergyWh),
      Number(part.config.capacityWh),
    );
}

/** Applies one exact field only after the complete authored contract validates. */
export function configureAuthoredMechanism(part, path, value) {
  const candidate = structuredClone(part.mechanism);
  let target = candidate?.config;
  for (const segment of path.slice(0, -1)) {
    if (!target || typeof target !== "object")
      return {
        ok: false,
        code: "UNKNOWN_MECHANISM_FIELD",
        message: "Mechanism field path does not exist",
        path,
      };
    target = target[segment];
  }
  target[path.at(-1)] = value;
  try {
    part.mechanism = structuredClone(
      decodeMechanismAuthoredComponentOrThrow(candidate).wire,
    );
    part.mechanismAuthoringDiagnostic = null;
    return { ok: true };
  } catch (error) {
    const domainError =
        /** @type {{code?:string,path?:Array<string|number>}} */ (error),
      diagnostic = {
        code: domainError.code || "INVALID_MECHANISM_VALUE",
        message: errorMessage(error),
        path: domainError.path || path,
      };
    part.mechanismAuthoringDiagnostic = diagnostic;
    return { ok: false, ...diagnostic };
  }
}
