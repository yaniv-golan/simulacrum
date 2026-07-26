import { TYPES } from "./component-catalog.js";
import {
  resolveComponentGeometryContract,
  resolveComponentGeometryContractForType,
} from "./component-geometry-contract.js";

const BUILT_IN_GEOMETRY_CATALOG =
  /** @type {import("./component-geometry-contract.js").ComponentGeometryCatalog} */ (
    /** @type {unknown} */ (TYPES)
  );

/**
 * Canonical physical geometry for one authored component instance.
 * The returned descriptor is immutable, engine-neutral, post-scale, and is
 * the only downstream authority for bodies, collision, ports, and features.
 * @param {import("./component-geometry-contract.js").ComponentGeometryPartInput} part
 * @param {import("./component-geometry-contract.js").ComponentGeometryCatalog} [catalog]
 */
export function geometryDescriptorForPart(
  part,
  catalog = BUILT_IN_GEOMETRY_CATALOG,
) {
  return resolveComponentGeometryContract(part, catalog);
}

/**
 * Catalog-preview helper. Authored assemblies must use the instance API.
 * @param {string} type
 * @param {import("./component-geometry-contract.js").ComponentGeometryCatalog} [catalog]
 * @returns {import("./component-geometry-contract.js").GeometryDescriptorV2}
 */
export function geometryDescriptorForType(
  type,
  catalog = BUILT_IN_GEOMETRY_CATALOG,
) {
  return resolveComponentGeometryContractForType(type, catalog);
}
