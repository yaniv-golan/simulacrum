import {
  compileConnectionNetworks,
  createCompilationContext,
} from "./assembly-compiler-context.js";
import { compileForceElements } from "./assembly-compiler-force-elements.js";
import { compileFlexibleLines } from "./assembly-compiler-flexible-lines.js";
import { compileBodies } from "./assembly-compiler-bodies.js";
import { compilePhysicalConstraints } from "./assembly-compiler-constraints.js";
import { compileTopology } from "./assembly-compiler-topology.js";
import { finalizeCompilation } from "./assembly-compiler-finalize.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "./plain-data-contract.js";

const compilerOwnedRigidClusters = new WeakSet();
const EMPTY_CATALOG = issueInertPlainData({});

function compileValidatedAssembly(snapshot, catalog) {
  const context = createCompilationContext(snapshot, catalog);
  compileConnectionNetworks(context);
  compileForceElements(context);
  compileFlexibleLines(context);
  compileBodies(context);
  compilePhysicalConstraints(context);
  compileTopology(context);
  const compiled = finalizeCompilation(context);
  for (const descriptor of compiled.rigidClusters)
    compilerOwnedRigidClusters.add(descriptor);
  return compiled;
}

/**
 * Tests whether a descriptor is the exact immutable object emitted by a live
 * compileAssembly transaction. Registration is deliberately lexical to this
 * module: callers can inspect provenance but cannot mint it for detached data.
 * @param {unknown} value
 */
export function isCompilerOwnedRigidCluster(value) {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    compilerOwnedRigidClusters.has(value)
  );
}

/**
 * Compile a persistent AssemblyModel snapshot into one immutable,
 * engine-neutral physical topology. Each stage owns a single transformation
 * and shares only the explicit compilation context DTO.
 *
 * No Three.js, Cannon, DOM, demo identity, or global state is used.
 * Public callers pass serialized JSON. Package-owned call sites may also pass
 * an issued immutable root, which is deliberately not a constructible public
 * type.
 * @param {string} snapshotInput
 * @param {string} [catalogInput]
 */
export function compileAssembly(snapshotInput, catalogInput = "{}") {
  const snapshot = requireInertPlainData(snapshotInput, {
      code: "INVALID_ASSEMBLY_PLAIN_DATA",
      message:
        "Assembly input must be serialized JSON or an exported immutable data root",
      path: ["assembly"],
    }),
    catalog = requireInertPlainData(catalogInput, {
      code: "INVALID_COMPONENT_CATALOG_PLAIN_DATA",
      message:
        "Component catalog input must be serialized JSON or an exported immutable data root",
      path: ["catalog"],
    });
  return compileValidatedAssembly(snapshot, catalog);
}

/**
 * Package-internal entrypoint for roots issued by trusted model owners.
 * This symbol is intentionally absent from the Core package entrypoint.
 * @param {any} snapshotInput
 * @param {any} [catalogInput]
 */
export function compileAssemblyFromIssuedRoots(
  snapshotInput,
  catalogInput = EMPTY_CATALOG,
) {
  const snapshot = requireInertPlainData(snapshotInput, {
      code: "INVALID_ASSEMBLY_PLAIN_DATA",
      message:
        "Assembly input must be serialized JSON or an exported immutable data root",
      path: ["assembly"],
    }),
    catalog = requireInertPlainData(catalogInput, {
      code: "INVALID_COMPONENT_CATALOG_PLAIN_DATA",
      message:
        "Component catalog input must be serialized JSON or an exported immutable data root",
      path: ["catalog"],
    });
  return compileValidatedAssembly(snapshot, catalog);
}
