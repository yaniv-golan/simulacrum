import { TYPES } from "./component-catalog.js";
import { deepFreeze, immutableClone, stableStringify } from "./primitives.js";

const CATALOG_CONTRACT_KEYS = new Set([
  "name",
  "cat",
  "icon",
  "color",
  "desc",
  "ports",
  "mechanism",
  "flexibleLine",
  "actuator",
  "flight",
  "controlContract",
  "electricalContract",
  "electricalSource",
  "materialStore",
  "sensorContract",
  "pneumatic",
]);

const CURRENT_CATALOG = deepFreeze(structuredClone(TYPES));

export function componentDefaults(type, catalog = CURRENT_CATALOG) {
  const definition = catalog[type] || {},
    defaults = {};
  for (const [key, value] of Object.entries(definition))
    if (!CATALOG_CONTRACT_KEYS.has(key)) defaults[key] = structuredClone(value);
  return immutableClone(defaults);
}

export function splitComponentConfig(
  type,
  input = {},
  catalog = CURRENT_CATALOG,
) {
  const defaults = componentDefaults(type, catalog),
    overrides = {},
    extensions = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (Object.hasOwn(defaults, key)) {
      if (stableStringify(value) !== stableStringify(defaults[key]))
        overrides[key] = structuredClone(value);
    } else if (!CATALOG_CONTRACT_KEYS.has(key))
      extensions[key] = structuredClone(value);
  }
  return immutableClone({ overrides, extensions });
}

export function resolveComponentConfig(
  partOrType,
  overrides,
  catalog = CURRENT_CATALOG,
) {
  const type =
      typeof partOrType === "string" ? partOrType : partOrType?.type || "",
    instance =
      overrides ??
      (typeof partOrType === "object" ? partOrType.config || {} : {}),
    defaults = componentDefaults(type, catalog),
    values = {};
  for (const [key, value] of Object.entries(instance || {}))
    if (!CATALOG_CONTRACT_KEYS.has(key)) values[key] = structuredClone(value);
  return immutableClone({ ...defaults, ...values });
}

/** Expands compact domain config into the one current wire shape. */
export function resolveWireComponentConfig(part, catalog = CURRENT_CATALOG) {
  return immutableClone({
    ...structuredClone(componentDefaults(part?.type, catalog)),
    ...structuredClone(part?.config || {}),
  });
}
