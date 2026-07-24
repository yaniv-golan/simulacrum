import { resolveComponentConfig } from "../model/component-resolver.js";
import { TYPES } from "../model/component-catalog.js";
import { decodeMechanismAuthoredComponentOrThrow } from "../model/mechanism-authored-components.js";
import { errorMessage } from "../model/primitives.js";
import { expandFlexibleLineMaterial } from "../model/flexible-line-materials.js";

/** Binds the stock Rope action to an editor bridge initialized by composition. */
export function connectSelectedWithRope(bridge) {
  return (partIds, extraSlackM) =>
    Boolean(
      bridge.editor?.addTwoEndedComponent({
        type: "rope",
        endpointPorts: ["END_A", "END_B"],
        targets: partIds.map((partId) => ({ partId })),
        extraSlackM,
      }),
    );
}

export function configureComponentPart(part, patch) {
  let next = resolveComponentConfig(part.type, {
    ...part.config,
    ...patch,
  });
  if (
    TYPES[part.type]?.flexibleLine?.kind === "flexible-line-v1" &&
    (Object.hasOwn(patch, "diameterM") || Object.hasOwn(patch, "materialKey"))
  )
    next = expandFlexibleLineMaterial(next);
  part.config = next;
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
