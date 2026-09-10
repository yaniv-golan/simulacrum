import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { parse } from 'acorn';
import { buildModuleGraph } from './module-graph.mjs';
// Review equivalence only: execution/build identities remain byte-exact.
function reviewSource(path, value) {
  if (!/\.(?:mjs|cjs|js)$/.test(path)) return value;
  const source = String(value);
  try {
    const spans = [];
    const ast = parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      onToken: (token) => spans.push([token.start, token.end]),
      onComment: (_block, _text, start, end) => spans.push([start, end]),
    });
    const structure = JSON.stringify(ast, (key, val) =>
      ['start', 'end', 'loc', 'range'].includes(key)
        ? undefined
        : typeof val === 'bigint'
          ? `${val}n`
          : val,
    );
    return JSON.stringify([
      structure,
      spans.sort((a, b) => a[0] - b[0]).map(([a, b]) => source.slice(a, b)),
    ]);
  } catch {
    // Fragments or unsupported syntax have no proven formatting equivalence.
    return source;
  }
}
const VERSION = 1;
const sidecarPath = (file, id) =>
  `docs/development/.reviews/${file.slice('docs/development/'.length, -3)}/${id}.json`;
const receiptMetadata = (path) => path.startsWith('docs/development/.reviews/');
const dependencyMap = (value) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.entries(value).every(
    ([key, digest]) => key && typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest),
  );
