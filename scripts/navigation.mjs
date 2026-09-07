import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'acorn';
function declarations(source) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (
      ['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclarator'].includes(node.type) &&
      node.id?.type === 'Identifier'
    )
      found.push({ name: node.id.name, line: node.loc.start.line });
    for (const [key, value] of Object.entries(node))
      if (key !== 'loc') {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
  };
  visit(
    parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
    }),
  );
  return found;
}
export function queryNavigation(
  graph,
  query,
  { read = (path) => readFileSync(resolve(graph.root, path), 'utf8') } = {},
) {
  if (typeof query !== 'string' || !query.trim())
    throw Error('nonempty path or symbol query required');
  const reverse = new Map();
  for (const [path, node] of graph.nodes)
    for (const dependency of node.dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(path);
    }
  const records = [];
  for (const [path, node] of graph.nodes) {
    let symbols = [];
    if (/\.(m?js|cjs)$/.test(path)) {
      try {
        symbols = declarations(read(path));
      } catch {
        /* graph errors remain visible in CLI output */
      }
    }
    if (!path.includes(query) && !symbols.some((x) => x.name.includes(query))) continue;
    const seen = new Set([path]),
      pending = [path];
    for (const current of pending)
      for (const consumer of reverse.get(current) ?? [])
        if (!seen.has(consumer)) {
          seen.add(consumer);
          pending.push(consumer);
        }
    records.push({
      path,
      symbols,
      imports: [...node.dependencies].sort(),
      consumers: [...(reverse.get(path) ?? [])].sort(),
      tests: [...seen].filter((x) => /\.test\.(m?js|cjs)$/.test(x)).sort(),
      opaqueInputs: !!node.opaqueInputs,
    });
  }
  return records.sort((a, b) => a.path.localeCompare(b.path));
}
