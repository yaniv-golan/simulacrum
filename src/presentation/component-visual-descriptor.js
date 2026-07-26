import { TYPES } from "../model/component-catalog.js";
import { geometryDescriptorForType } from "../model/geometry-descriptors.js";
import { deepFreeze } from "../model/primitives.js";

const GENERIC_VISUAL_TYPES = new Set([
  "receiver",
  "navsensor",
  "powerbus",
  "aircompressor",
  "airreservoir",
  "pneumaticvalve",
  "tirepressureprobe",
]);

function finiteColor(value, label) {
  const color = Number(value);
  if (!Number.isInteger(color) || color < 0 || color > 0xffffff)
    throw new Error(`${label} must be a 24-bit RGB integer`);
  return color;
}

/**
 * Presentation-owned, engine-neutral description of how one catalog component
 * selects a visual builder. Physical dimensions remain owned by the canonical
 * model geometry descriptor; this projection only carries authored appearance
 * inputs required by a registered builder.
 * @param {string} type
 * @param {number | null | undefined} [customColor]
 */
export function componentVisualDescriptor(type, customColor) {
  const catalogEntry = TYPES[type],
    kind = catalogEntry?.flexibleLine
      ? "flexible-line"
      : catalogEntry?.mechanism
        ? "mechanism"
        : catalogEntry?.teeth
          ? "gear"
          : GENERIC_VISUAL_TYPES.has(type)
            ? "generic"
            : type;
  if (!catalogEntry)
    throw new Error(`Unknown component type "${String(type)}"`);
  const authoredColor = finiteColor(
    customColor ?? catalogEntry.color,
    `${type} visual color`,
  );
  return deepFreeze({
    kind,
    color: authoredColor,
    customColor: customColor == null ? null : authoredColor,
    size: Array.isArray(catalogEntry.size) ? [...catalogEntry.size] : null,
    teeth: Number(catalogEntry.teeth || 0),
    radius: Number(catalogEntry.radius || 0),
    lumens: Number(catalogEntry.lumens || 0),
    powerWatts: Number(catalogEntry.powerWatts || 0),
    lengthM: Number(catalogEntry.lengthM || 0),
    diameterM: Number(catalogEntry.diameterM || 0),
    geometry: catalogEntry.flexibleLine
      ? null
      : geometryDescriptorForType(type),
  });
}

export const registeredComponentVisualTypes = Object.freeze(Object.keys(TYPES));
