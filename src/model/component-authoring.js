import { resolveComponentConfig } from "./component-resolver.js";
import {
  isMechanismComponentType,
  mechanismComponentDefinition,
} from "./mechanism-component-definitions.js";

/** Creates the one authoritative authored payload for a newly placed part. */
export function authoredComponentFields(type, authored = {}) {
  if (!isMechanismComponentType(type))
    return { config: resolveComponentConfig(type, authored) };
  return {
    mechanism: Object.keys(authored || {}).length
      ? structuredClone(authored)
      : mechanismComponentDefinition(type),
  };
}
