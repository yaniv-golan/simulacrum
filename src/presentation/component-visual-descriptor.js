import { TYPES } from "../model/component-catalog.js";
import {
  geometryDescriptorForPart,
  geometryDescriptorForType,
} from "../model/geometry-descriptors.js";
import { resolveComponentConfig } from "../model/component-resolver.js";
import { deepFreeze } from "../model/primitives.js";

function finiteColor(value, label) {
  const color = Number(value);
  if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
    throw new Error(`${label} must be a 24-bit RGB integer`);
  return color;
}

export function componentVisualDescriptor(partOrType, customColor) {
  const authoredPart =
      partOrType && typeof partOrType === "object" ? partOrType : null,
    type = authoredPart?.type ?? partOrType,
    catalogEntry = TYPES[type];
  if (!catalogEntry)
    throw new Error(`Unknown component type "${String(type)}"`);
  const config = resolveComponentConfig(authoredPart || type),
    authoredColor = finiteColor(
      customColor ?? authoredPart?.customColor ?? catalogEntry.color,
      `${type} visual color`,
    );
  return deepFreeze({
    type,
    kind: "canonical-component-v2",
    color: authoredColor,
    customColor:
      customColor == null && authoredPart?.customColor == null
        ? null
        : authoredColor,
    lumens: Number(config.lumens || 0),
    powerWatts: Number(config.powerWatts || 0),
    geometry: authoredPart
      ? geometryDescriptorForPart(authoredPart)
      : geometryDescriptorForType(type),
  });
}

export const registeredComponentVisualTypes = Object.freeze(Object.keys(TYPES));
