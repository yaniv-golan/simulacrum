import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { inspectDocumentation, reviewSection } from '../scripts/documentation.mjs';

const document = 'docs/development/guide.md';
const receipt = {
  disposition: 'still accurate',
  rationale:
    'This explanation describes implementation and explicitly linked configuration inputs.',
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'documentation-scope-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  };
  put('package.json', JSON.stringify({ scripts: {} }));
  put(
    'scripts/reader.mjs',
    "import {readFileSync} from 'node:fs'; export function read(path){return readFileSync(path,'utf8');}\n",
  );
  put('payload.json', '{"enabled":true}\n');
  return {
    root,
    put,
    inspect: () => inspectDocumentation(root, { files: [document] }),
    review: (id = 'owner') => reviewSection(root, document, id, receipt),
  };
}

for (const order of ['implementation-first', 'default-first']) {
  test(`mixed scopes retain conservative coverage in ${order} order`, (t) => {
    const f = fixture(t);
    const links = [
      '[implementation](../../scripts/reader.mjs#implementation)',
      '[default](../../scripts/reader.mjs)',
    ];
    if (order === 'default-first') links.reverse();
    f.put(document, `# Owner\n${links.join('\n')}\n`);
    f.review();
    assert.deepEqual(f.inspect().errors, []);
    f.put('payload.json', '{"enabled":false}\n');
    assert.equal(f.inspect().sections[0].stale, true);
    assert.match(f.inspect().errors.join('\n'), /payload.json/);
  });
}

test('explicit runtime payload link remains binding under implementation coverage', (t) => {
  const f = fixture(t);
  f.put(
    document,
    '# Owner\n[reader](../../scripts/reader.mjs#implementation) uses [policy](../../payload.json).\n',
  );
  f.review();
  assert.deepEqual(f.inspect().errors, []);
  f.put('payload.json', '{"enabled":false}\n');
  assert.equal(f.inspect().sections[0].stale, true);
  assert.match(f.inspect().errors.join('\n'), /payload.json/);
});

test('changing only the scope fragment requires a new review', (t) => {
  const f = fixture(t);
  f.put(document, '# Owner\n[reader](../../scripts/reader.mjs)\n');
  f.review();
  assert.deepEqual(f.inspect().errors, []);
  f.put(
    document,
    readFileSync(join(f.root, document), 'utf8').replace(
      'reader.mjs)',
      'reader.mjs#implementation)',
    ),
  );
  assert.equal(f.inspect().sections[0].stale, true);
});

for (const dependency of [
  'scripts/helper.mjs',
  'scripts/policy.json',
  'src/application/value.d.ts',
  'src/application/scalar.d.ts',
  'scripts/service.mjs',
  'package.json',
  'package-lock.json',
]) {
  test(`implementation coverage binds resolved ${dependency}`, (t) => {
    const f = fixture(t);
    f.put(
      'package.json',
      JSON.stringify({
        scripts: {},
        dependencies: { acorn: '8.15.0' },
        moduleGraph: {
          runtimeNetworkDependencies: {
            'src/application/client.mjs': {
              namespace: '/api/scope/',
              service: '../../scripts/service.mjs',
              dynamicFetchArguments: [],
            },
          },
        },
      }),
    );
    f.put('package-lock.json', '{"lockfileVersion":3}\n');
    f.put(
      'src/application/client.mjs',
      "import '../../scripts/helper.mjs'; import 'acorn';\n/** @type {import('./value.js').Value} */\nexport const value={x:1};\n",
    );
    f.put(
      'scripts/helper.mjs',
      "import {readFileSync} from 'node:fs'; export const policy=readFileSync(new URL('./policy.json',import.meta.url),'utf8');\n",
    );
    f.put('scripts/policy.json', '{"enabled":true}\n');
    f.put(
      'src/application/value.d.ts',
      "import type {Scalar} from './scalar.js'; export interface Value {x:Scalar}\n",
    );
    f.put('src/application/scalar.d.ts', 'export type Scalar=number;\n');
    f.put('scripts/service.mjs', 'export const limit=1;\n');
    f.put(document, '# Owner\n[client](../../src/application/client.mjs#implementation)\n');
    f.review();
    assert.deepEqual(f.inspect().errors, []);
    const before = readFileSync(join(f.root, dependency), 'utf8');
    f.put(
      dependency,
      dependency.endsWith('.json')
        ? JSON.stringify({ ...JSON.parse(before), changed: true })
        : `${before}\n// changed implementation\n`,
    );
    assert.equal(f.inspect().sections[0].stale, true);
    assert.ok(f.inspect().sections[0].dependencies[dependency], dependency);
    assert.match(f.inspect().errors.join('\n'), /stale documentation review/);
  });
}

for (const [name, broken, diagnostic] of [
  ['missing static import', "import './absent.mjs'; export const value=1;", /missing|unresolved/],
  [
    'nonliteral dynamic import',
    'export function load(path){return import(path)}',
    /nonliteral dynamic import/,
  ],
  ['invalid syntax', 'export function {', /parse|Unexpected/],
]) {
  test(`implementation scope refuses ${name}`, (t) => {
    const f = fixture(t);
    f.put(document, '# Owner\n[reader](../../scripts/reader.mjs#implementation)\n');
    f.review();
    assert.deepEqual(f.inspect().errors, []);
    f.put('scripts/reader.mjs', broken);
    assert.match(f.inspect().errors.join('\n'), diagnostic);
    assert.throws(() => f.review(), diagnostic);
  });
}
