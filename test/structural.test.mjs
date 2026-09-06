import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildModuleGraph, validateLayers, affectedTests } from '../scripts/module-graph.mjs';
import { runModuleCheck } from '../scripts/run-check.mjs';
function fixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'sim-structural-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => rmSync(root, { recursive: true, force: true }));
}
test('allowed graph passes and re-exported forbidden edge fails', () =>
  fixture(
    {
      'src/model/a.mjs': 'export const x=1;',
      'src/core/a.mjs': "export {x} from '../model/a.mjs';",
    },
    (root) => {
      assert.deepEqual(validateLayers(buildModuleGraph(root)), []);
      writeFileSync(join(root, 'src/model/a.mjs'), "export * from '../core/a.mjs';");
      assert.match(validateLayers(buildModuleGraph(root)).join('\n'), /forbidden|cycle/);
    },
  ));
test('law imports, indirect DOM and nonliteral loading fail closed', () =>
  fixture(
    {
      'src/core/a.mjs': "import '../model/a.mjs';",
      'src/model/a.mjs': 'export const x = globalThis.document;',
      'src/simulation/physics/law/a.mjs': "import x from 'node:fs'; import(somePath);",
    },
    (root) => {
      const errors = validateLayers(buildModuleGraph(root));
      assert.match(errors.join('\n'), /DOM/);
      assert.match(errors.join('\n'), /law/);
      assert.match(errors.join('\n'), /nonliteral/);
    },
  ));
test('cycles and unknown source directories fail', () =>
  fixture(
    {
      'src/model/a.mjs': "import './b.mjs';",
      'src/model/b.mjs': "import './a.mjs';",
      'src/mystery/a.mjs': 'export const x=1;',
    },
    (root) =>
      assert.match(
        validateLayers(buildModuleGraph(root)).join('\n'),
        /cycle[\s\S]*unknown layer|unknown layer[\s\S]*cycle/,
      ),
  ));
test('affected tests follow data and transitive imports; unknown changes fall back to all', () =>
  fixture(
    {
      'src/model/a.mjs':
        "import data from '../../config/runtime.json' with { type: 'json' }; export default data;",
      'config/runtime.json': '{}',
      'test/a.test.mjs': "import '../src/model/a.mjs';",
      'test/b.test.mjs': 'export {};',
    },
    (root) => {
      const graph = buildModuleGraph(root);
      assert.deepEqual(affectedTests(graph, ['config/runtime.json']), ['test/a.test.mjs']);
      assert.equal(affectedTests(graph, ['new-unknown.txt']).length, 2);
    },
  ));
test('external deadline kills synchronous blocking check; positive control completes', () =>
  fixture(
    {
      'check.mjs': 'export function block(){while(true){}} export function pass(){return 42;}',
    },
    async (root) => {
      await runModuleCheck(join(root, 'check.mjs'), 'pass', [], { timeoutMs: 1000 });
      const start = performance.now();
      await assert.rejects(
        runModuleCheck(join(root, 'check.mjs'), 'block', [], { timeoutMs: 80 }),
        /timed out/,
      );
      assert.ok(performance.now() - start < 1500);
    },
  ));
test('resource URLs and fetch track dependencies and computed resources fail closed', () =>
  fixture(
    {
      'src/application/a.mjs':
        "const x=new URL('/config/runtime.json',import.meta.url); fetch('/config/runtime.json');",
      'config/runtime.json': '{}',
    },
    (root) => {
      const graph = buildModuleGraph(root);
      assert.deepEqual(
        [...graph.nodes.get('src/application/a.mjs').dependencies],
        ['config/runtime.json'],
      );
      writeFileSync(
        join(root, 'src/application/a.mjs'),
        'new URL(computed,import.meta.url); fetch(computed);',
      );
      assert.match(buildModuleGraph(root).errors.join('\n'), /nonliteral resource/);
      const declared = buildModuleGraph(root, {
        dataDependencies: { 'src/application/a.mjs': ['../../config/runtime.json'] },
      });
      assert.deepEqual(declared.errors, []);
    },
  ));

test('symlinked source cannot silently evade the graph', () =>
  fixture(
    {
      'outside.mjs': 'export const x=1;',
    },
    (root) => {
      mkdirSync(join(root, 'src/model'), { recursive: true });
      symlinkSync(join(root, 'outside.mjs'), join(root, 'src/model/hidden.mjs'));
      assert.match(validateLayers(buildModuleGraph(root)).join('\n'), /symlink/);
    },
  ));
test('HTML and CSS close over local resources including excluded directories', () =>
  fixture(
    {
      'index.html':
        '<script type="module" src="./scripts/client.mjs"></script><link rel="stylesheet" href="./docs/app.css"><img src="./docs/pic.svg">',
      'scripts/client.mjs': "import '../docs/config.json' with {type:'json'};",
      'docs/app.css': '@import "./nested.css"; .x {background:url("./pic.svg")}',
      'docs/nested.css': '.x {color:red}',
      'docs/pic.svg': '<svg/>',
      'docs/config.json': '{}',
      'docs/unrelated.md': 'not imported',
    },
    (root) => {
      const graph = buildModuleGraph(root, { entrypoints: ['index.html'] });
      assert.deepEqual(graph.errors, []);
      assert.deepEqual([...graph.nodes.keys()].sort(), [
        'docs/app.css',
        'docs/config.json',
        'docs/nested.css',
        'docs/pic.svg',
        'index.html',
        'scripts/client.mjs',
      ]);
      writeFileSync(join(root, 'docs/nested.css'), '@import "./missing.css";');
      assert.match(
        buildModuleGraph(root, { entrypoints: ['index.html'] }).errors.join('\n'),
        /unresolved dependency/,
      );
    },
  ));
test('inline HTML modules and CSS escapes resolve, dynamic inline loads refuse', () =>
  fixture(
    {
      'index.html':
        '<script type="module">import "./docs/config.json" with {type:"json"};</script><style>.a { background: url(./docs/pic.svg) }</style>',
      'docs/config.json': '{}',
      'docs/pic.svg': '<svg/>',
    },
    (root) => {
      const graph = buildModuleGraph(root, { entrypoints: ['index.html'] });
      assert.deepEqual(graph.errors, []);
      assert.ok(graph.nodes.has('docs/config.json'));
      assert.ok(graph.nodes.has('docs/pic.svg'));
      writeFileSync(join(root, 'index.html'), '<script type="module">import(computed)</script>');
      assert.match(
        buildModuleGraph(root, { entrypoints: ['index.html'] }).errors.join('\n'),
        /nonliteral dynamic import/,
      );
    },
  ));
