import { readdirSync, readFileSync, statSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { parse } from 'acorn';
import { parse as parseHTML } from 'parse5';
import * as cssTree from 'css-tree';
const sourceExtensions = new Set(['.js', '.mjs', '.cjs']);
const excluded = new Set(['.git', 'node_modules', 'dist', 'coverage', '.cache', 'artifacts']);
export function listProjectFiles(root, directory = '') {
  return readdirSync(resolve(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = [directory, entry.name].filter(Boolean).join('/');
      if (excluded.has(entry.name)) return [];
      if (entry.isSymbolicLink()) return [path];
      return entry.isDirectory() ? listProjectFiles(root, path) : [path];
    })
    .sort();
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}
export function buildModuleGraph(
  root = process.cwd(),
  { dataDependencies = {}, entrypoints, purpose = 'resources' } = {},
) {
  root = realpathSync(resolve(root));
  const files = listProjectFiles(root);
  const nodes = new Map();
  const errors = [];
  // Runtime services are dependencies of the served build, but are not browser imports.
  // Exact dynamic argument declarations are a reviewable contract, not value-flow proof.
  let contract = {};
  try {
    if (existsSync(resolve(root, 'package.json')))
      contract = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).moduleGraph ?? {};
  } catch (error) {
    errors.push(`package.json: invalid module graph contract: ${error.message}`);
  }
  const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (
    !record(contract) ||
    Object.keys(contract).some(
      (key) => !['runtimeNetworkDependencies', 'runtimeURLArguments'].includes(key),
    )
  ) {
    errors.push('package.json: invalid moduleGraph');
    contract = {};
  }
  const network = {},
    urlArguments = {};
  const expressions = (value) =>
    Array.isArray(value) &&
    value.every(
      (x) => typeof x === 'string' && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(x),
    );
  for (const [key, destination] of [
    ['runtimeNetworkDependencies', network],
    ['runtimeURLArguments', urlArguments],
  ]) {
    if (contract[key] !== undefined && !record(contract[key])) {
      errors.push(`package.json: invalid ${key}`);
      continue;
    }
    for (const [path, value] of Object.entries(contract[key] ?? {})) {
      const valid =
        key === 'runtimeURLArguments'
          ? (path.startsWith('scripts/') || Object.hasOwn(network, path)) && expressions(value)
          : path.startsWith('src/application/') &&
            record(value) &&
            Object.keys(value).every((x) =>
              ['namespace', 'service', 'dynamicFetchArguments'].includes(x),
            ) &&
            typeof value.namespace === 'string' &&
            /^\/api\/(?:[A-Za-z0-9_-]+\/)+$/.test(value.namespace) &&
            typeof value.service === 'string' &&
            value.service.startsWith('.') &&
            expressions(value.dynamicFetchArguments);
      if (!files.includes(path) || !valid) {
        errors.push(`${path}: invalid ${key} contract`);
        continue;
      }
      destination[path] = value;
    }
  }

  for (const path of files)
    if (lstatSync(resolve(root, path)).isSymbolicLink())
      errors.push(`${path}: symlink dependencies are unsupported`);
  const pending = entrypoints
    ? [...entrypoints]
    : files.filter((path) => sourceExtensions.has(extname(path)));
  function targetFor(path, specifier) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
    const target = relative(
      root,
      resolve(
        root,
        specifier.startsWith('/') ? '.' : dirname(path),
        specifier.split(/[?#]/)[0].replace(/^\//, ''),
      ),
    ).replaceAll('\\', '/');
    if (target.startsWith('../')) {
      errors.push(`${path}: dependency escapes project: ${specifier}`);
      return null;
    }
    if (!existsSync(resolve(root, target)) || !statSync(resolve(root, target)).isFile()) {
      errors.push(`${path}: unresolved dependency ${specifier}`);
      return null;
    }
    if (realpathSync(resolve(root, target)) !== resolve(root, target)) {
      errors.push(`${path}: symlink dependency ${specifier}`);
      return null;
    }
    if (!nodes.has(target) && !pending.includes(target)) pending.push(target);
    return target;
  }
  for (let i = 0; i < pending.length; i++) {
    const path = pending[i];
    const tooling =
      purpose === 'test-selection' && (path.startsWith('scripts/') || path.startsWith('test/'));
    if (lstatSync(resolve(root, path)).isSymbolicLink()) continue;
    const info = { dependencies: new Set(), imports: [], dom: false };
    nodes.set(path, info);
    const add = (specifier, kind) => {
      const target = targetFor(path, specifier);
      info.imports.push({ specifier, target, kind, typeOnly: false });
      if (target) info.dependencies.add(target);
    };
    const resource = (value) => {
      value = value.trim();
      if (!value || value.startsWith('#') || /^(?:[a-zA-Z][a-zA-Z+.-]*:|\/\/)/.test(value)) return;
      add(value.startsWith('.') || value.startsWith('/') ? value : `./${value}`, 'data');
    };
    for (const dependency of dataDependencies[path] ?? []) add(dependency, 'data');
    const runtime = network[path];
    if (runtime) {
      const service = relative(root, resolve(root, dirname(path), runtime.service)).replaceAll(
        '\\',
        '/',
      );
      if (!service.startsWith('scripts/') || !sourceExtensions.has(extname(service)))
        errors.push(`${path}: runtime service must be a project script`);
      else add(runtime.service, 'runtime-service');
    }
    const scripts = [];
    const css = (text, context = 'stylesheet') => {
      try {
        const tree = cssTree.parse(text, {
          context,
          onParseError: (error) => {
            throw error;
          },
        });
        cssTree.walk(tree, (node) => {
          if (node.type === 'Url') resource(node.value);
          if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
            const first = node.prelude?.children?.first;
            if (first?.type === 'String') resource(first.value);
            else if (first?.type !== 'Url') errors.push(`${path}: unsupported CSS import`);
          }
          if (node.type === 'Raw') errors.push(`${path}: unsupported CSS syntax`);
        });
      } catch (error) {
        errors.push(`${path}: CSS parse error: ${error.message}`);
      }
    };
    if (sourceExtensions.has(extname(path)))
      scripts.push(readFileSync(resolve(root, path), 'utf8'));
    else if (extname(path) === '.css') css(readFileSync(resolve(root, path), 'utf8'));
    else if (['.html', '.htm'].includes(extname(path))) {
      const html = parseHTML(readFileSync(resolve(root, path), 'utf8'));
      const visit = (node) => {
        const attrs = Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]));
        if (node.tagName === 'base' && attrs.href !== undefined)
          errors.push(`${path}: HTML base href is unsupported`);
        if (attrs.srcset !== undefined)
          errors.push(`${path}: srcset requires an explicit supported resource manifest`);
        for (const name of ['src', 'href', 'poster', 'data'])
          if (attrs[name] !== undefined) resource(attrs[name]);
        if (attrs.style) css(attrs.style, 'declarationList');
        if (node.tagName === 'style')
          css((node.childNodes ?? []).map((child) => child.value ?? '').join(''));
        if (node.tagName === 'script') {
          if (attrs.type === 'importmap') errors.push(`${path}: import maps are unsupported`);
          else if (
            !attrs.src &&
            (!attrs.type ||
              ['module', 'text/javascript', 'application/javascript'].includes(attrs.type))
          )
            scripts.push((node.childNodes ?? []).map((child) => child.value ?? '').join(''));
        }
        for (const [name, value] of Object.entries(attrs))
          if (name.startsWith('on')) scripts.push(value);
        for (const child of node.childNodes ?? []) visit(child);
        if (node.content) visit(node.content);
      };
      visit(html);
    }
    for (const script of scripts) {
      let ast;
      try {
        ast = parse(script, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
      } catch (error) {
        errors.push(`${path}: parse error: ${error.message}`);
        continue;
      }
      walk(ast, (node) => {
        if (
          ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
            node.type,
          ) &&
          node.source
        )
          add(node.source.value, 'module');
        if (node.type === 'ImportExpression') {
          if (node.source.type === 'Literal' && typeof node.source.value === 'string')
            add(node.source.value, 'module');
          else errors.push(`${path}: nonliteral dynamic import`);
        }
        if (
          node.type === 'CallExpression' &&
          node.callee.type === 'Identifier' &&
          ['require', 'eval', 'Function'].includes(node.callee.name)
        )
          errors.push(`${path}: unsupported loader or dynamic code ${node.callee.name}`);
        if (node.type === 'NewExpression' && node.callee.name === 'Function')
          errors.push(`${path}: unsupported dynamic code Function`);
        // Node tooling can inspect generated files, directories and subprocesses.
        // These are opaque whole-project inputs for its consuming tests, not broken
        // browser asset URLs. Resource/fingerprint analysis remains strict.
        if (
          tooling &&
          node.type === 'CallExpression' &&
          [
            'readFileSync',
            'readFile',
            'readdirSync',
            'cpSync',
            'execFileSync',
            'execFile',
            'spawnSync',
            'spawn',
          ].includes(node.callee.name)
        )
          info.opaqueInputs = true;
        if (tooling && node.type === 'CallExpression' && node.callee.name === 'fetch' && !runtime) {
          info.opaqueInputs = true;
          return;
        }
        if (tooling && node.type === 'NewExpression' && node.callee.name === 'URL') {
          const value = node.arguments[0];
          if (
            value?.type === 'Literal' &&
            typeof value.value === 'string' &&
            (value.value.startsWith('.') || value.value.startsWith('/'))
          ) {
            const target = resolve(root, dirname(path), value.value);
            if (existsSync(target) && statSync(target).isFile()) add(value.value, 'data');
            else info.opaqueInputs = true;
          } else info.opaqueInputs = true;
          return;
        }
        if (
          (node.type === 'NewExpression' && node.callee.name === 'URL') ||
          (node.type === 'CallExpression' && node.callee.name === 'fetch')
        ) {
          const value = node.arguments[0];
          const argument = value ? script.slice(value.start, value.end) : '';
          if (node.type === 'CallExpression' && runtime) {
            if (
              value?.type === 'Literal' &&
              typeof value.value === 'string' &&
              value.value.startsWith(runtime.namespace)
            ) {
              // Reject encoded separators and traversal rather than letting URL normalization
              // turn a namespace-looking literal into another request path.
              const pathname = value.value.split(/[?#]/)[0];
              if (
                !/[\\%]/.test(pathname) &&
                !pathname.split('/').some((x) => x === '.' || x === '..')
              )
                return;
            } else if (
              value?.type !== 'Literal' &&
              runtime.dynamicFetchArguments.includes(argument)
            )
              return;
          }
          if (node.type === 'NewExpression' && urlArguments[path]?.includes(argument)) return;
          if (value?.type === 'Literal' && typeof value.value === 'string') {
            if (!/^[a-zA-Z][a-zA-Z+.-]*:/.test(value.value))
              add(
                value.value.startsWith('.') || value.value.startsWith('/')
                  ? value.value
                  : `./${value.value}`,
                'data',
              );
          } else if (!dataDependencies[path]?.length)
            errors.push(
              `${path}: nonliteral resource reference requires declared dataDependencies`,
            );
        }
        if (
          node.type === 'NewExpression' &&
          node.callee.name === 'XMLHttpRequest' &&
          !dataDependencies[path]?.length
        )
          errors.push(`${path}: XMLHttpRequest requires declared dataDependencies`);
        if (
          node.type === 'Identifier' &&
          [
            'window',
            'document',
            'HTMLElement',
            'HTMLCanvasElement',
            'customElements',
            'localStorage',
            'sessionStorage',
          ].includes(node.name)
        )
          info.dom = true;
        if (
          node.type === 'Literal' &&
          [
            'window',
            'document',
            'HTMLElement',
            'customElements',
            'localStorage',
            'sessionStorage',
          ].includes(node.value)
        )
          info.dom = true;
      });
    }
  }
  for (const path of files.filter(
    (path) =>
      path.startsWith('src/') &&
      !sourceExtensions.has(extname(path)) &&
      !['.json', '.html', '.htm', '.css', '.svg', '.png', '.jpg', '.wasm'].includes(extname(path)),
  ))
    errors.push(`${path}: unsupported source format`);
  return { root, nodes, files, errors };
}
export function validateLayers(graph, { physicsPackages = [] } = {}) {
  const errors = graph.errors.filter(
    (error) => error.startsWith('src/') || error.startsWith('package.json:'),
  );
  const allowed = {
    model: [],
    simulation: ['model'],
    scripting: ['model'],
    presentation: ['model'],
    application: ['model', 'simulation', 'scripting', 'presentation', 'core'],
    core: ['model', 'simulation', 'scripting'],
  };
  const layer = (path) => (path.startsWith('src/') ? path.split('/')[1] : null);
  for (const [path, node] of graph.nodes) {
    if (!path.startsWith('src/')) continue;
    const owner = layer(path);
    if (!allowed[owner]) {
      errors.push(`${path}: unknown layer`);
      continue;
    }
    for (const edge of node.imports) {
      if (edge.kind === 'runtime-service') continue;
      if (path.startsWith('src/simulation/physics/law/')) {
        errors.push(`${path}: law imports nothing (${edge.specifier})`);
        continue;
      }
      if (edge.target) {
        const targetLayer = layer(edge.target);
        if (!targetLayer || (targetLayer !== owner && !allowed[owner].includes(targetLayer)))
          errors.push(`${path}: forbidden dependency ${edge.target}`);
      } else if (
        physicsPackages.some(
          (name) => edge.specifier === name || edge.specifier.startsWith(`${name}/`),
        )
      ) {
        if (!path.startsWith('src/simulation/physics/'))
          errors.push(`${path}: physics package outside physics boundary`);
      } else if (owner !== 'presentation' && owner !== 'application')
        errors.push(`${path}: undeclared external dependency ${edge.specifier}`);
    }
  }
  const active = new Set(),
    done = new Set();
  function cycle(path) {
    if (active.has(path)) {
      errors.push(`${path}: module cycle`);
      return;
    }
    if (done.has(path)) return;
    active.add(path);
    for (const dependency of graph.nodes.get(path)?.dependencies ?? []) cycle(dependency);
    active.delete(path);
    done.add(path);
  }
  for (const path of graph.nodes.keys()) if (path.startsWith('src/')) cycle(path);
  const reachable = new Set();
  function checkDOM(path) {
    if (reachable.has(path)) return;
    reachable.add(path);
    const node = graph.nodes.get(path);
    if (node?.dom) errors.push(`${path}: DOM use reachable from core`);
    for (const dependency of node?.dependencies ?? []) checkDOM(dependency);
  }
  for (const path of graph.nodes.keys()) if (path.startsWith('src/core/')) checkDOM(path);
  return [...new Set(errors)];
}
export function checkLayers(root = process.cwd(), options = {}) {
  const errors = validateLayers(buildModuleGraph(root), options);
  if (errors.length) throw new Error(errors.join('\n'));
}
export function affectedTests(graph, changed) {
  const tests = graph.files.filter((path) => /\.test\.(m?js|cjs)$/.test(path));
  if (!changed?.length || graph.errors.length || changed.some((path) => !graph.nodes.has(path)))
    return tests;
  const changedSet = new Set(changed);
  function affected(path, seen = new Set()) {
    if (changedSet.has(path) || graph.nodes.get(path)?.opaqueInputs) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    return [...(graph.nodes.get(path)?.dependencies ?? [])].some((dependency) =>
      affected(dependency, seen),
    );
  }
  return tests.filter((path) => affected(path));
}
