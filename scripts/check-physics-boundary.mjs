import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildModuleGraph, listProjectFiles } from './module-graph.mjs';
/** Import ownership check only. Runtime value-isolation tests enforce escape behavior. */
export function checkPhysicsBoundary(root = process.cwd()) {
  const { physicsPackages } = JSON.parse(
    readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8'),
  );
  if (
    !Array.isArray(physicsPackages) ||
    !physicsPackages.length ||
    physicsPackages.some((name) => typeof name !== 'string' || !name)
  )
    throw new Error('physicsPackages must declare the chosen library');
  const entrypoints = listProjectFiles(root).filter(
    (path) => path.startsWith('src/') && /\.(?:mjs|cjs|js)$/.test(path),
  );
  const graph = buildModuleGraph(root, { entrypoints });
  if (graph.errors.length) throw new Error(graph.errors.join('\n'));
  const importers = [...graph.nodes]
    .filter(([, node]) =>
      node.imports.some((edge) =>
        physicsPackages.some(
          (name) => edge.specifier === name || edge.specifier.startsWith(`${name}/`),
        ),
      ),
    )
    .map(([path]) => path);
  if (importers.length !== 1)
    throw new Error(
      `expected exactly one physics importer, found ${importers.length}: ${importers.join(', ')}`,
    );
  if (importers[0] !== 'src/simulation/physics/world.mjs')
    throw new Error(`physics importer must be the owned door: ${importers[0]}`);
}
