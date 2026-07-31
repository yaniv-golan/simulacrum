import { TYPES } from "./component-catalog.js";
import { immutableClone } from "./primitives.js";

const immutableContractClones = new WeakMap();

function flatContractSnapshot(contract) {
  const keys = [],
    values = [];
  for (const key in contract) {
    if (!Object.hasOwn(contract, key)) continue;
    const value = contract[key];
    if (value != null && typeof value === "object") return null;
    keys.push(key);
    values.push(value);
  }
  return { keys, values };
}

function flatContractUnchanged(contract, snapshot) {
  let ownKeyCount = 0;
  for (const key in contract) if (Object.hasOwn(contract, key)) ownKeyCount++;
  return (
    ownKeyCount === snapshot.keys.length &&
    snapshot.keys.every((key, index) =>
      Object.is(contract[key], snapshot.values[index]),
    )
  );
}

function immutableContract(contract) {
  const cached = immutableContractClones.get(contract);
  if (cached && flatContractUnchanged(contract, cached.snapshot))
    return cached.clone;
  const snapshot = flatContractSnapshot(contract);
  const clone = immutableClone(contract);
  if (snapshot) immutableContractClones.set(contract, { snapshot, clone });
  else immutableContractClones.delete(contract);
  return clone;
}

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
  return contract ? immutableContract(contract) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentElectricalSource(part, catalog = TYPES) {
  const contract = componentDefinition(part, catalog)?.electricalSource;
  return contract ? immutableContract(contract) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentMaterialStore(part, catalog = TYPES) {
  const contract = componentDefinition(part, catalog)?.materialStore;
  return contract ? immutableContract(contract) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentPneumaticContract(part, catalog = TYPES) {
  const contract = componentDefinition(part, catalog)?.pneumatic;
  return contract ? immutableContract(contract) : null;
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
  return propulsion ? immutableContract(propulsion) : null;
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function componentIsPayload(part, catalog = TYPES) {
  return componentDefinition(part, catalog)?.payload === true;
}