const hash = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
const walk = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (['position', 'loc'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
};
const text = (node) => node.value ?? node.alt ?? (node.children ?? []).map(text).join('');
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
const implementation = (path) =>
  !path.endsWith('.md') && /\.(?:mjs|cjs|js|ts|mts|json)$/.test(path);
function publicFiles(root) {
  return [
    ...new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
      })
        .split('\0')
        .filter((path) => path.endsWith('.md') && !path.startsWith('docs/internal/')),
    ),
  ];
}
// Metadata may create directories, so validate existing ancestors even when the
// final file does not exist. lstat also rejects dangling symlinks.
function ownedPath(root, path) {
  const absolute = resolve(root, path);
  const within = relative(root, absolute);
  if (within === '..' || within.startsWith('../')) throw Error(`path outside project: ${path}`);
  let current = root;
  for (const component of within.split('/').filter(Boolean)) {
    current = resolve(current, component);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw Error(`unsupported symlink path ${path}; use a project-owned file`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return absolute;
}
function authoredMarkdown(d, start = 0, end = d.source.length) {
  let authored = d.source.slice(start, end);
  for (const node of [...d.receipts].reverse()) {
    if (node.position.start.offset < start || node.position.end.offset > end) continue;
    let a = node.position.start.offset,
      b = node.position.end.offset;
    const lineStart = d.source.lastIndexOf('\n', a - 1) + 1,
      lineEnd = d.source.indexOf('\n', b);
    if (
      !d.source.slice(lineStart, a).trim() &&
      !d.source.slice(b, lineEnd < 0 ? d.source.length : lineEnd).trim()
    ) {
      a = lineStart;
      b = lineEnd < 0 ? d.source.length : lineEnd + 1;
    }
    authored = authored.slice(0, a - start) + authored.slice(b - start);
  }
  return authored;
}
function dispositionError(review) {
  if (!review || !['updated', 'still accurate'].includes(review.disposition))
    return 'disposition must be updated or still accurate';
  if (
    typeof review.rationale !== 'string' ||
    review.rationale.trim().length < 20 ||
    review.rationale.includes('-->')
  )
    return 'rationale must explain the specific technical reason (at least 20 characters, no HTML comment terminator)';
  return null;
}
/** Inspect current references and section receipts. files is a bounded fixture/inventory override. */
export function inspectDocumentation(root = process.cwd(), { files } = {}) {
  root = realpathSync(root);
  const errors = [],
    sections = [],
    generated = [],
    documents = new Map(),
    modules = new Map(),
    graphs = new Map(),
    coverage = new Map(),
    coverageNotes = new Map();
  let publicInventory;
  try {
    publicInventory = new Set(
      execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\0')
        .filter(Boolean),
    );
  } catch {}
  let activeScopeNotes = [];
  const fileHashes = new Map();
  const read = (path) => readFileSync(ownedPath(root, path), 'utf8');
  const fail = (file, id, message) => `${file}${id ? `#${id}` : ''}: ${message}`;
  function local(from, url) {
    const [rawPath, ...fragment] = url.split('#');
    const pathText = decodeURIComponent(rawPath.split('?')[0]);
    const absolute = resolve(
      root,
      pathText.startsWith('/') ? `.${pathText}` : dirname(from),
      pathText.startsWith('/') ? '' : pathText || from.split('/').at(-1),
    );
    const path = relative(root, absolute).replaceAll('\\', '/');
    if (path === 'docs/internal' || path.startsWith('docs/internal/'))
      throw Error(
        `public documentation must not link to internal target ${url}; use a public contract or guide`,
      );
    if (path === '..' || path.startsWith('../') || !existsSync(absolute))
      throw Error(`missing local target ${url}; update the reference to an existing project file`);
    if (realpathSync(absolute) !== absolute)
      throw Error(`unsupported symlink target ${url}; use a project-owned file`);
    return { path, fragment: decodeURIComponent(fragment.join('#')) };
  }
  function document(file) {
    if (documents.has(file)) return documents.get(file);
    const source = read(file),
      ast = fromMarkdown(source),
      headings = [],
      definitions = new Map(),
      links = [],
      receipts = [],
      commands = [];
    walk(ast, (node) => {
      if (node.type === 'heading') headings.push({ id: slug(text(node)), node });
      if (node.type === 'definition') definitions.set(node.identifier, node);
      if (['link', 'image', 'linkReference', 'imageReference'].includes(node.type))
        links.push(node);
      if (node.type === 'html' && node.value.includes('doc-review')) receipts.push(node);
      if (node.type === 'inlineCode') {
        const match = /^npm run\s+([\w:-]+)/.exec(node.value);
        if (match) commands.push({ node, script: match[1] });
      }
    });
    const result = { source, ast, headings, definitions, links, receipts, commands };
    documents.set(file, result);
    return result;
  }
  function graph(path) {
    if (!graphs.has(path)) {
      const result = buildModuleGraph(root, { entrypoints: [path], purpose: 'test-selection' });
      if (result.errors.length)
        throw Error(
          `cannot determine source coverage for ${path}: ${result.errors.join('; ')}; repair source references or unsupported syntax`,
        );
      graphs.set(path, result);
    }
    return graphs.get(path);
  }
  function module(path) {
    if (modules.has(path)) return modules.get(path);
    const source = read(path),
      comments = [],
      ast = parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowHashBang: true,
        onComment: comments,
      }),
      declarations = new Map(),
      imports = new Map();
    let uncertain = false;
    const names = (node) =>
      node?.type === 'Identifier'
        ? [node.name]
        : node?.type === 'ObjectPattern'
          ? node.properties.flatMap((p) => names(p.value ?? p.argument))
          : node?.type === 'ArrayPattern'
            ? node.elements.flatMap(names)
            : node?.type === 'AssignmentPattern'
              ? names(node.left)
              : node?.type === 'RestElement'
                ? names(node.argument)
                : [];
    for (const statement of ast.body) {
      const node = statement.declaration ?? statement;
      if (statement.type === 'ImportDeclaration') {
        for (const specifier of statement.specifiers)
          imports.set(specifier.local.name, {
            statement,
            imported:
              specifier.type === 'ImportSpecifier'
                ? (specifier.imported.name ?? specifier.imported.value)
                : specifier.type === 'ImportDefaultSpecifier'
                  ? 'default'
                  : null,
          });
        continue;
      }
      if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
        if (node.id) declarations.set(node.id.name, { node, statement });
        else if (statement.type === 'ExportDefaultDeclaration')
          declarations.set('default', { node, statement });
      } else if (node.type === 'VariableDeclaration')
        for (const declaration of node.declarations) {
          for (const name of names(declaration.id))
            declarations.set(name, { node: declaration, statement });
          if (
            declaration.init &&
            !['FunctionExpression', 'ArrowFunctionExpression'].includes(declaration.init.type)
          )
            walk(declaration.init, (n) => {
              if (
                [
                  'CallExpression',
                  'NewExpression',
                  'AssignmentExpression',
                  'UpdateExpression',
                  'AwaitExpression',
                ].includes(n.type)
              )
                uncertain = true;
            });
        }
      else if (statement.type === 'ExportNamedDeclaration' && !statement.source) {
        for (const specifier of statement.specifiers)
          if (declarations.has(specifier.local.name))
            declarations.set(specifier.exported.name, declarations.get(specifier.local.name));
      } else if (statement.type !== 'EmptyStatement') uncertain = true;
    }
    const result = { source, ast, comments, declarations, imports, uncertain };
    modules.set(path, result);
    return result;
  }
  function dependenciesFor(path, symbol, implementationOnly = false) {
    const cacheKey = `${path}#${symbol ?? ''}:${implementationOnly}`;
    if (coverage.has(cacheKey)) {
      activeScopeNotes = coverageNotes.get(cacheKey) ?? [];
      return coverage.get(cacheKey);
    }
    const selected = new Map(),
      visited = new Set(),
      notes = new Set();
    if (implementationOnly)
      notes.add(
        `implementation coverage for ${path}: source and declared dependencies; unresolved runtime payload contents excluded`,
      );
    const externalConfig = () => {
      for (const file of ['package.json', 'package-lock.json'])
        if (existsSync(resolve(root, file))) {
          let value = read(file);
          if (file === 'package.json') {
            try {
              const configuration = JSON.parse(value);
              if (
                ![
                  'preinstall',
                  'install',
                  'postinstall',
                  'prepublish',
                  'preprepare',
                  'prepare',
                  'postprepare',
                ].some((name) => Object.hasOwn(configuration.scripts ?? {}, name))
              )
                delete configuration.scripts;
              value = JSON.stringify(configuration);
            } catch {}
          }
          add(file, value);
        }
    };
    const add = (file, value) => {
      if (!selected.has(file)) selected.set(file, new Set());
      selected.get(file).add(reviewSource(file, value));
    };
    const addFull = (file) => {
      if (!fileHashes.has(file))
        fileHashes.set(
          file,
          hash(
            file.endsWith('.md')
              ? authoredMarkdown(document(file))
              : reviewSource(file, readFileSync(ownedPath(root, file))),
          ),
        );
      add(file, `bytes:${fileHashes.get(file)}`);
    };
    function full(file) {
      if (visited.has(`full:${file}`)) return;
      visited.add(`full:${file}`);
      if (/\.(mjs|cjs|js)$/.test(file) || file.endsWith('.d.ts')) {
        const g = graph(file);
        for (const [dependency, node] of g.nodes) {
          if (!receiptMetadata(dependency) && !dependency.startsWith('docs/internal/'))
            addFull(dependency);
          if (node.opaqueInputs && implementationOnly)
            notes.add(
              `implementation coverage for ${dependency}; unresolved runtime payload contents excluded, not a runtime behavior guarantee`,
            );
          if (node.opaqueInputs && !implementationOnly) {
            const inputs = g.files.filter(
              (path) =>
                !receiptMetadata(path) &&
                !path.startsWith('docs/internal/') &&
                (!publicInventory || publicInventory.has(path)),
            );
            for (const input of inputs) addFull(input);
            notes.add(
              `opaque source input in ${dependency}; coverage expanded to ${inputs.length} public files (Markdown excludes review metadata)`,
            );
          }
          if (
            node.imports.some(
              (edge) =>
                !edge.target &&
                !edge.specifier.startsWith('node:') &&
                !edge.specifier.startsWith('.'),
            )
          )
            externalConfig();
        }
      } else addFull(file);
    }
    function scoped(file, name) {
      const key = `${file}:${name}`;
      if (visited.has(key)) return;
      visited.add(key);
      const m = module(file),
        declaration = m.declarations.get(name);
      if (!declaration) {
        let found = 0;
        walk(m.ast, (node) => {
          if (
            (['FunctionDeclaration', 'VariableDeclarator', 'ClassDeclaration'].includes(
              node.type,
            ) &&
              node.id?.name === name) ||
            (['MethodDefinition', 'Property'].includes(node.type) &&
              node.key?.name === name &&
              (node.method || node.type === 'MethodDefinition'))
          )
            found++;
        });
        if (found === 1) {
          full(file);
          return;
        }
        throw Error(
          `${found ? 'ambiguous' : 'missing'} symbol ${name} in ${file}; update #symbol=${name} to its current unique declaration`,
        );
      }
      const g = graph(file);
      if (m.uncertain || g.nodes.get(file)?.opaqueInputs) {
        full(file);
        return;
      }
      const { node, statement } = declaration;
      let start = statement.start;
      const before = m.comments.filter((c) => c.end <= start).at(-1);
      if (before && !m.source.slice(before.end, start).trim()) start = before.start;
      add(file, m.source.slice(start, statement.end));
      const identifiers = new Set();
      walk(node, (n) => {
        if (n.type === 'Identifier') identifiers.add(n.name);
      });
      for (const identifier of identifiers) {
        if (m.declarations.has(identifier)) scoped(file, identifier);
        const imported = m.imports.get(identifier);
        if (imported) {
          add(file, m.source.slice(imported.statement.start, imported.statement.end));
          const specifier = imported.statement.source.value,
            target = g.nodes
              .get(file)
              ?.imports.find((edge) => edge.specifier === specifier)?.target;
          if (
            target &&
            /\.(mjs|cjs|js)$/.test(target) &&
            imported.imported &&
            imported.imported !== 'default'
          )
            scoped(target, imported.imported);
          else if (target) full(target);
          else if (!specifier.startsWith('node:')) externalConfig();
        }
      }
      for (const statement of m.ast.body.filter(
        (n) => n.type === 'ImportDeclaration' && n.specifiers.length === 0,
      )) {
        add(file, m.source.slice(statement.start, statement.end));
        const target = g.nodes
          .get(file)
          ?.imports.find((edge) => edge.specifier === statement.source.value)?.target;
        if (target) full(target);
      }
      for (const edge of g.nodes.get(file)?.imports ?? [])
        if (edge.target && ['type', 'data', 'runtime-service'].includes(edge.kind))
          full(edge.target);
    }
    if (symbol) scoped(path, symbol);
    else full(path);
    const result = Object.fromEntries(
      [...selected]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, pieces]) => [file, hash([...pieces].sort().join('\n\0\n'))]),
    );
    coverage.set(cacheKey, result);
    coverageNotes.set(cacheKey, [...notes]);
    activeScopeNotes = [...notes];
    return result;
  }
  function target(from, url) {
    activeScopeNotes = [];
    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(url) || url.startsWith('//')) return {};
    const { path, fragment } = local(from, url);
    if (statSync(resolve(root, path)).isDirectory()) {
      if (fragment) throw Error(`unsupported directory anchor ${url}`);
      return {};
    }
    if (path.endsWith('.md')) {
      const d = document(path),
        heading = fragment ? d.headings.find((h) => h.id === fragment) : null;
      if (fragment && !heading)
        throw Error(`missing heading anchor ${fragment} in ${path}; update the Markdown reference`);
      const start = heading?.node.position.start.offset ?? 0,
        end = heading
          ? (d.headings.find(
              (h) => h.node.position.start.offset > start && h.node.depth <= heading.node.depth,
            )?.node.position.start.offset ?? d.source.length)
          : d.source.length;
      const authored = authoredMarkdown(d, start, end);
      return { [path + (fragment ? '#' + fragment : '')]: hash(authored) };
    }
    if (fragment === 'source') {
      if (!/\.(mjs|cjs|js|css)$/.test(path))
        throw Error(`unsupported source scope ${url}; reference JavaScript or CSS`);
      if (!path.endsWith('.css')) module(path); // JavaScript must parse; CSS scope binds bytes.
      activeScopeNotes = [
        `direct source coverage for ${path}; imported behavior requires explicit dependency links or implementation scope`,
      ];
      return { [path]: hash(reviewSource(path, read(path))) };
    }
    if (fragment === 'implementation') {
      if (!/\.(mjs|cjs|js)$/.test(path))
        throw Error(`unsupported implementation scope ${url}; reference a JavaScript module`);
      return dependenciesFor(path, undefined, true);
    }
    if (fragment.startsWith('symbol=')) {
      if (!/\.(mjs|cjs|js)$/.test(path))
        throw Error(`unsupported symbol scope ${url}; reference a JavaScript declaration`);
      return dependenciesFor(path, fragment.slice(7));
    }
    if (fragment) {
      const [kind, id, ...extra] = fragment.split('=');
      if (!id || extra.length) throw Error(`unsupported reference fragment ${url}`);
      const value = JSON.parse(read(path));
      let selected;
      if (path === 'package.json' && kind === 'script') selected = value.scripts?.[id];
      else if (path === 'scripts/manifest.json' && kind === 'rule')
        selected = value.rules?.find((row) => row.id === id);
      else if (path === 'scripts/manifest.json' && kind === 'check')
        selected = [...(value.checks ?? []), ...(value.browserChecks ?? [])].find(
          (row) => row.id === id,
        );
      else if (path === 'scripts/manifest.json' && kind === 'bar') selected = value.bars?.[id];
      else throw Error(`unsupported canonical reference ${url}`);
      if (selected === undefined)
        throw Error(`missing ${kind} ${id} in ${path}; update the documented canonical reference`);
      return { [`${path}#${fragment}`]: hash(stable(selected)) };
    }
    return implementation(path) ? dependenciesFor(path) : {};
  }
  let inventory;
  try {
    inventory = files ?? publicFiles(root);
  } catch (error) {
    return { errors: [`documentation inventory failed: ${error.message}`], sections, generated };
  }
  for (const file of [...new Set(inventory)].sort()) {
    if (!file.endsWith('.md') || file.startsWith('docs/internal/')) continue;
    let d;
    try {
      d = document(file);
    } catch (error) {
      errors.push(fail(file, null, error.message));
      continue;
    }
    const generatedFile =
      file === 'docs/development/reference.md' &&
      d.ast.children.some(
        (n) => n.type === 'html' && n.value.trim() === '<!-- generated: development-reference -->',
      );
    if (generatedFile) generated.push({ file, marker: 'development-reference' });
    const localSections = d.headings.map((heading, index) => ({
      file,
      id: heading.id,
      start: heading.node.position.start.offset,
      end: d.headings[index + 1]?.node.position.start.offset ?? d.source.length,
      headingEnd: heading.node.position.end.offset,
      dependencies: {},
      references: [],
      issues: [],
      receipts: [],
      scopeNotes: [],
    }));
    const sectionFor = (node) =>
      localSections.find(
        (row) => node.position.start.offset >= row.start && node.position.start.offset < row.end,
      );
    const seen = new Set();
    for (const row of localSections) {
      if (!row.id || seen.has(row.id)) {
        const message = fail(
          file,
          row.id,
          'duplicate or empty heading ID; give each heading a unique stable name',
        );
        errors.push(message);
        row.issues.push(message);
      }
      seen.add(row.id);
    }
    function checkReference(node, url) {
      const row = sectionFor(node);
      try {
        const dependencies = target(file, url);
        if (
          !row &&
          file.startsWith('docs/development/') &&
          !generatedFile &&
          Object.keys(dependencies).length
        )
          throw Error(
            'implementation or contract reference has no owning heading; add a stable section heading and review it',
          );
        if (row) {
          for (const [path, fingerprint] of Object.entries(dependencies)) {
            const previous = row.dependencies[path];
            row.dependencies[path] =
              previous && previous !== fingerprint
                ? hash([previous, fingerprint].sort().join('\0'))
                : fingerprint;
          }
          row.references.push(url);
          for (const note of activeScopeNotes)
            if (!row.scopeNotes.includes(note)) row.scopeNotes.push(note);
        }
      } catch (error) {
        const message = fail(file, row?.id, error.message);
        errors.push(message);
        row?.issues.push(message);
      }
    }
    for (const link of d.links) {
      const definition = d.definitions.get(link.identifier),
        url = link.url ?? definition?.url;
      if (url !== undefined) checkReference(link, url);
    }
    for (const command of d.commands)
      checkReference(
        command.node,
        `${relative(dirname(file), 'package.json').replaceAll('\\', '/')}#script=${command.script}`,
      );
    for (const node of d.receipts) {
      const row = sectionFor(node);
      if (!row) {
        errors.push(fail(file, null, 'doc-review receipt has no owning heading'));
        continue;
      }
      row.receipts.push(node);
    }
    for (const row of localSections) {
      const authoredScope = file.startsWith('docs/development/') && !generatedFile;
      if (
        !authoredScope ||
        (!Object.keys(row.dependencies).length && !row.issues.length && !row.receipts.length)
      )
        continue;
      let authored = d.source.slice(row.start, row.end),
        review = null,
        reviewDependencies = null;
      const spans = row.receipts.map((node) => {
        let start = node.position.start.offset,
          end = node.position.end.offset;
        const lineStart = d.source.lastIndexOf('\n', start - 1) + 1,
          lineEnd = d.source.indexOf('\n', end);
        if (
          !d.source.slice(lineStart, start).trim() &&
          !d.source.slice(end, lineEnd < 0 ? d.source.length : lineEnd).trim()
        ) {
          start = lineStart;
          end = lineEnd < 0 ? d.source.length : lineEnd + 1;
        }
        return { start, end };
      });
      for (const span of [...spans].sort((a, b) => b.start - a.start))
        authored = authored.slice(0, span.start - row.start) + authored.slice(span.end - row.start);
      if (row.receipts.length > 1) {
        const message = fail(
          file,
          row.id,
          'duplicate doc-review receipts; retain exactly one section receipt',
        );
        row.issues.push(message);
        errors.push(message);
      }
      if (row.receipts.length === 1)
        try {
          const match = /^<!--\s*doc-review\s+(\{[\s\S]*\})\s*-->$/.exec(
            row.receipts[0].value.trim(),
          );
          if (!match) throw Error('expected a JSON receipt');
          review = JSON.parse(match[1]);
          if (
            Object.keys(review).sort().join(',') !==
              'dependencies,dependencyDigest,disposition,fingerprint,rationale,version' ||
            review.version !== VERSION ||
            typeof review.fingerprint !== 'string' ||
            !/^[a-f0-9]{64}$/.test(review.fingerprint) ||
            review.dependencies !== sidecarPath(file, row.id) ||
            typeof review.dependencyDigest !== 'string' ||
            !/^[a-f0-9]{64}$/.test(review.dependencyDigest) ||
            dispositionError(review)
          )
            throw Error('invalid version, identity, dependency sidecar or disposition/rationale');
          const sidecar = JSON.parse(read(review.dependencies));
          if (
            Object.keys(sidecar).sort().join(',') !== 'dependencies,version' ||
            sidecar.version !== VERSION ||
            !dependencyMap(sidecar.dependencies) ||
            hash(stable(sidecar.dependencies)) !== review.dependencyDigest
          )
            throw Error(`dependency sidecar digest or map mismatch: ${review.dependencies}`);
          reviewDependencies = sidecar.dependencies;
        } catch (error) {
          errors.push(
            fail(
              file,
              row.id,
              `malformed doc-review receipt: ${error.message}; record a valid section review`,
            ),
          );
          review = null;
        }
      const fingerprint = hash(
        stable({
          version: VERSION,
          file,
          id: row.id,
          authored,
          references: row.references,
          dependencies: row.dependencies,
        }),
      );
      const stale =
        !review ||
        review.fingerprint !== fingerprint ||
        stable(reviewDependencies) !== stable(row.dependencies);
      if (stale) {
        const changed = Object.keys({ ...reviewDependencies, ...row.dependencies }).filter(
          (path) => reviewDependencies?.[path] !== row.dependencies[path],
        );
        errors.push(
          fail(
            file,
            row.id,
            `${review ? 'stale' : 'missing'} documentation review${changed.length ? `; changed dependencies: ${changed.join(', ')}` : ''}; run npm run docs:review -- ${file} ${row.id} \"still accurate\" \"specific technical rationale\" (or use disposition updated after revising the section)`,
          ),
        );
      }
      sections.push({
        ...row,
        fingerprint,
        review,
        reviewDependencies,
        stale,
        receiptSpans: spans,
      });
    }
  }
  return { errors, sections, generated };
}
function prepareReview(root, file, id, { disposition, rationale } = {}) {
  root = realpathSync(root);
  const invalid = dispositionError({ disposition, rationale });
  if (invalid) throw Error(invalid);
  if (!/^docs\/development\/.+\.md$/.test(file) || file.split('/').includes('..'))
    throw Error('review scope must be one public developer document');
  const before = readFileSync(ownedPath(root, file), 'utf8');
  const inspected = inspectDocumentation(root, { files: [file] }),
    matches = inspected.sections.filter((row) => row.id === id),
    section = matches[0];
  if (matches.length > 1)
    throw Error(`duplicate section ID ${file}#${id}; choose unique headings before review`);
  if (!section) throw Error(`unknown implementation-backed section ${file}#${id}`);
  if (section.issues.length) throw Error(section.issues.join('\n'));
  return { before, section };
}

