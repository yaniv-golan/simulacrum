import { TYPES } from "./component-catalog.js";
import { immutableClone } from "./primitives.js";

/**
 * The catalog boundary is the only place where a portable component type is
 * resolved into declared behavior. Compiler and runtime consumers receive the
 * resulting contract and never dispatch physical behavior from the type name.
 */
/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentDefinition(part, catalog = TYPES) {
  return catalog[part?.type] || null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentPorts(part, catalog = TYPES) {
  return componentDefinition(part, catalog)?.ports || [];
}

/** @param {any} part @param {string} behavior @param {Record<string, any>} [catalog] */
export function componentHasPortBehavior(part, behavior, catalog = TYPES) {
  return componentPorts(part, catalog).some(
    (descriptor) => descriptor.behavior === behavior,
  );
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentControlContract(part, catalog = TYPES) {
  const id = componentDefinition(part, catalog)?.controlContract;
  return typeof id === "string" && id ? id : null;
}

/** @param {any} part @param {string} contractId @param {Record<string, any>} [catalog] */
export function componentHasControlContract(part, contractId, catalog = TYPES) {
  return componentControlContract(part, catalog) === contractId;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentElectricalContract(part, catalog = TYPES) {
  const contract = componentDefinition(part, catalog)?.electricalContract;
  return contract ? immutableClone(contract) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentElectricalSource(part, catalog = TYPES) {
  const contract = componentDefinition(part, catalog)?.electricalSource;
  return contract ? immutableClone(contract) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentMaterialStore(part, catalog = TYPES) {
  const contract = componentDefinition(part, catalog)?.materialStore;
  return contract ? immutableClone(contract) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentReadings(part, catalog = TYPES) {
  const readings = componentDefinition(part, catalog)?.readings;
  return Array.isArray(readings)
    ? Object.freeze([...readings])
    : Object.freeze([]);
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentPropulsion(part, catalog = TYPES) {
  const propulsion = componentDefinition(part, catalog)?.flight?.propulsion;
  return propulsion ? immutableClone(propulsion) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentIsPayload(part, catalog = TYPES) {
  return componentDefinition(part, catalog)?.payload === true;
}
