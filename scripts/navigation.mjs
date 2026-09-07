import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'acorn';
function declarations(source) {
  const ast = parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
    allowHashBang: true,
  });
  const found = [],
    exported = new Set();
  const add = (name, node, scope, kind) =>
    found.push({
      name,
      line: node.loc.start.line,
      kind,
      enclosingScope: scope,
      exported: scope.length === 0 && exported.has(name),
    });
  const names = (pattern) => {
    if (!pattern) return [];
    if (pattern.type === 'Identifier') return [pattern.name];
    if (pattern.type === 'RestElement') return names(pattern.argument);
    if (pattern.type === 'AssignmentPattern') return names(pattern.left);
    if (pattern.type === 'ObjectPattern')
      return pattern.properties.flatMap((p) => names(p.value ?? p.argument));
    if (pattern.type === 'ArrayPattern') return pattern.elements.flatMap(names);
    return [];
  };
  const functionBody = (node, scope, name) => {
    const inner = [...scope, name];
    for (const parameter of node.params)
      for (const name of names(parameter)) add(name, parameter, inner, 'parameter');
    if (node.body.type === 'BlockStatement') node.body.body.forEach((child) => visit(child, inner));
    else visit(node.body, inner);
  };
  const visit = (node, scope = []) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator') {
      const callable = ['FunctionExpression', 'ArrowFunctionExpression'].includes(node.init?.type);
      const bindings = names(node.id);
      for (const name of bindings) add(name, node, scope, callable ? 'function' : 'variable');
      if (callable)
        functionBody(node.init, scope, bindings[0] ?? `<anonymous:${node.loc.start.line}>`);
      else visit(node.init, scope);
      return;
    }
    if (
      ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
    ) {
      const name = node.id?.name ?? `<anonymous:${node.loc.start.line}>`;
      if (node.id) add(name, node, scope, 'function');
      functionBody(node, scope, name);
      return;
    }
    if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      const name = node.id?.name ?? `<class:${node.loc.start.line}>`;
      if (node.id) add(name, node, scope, 'class');
      visit(node.body, [...scope, name]);
      return;
    }
    if (node.type === 'MethodDefinition' || (node.type === 'Property' && node.method)) {
      const name = node.key.name ?? String(node.key.value);
      add(name, node, scope, 'method');
      functionBody(node.value, scope, name);
      return;
    }
    const inner = [
      'BlockStatement',
      'ForStatement',
      'ForOfStatement',
      'ForInStatement',
      'CatchClause',
    ].includes(node.type)
      ? [...scope, `<${node.type}:${node.loc.start.line}>`]
      : scope;
    for (const [key, value] of Object.entries(node))
      if (key !== 'loc') {
        if (Array.isArray(value)) value.forEach((child) => visit(child, inner));
        else if (value && typeof value === 'object') visit(value, inner);
      }
  };
  for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
      for (const specifier of node.specifiers) exported.add(specifier.local.name);
      if (node.declaration?.id) names(node.declaration.id).forEach((name) => exported.add(name));
      for (const declaration of node.declaration?.declarations ?? [])
        names(declaration.id).forEach((name) => exported.add(name));
    }
    if (node.type === 'ExportDefaultDeclaration') {
      const name = node.declaration.id?.name ?? 'default';
      exported.add(name);
      if (!node.declaration.id) add(name, node, [], 'export');
    }
  }
  visit(ast);
  return found;
}
export function queryNavigation(
  graph,
  query,
  { read = (path) => readFileSync(resolve(graph.root, path), 'utf8'), allSymbols = false } = {},
) {
  if (typeof query !== 'string' || !query.trim())
    throw Error('nonempty path or symbol query required');
  const reverse = new Map();
  for (const [path, node] of graph.nodes)
    for (const dependency of node.dependencies) {
      if (!reverse.has(dependency)) reverse.set(dependency, new Set());
      reverse.get(dependency).add(path);
    }
  const records = [],
    parseErrors = [];
  for (const [path, node] of graph.nodes) {
    let symbols = [];
    if (/\.(m?js|cjs)$/.test(path)) {
      try {
        symbols = declarations(read(path));
      } catch (error) {
        parseErrors.push({
          path,
          message: error.message,
          line: error.loc?.line ?? null,
          column: error.loc?.column ?? null,
        });
      }
    }
    const pathMatch = path.includes(query);
    symbols = symbols.filter(
      (x) =>
        allSymbols ||
        x.enclosingScope.length === 0 ||
        (!pathMatch && ['function', 'method', 'class'].includes(x.kind)),
    );
    if (!pathMatch) symbols = symbols.filter((x) => x.name.includes(query));
    if (!pathMatch && !symbols.length) continue;
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
  return {
    matches: records.sort((a, b) => a.path.localeCompare(b.path)),
    parseErrors: parseErrors.sort((a, b) => a.path.localeCompare(b.path)),
  };
}