/** Each row is a separate reviewed decision. Validate the whole submission before writing. */
export function reviewSections(root, rows) {
  if (!Array.isArray(rows) || !rows.length) throw Error('review batch must be a nonempty array');
  const seen = new Set();
  for (const row of rows) {
    if (!row || Object.keys(row).sort().join(',') !== 'disposition,file,id,rationale')
      throw Error('each review needs file, id, disposition and rationale');
    const key = `${row.file}#${row.id}`;
    if (seen.has(key)) throw Error(`duplicate review: ${key}`);
    seen.add(key);
    prepareReview(root, row.file, row.id, row);
  }
  // Revalidate each section at write time. A concurrent change can stop the batch;
  // already written individual receipts remain valid, never a blanket approval.
  return rows.map((row) => reviewSection(root, row.file, row.id, row));
}

/** Record exactly one current section disposition; never bulk-accept stale prose. */
export function reviewSection(root, file, id, { disposition, rationale } = {}) {
  root = realpathSync(root);
  const { before, section } = prepareReview(root, file, id, { disposition, rationale });
  const current = inspectDocumentation(root, { files: [file] }).sections.find(
    (row) => row.id === id,
  );
  if (
    readFileSync(ownedPath(root, file), 'utf8') !== before ||
    current?.fingerprint !== section.fingerprint
  )
    throw Error('documentation or source changed during review; inspect again');
  const review = {
    version: VERSION,
    fingerprint: section.fingerprint,
    dependencies: sidecarPath(file, id),
    dependencyDigest: hash(stable(section.dependencies)),
    disposition,
    rationale: rationale.trim(),
  };
  const comment = `<!-- doc-review ${JSON.stringify(review)} -->`;
  let next;
  if (section.receipts.length) {
    const receipt = section.receipts[0];
    next =
      before.slice(0, receipt.position.start.offset) +
      comment +
      before.slice(receipt.position.end.offset);
  } else
    next = before.slice(0, section.headingEnd) + '\n' + comment + before.slice(section.headingEnd);
  mkdirSync(dirname(ownedPath(root, review.dependencies)), { recursive: true });
  writeFileSync(
    ownedPath(root, review.dependencies),
    JSON.stringify({ version: VERSION, dependencies: section.dependencies }, null, 2) + '\n',
  );
  writeFileSync(ownedPath(root, file), next);
  return review;
}
