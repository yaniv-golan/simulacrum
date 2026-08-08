import { compileAssembly as compileAssemblyBoundary } from "../../src/model/assembly-compiler.js";

// Verifiers author fixtures as ordinary local objects. Cross the same public
// persisted-data boundary as a real caller instead of granting those fixtures
// package-internal trust.
export function compileAssembly(snapshot, catalog) {
  return compileAssemblyBoundary(
    JSON.stringify(snapshot),
    catalog === undefined ? undefined : JSON.stringify(catalog),
  );
}

export { compileAssemblyBoundary };
