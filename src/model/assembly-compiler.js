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

/**
 * Compile a persistent AssemblyModel snapshot into one immutable,
 * engine-neutral physical topology. Each stage owns a single transformation
 * and shares only the explicit compilation context DTO.
 *
 * No Three.js, Cannon, DOM, demo identity, or global state is used.
 */
export function compileAssembly(snapshot, catalog = {}) {
  const context = createCompilationContext(snapshot, catalog);
  compileConnectionNetworks(context);
  compileForceElements(context);
  compileFlexibleLines(context);
  compileBodies(context);
  compilePhysicalConstraints(context);
  compileTopology(context);
  return finalizeCompilation(context);
}
