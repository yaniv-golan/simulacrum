import { CATALOG } from './catalog.mjs';
import { compileAssembly } from './assembly.mjs';
import { validatePlacementGeometry } from './surfaces.mjs';
import {
  CURRENT_SAVE_VERSION,
  invalidData,
  validateBlueprint as validateBlueprintData,
} from './blueprint-validation.mjs';
export {
  BLUEPRINT_REASON_CODES,
  CURRENT_SAVE_VERSION,
  QUATERNION_NORM_TOLERANCE,
} from './blueprint-validation.mjs';
const result = (reasonCode, path = '') => ({ ok: reasonCode === 'OK', reasonCode, path });
/** Shared data admission stays below compilation; save loading also compiles geometry. */
export function validateBlueprint(blueprint) {
  return validateBlueprintData(blueprint);
}
export function loadSave(input) {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return result('INVALID_JSON');
    }
  }
  const bad = invalidData(parsed);
  if (bad !== null) return result('INVALID_BLUEPRINT', bad);
  if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.version)) {
    if (parsed.version < CURRENT_SAVE_VERSION)
      return result('SAVE_VERSION_UNSUPPORTED_OLD', '/version');
    if (parsed.version > CURRENT_SAVE_VERSION) return result('SAVE_VERSION_FUTURE', '/version');
  }
  const validation = validateBlueprint(parsed);
  if (validation.ok)
    try {
      validatePlacementGeometry(parsed);
    } catch (error) {
      return result(error.reasonCode, error.path ?? 'connections');
    }
  if (!validation.ok) return validation;
  try {
    compileAssembly(parsed);
  } catch (error) {
    const code = error?.reasonCode;
    return result(
      typeof code === 'string' && code !== 'OK' ? code : 'INVALID_BLUEPRINT',
      error.path ?? '',
    );
  }
  const blueprint = structuredClone(parsed);
  canonicalizeContactOverrides(blueprint);
  return { ...validation, blueprint };
}
function authored(value) {
  const validation = validateBlueprint(value);
  if (!validation.ok)
    throw Object.assign(new TypeError(validation.reasonCode), {
      reasonCode: validation.reasonCode,
      path: validation.path,
    });
  return value;
}
export function createEmptyBlueprint(id, name) {
  return authored({ version: CURRENT_SAVE_VERSION, id, name, parts: [], connections: [] });
}
export function createPart(type, id, position) {
  if (!Object.hasOwn(CATALOG, type))
    throw Object.assign(new TypeError('UNKNOWN_PART_TYPE'), {
      reasonCode: 'UNKNOWN_PART_TYPE',
      path: '/type',
    });
  const part = {
    id,
    type,
    name: CATALOG[type].name,
    position: structuredClone(position),
    rotation: [0, 0, 0, 1],
    authoredMaterial: {},
    parameters: Object.fromEntries(
      Object.entries(CATALOG[type].parameterDefinitions).map(([key, definition]) => [
        key,
        definition.default,
      ]),
    ),
  };
  authored({
    version: CURRENT_SAVE_VERSION,
    id: 'factory',
    name: 'Factory',
    parts: [part],
    connections: [],
  });
  return part;
}

// Names identify parts to players only; ids retain connection ownership.
export function availablePartName(parts, requested) {
  const used = new Set(parts.map((part) => part.name));
  if (!used.has(requested)) return requested;
  const base = requested.replace(/-\d+$/, '');
  for (
    let n =
      Math.max(
        1,
        ...parts.map((part) =>
          part.name.startsWith(base + '-')
            ? /^[0-9]{1,8}$/.test(part.name.slice(base.length + 1))
              ? Number(part.name.slice(base.length + 1))
              : 1
            : 1,
        ),
      ) + 1;
    ;
    n++
  ) {
    const suffix = `-${n}`,
      candidate = base.slice(0, 128 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

/** Remove empty optional records after admission, without changing explicit zero. */
export function canonicalizeContactOverrides(blueprint) {
  for (const part of blueprint.parts) {
    if (!part.authoredContact) continue;
    for (const [id, values] of Object.entries(part.authoredContact))
      if (Object.keys(values).length === 0) delete part.authoredContact[id];
    if (Object.keys(part.authoredContact).length === 0) delete part.authoredContact;
  }
}
