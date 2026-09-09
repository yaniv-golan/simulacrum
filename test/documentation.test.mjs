import test from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync, renameSync } from 'node:fs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { inspectDocumentation, reviewSection } from '../scripts/documentation.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'documentation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  put('package.json', JSON.stringify({ scripts: { ci: 'node scripts/ci.mjs' } }));
  put(
    'scripts/manifest.json',
    JSON.stringify({
      rules: [{ id: 'ownership' }],
      checks: [{ id: 'layers' }],
      bars: { F2: { check: 'response' } },
    }),
  );
  put(
    'src/model/tool.mjs',
    'const helper = x => x + 1;\nexport function run(x) { return helper(x); }\nexport function unrelated() { return 9; }\n',
  );
  return {
    root,
    put,
    inspect: (files = ['docs/development/guide.md']) => inspectDocumentation(root, { files }),
  };
}
const receipt = {
  disposition: 'still accurate',
  rationale: 'The helper still derives its output from the explicitly supplied numeric input.',
};
test('CSS source scope makes layout changes stale without binding unrelated stylesheets', (t) => {
  const f = fixture(t);
  f.put('src/presentation/layout.css', '.tools { font-size: 14px; }');
  f.put(
    'docs/development/guide.md',
    '# Layout\n[layout](../../src/presentation/layout.css#source) keeps controls readable.\n',
  );
  assert.equal(
    f.inspect().errors.some((x) => x.includes('unsupported source scope')),
    false,
  );
  reviewSection(f.root, 'docs/development/guide.md', 'layout', receipt);
  assert.deepEqual(f.inspect().errors, []);
  f.put('src/presentation/unrelated.css', '.other { color: red; }');
  assert.deepEqual(f.inspect().errors, []);
  f.put('src/presentation/layout.css', '.tools { font-size: 8px; }');
  assert.match(f.inspect().errors.join('\n'), /stale documentation review/);
});
test('Markdown references, anchors, symbols and canonical commands/IDs validate; fences are examples', (t) => {
  const f = fixture(t);
  f.put('README.md', '# Start\nSee [guide][g].\n[g]: docs/development/guide.md#owner\n');
  f.put(
    'docs/development/guide.md',
    '# Owner\nUses [run](../../src/model/tool.mjs#symbol=run), [script](../../package.json#script=ci), [rule](../../scripts/manifest.json#rule=ownership), [check](../../scripts/manifest.json#check=layers), [bar](../../scripts/manifest.json#bar=F2).\n`npm run ci`\n```sh\nnpm run nonexistent\n[missing](not-a-file)\n```\n',
  );
  assert.ok(
    f
      .inspect(['README.md', 'docs/development/guide.md'])
      .errors.some((x) => /missing.*review/i.test(x)),
  );
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  assert.deepEqual(f.inspect(['README.md', 'docs/development/guide.md']).errors, []);
  f.put('README.md', '# Start\n[wrong][g]\n\n[g]: docs/development/guide.md#missing\n');
  assert.match(f.inspect(['README.md']).errors.join('\n'), /missing.*anchor/i);
  f.put('README.md', '# Start\n`npm run gone`\n');
  assert.match(f.inspect(['README.md']).errors.join('\n'), /gone/);
});
test('symbol behavior/helper changes and section prose stale only relevant receipts', (t) => {
  const f = fixture(t);
  f.put(
    'docs/development/guide.md',
    '# Owner\n[run](../../src/model/tool.mjs#symbol=run) computes the result.\n\n# Other\n[other](../../src/model/tool.mjs#symbol=unrelated) is separate.\n',
  );
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  reviewSection(f.root, 'docs/development/guide.md', 'other', {
    disposition: 'updated',
    rationale: 'This section describes the independent exported constant-returning helper.',
  });
  assert.deepEqual(f.inspect().errors, []);
  f.put('test/unrelated.test.mjs', '// changed outside covered sources\n');
  assert.deepEqual(f.inspect().errors, []);
  f.put(
    'src/model/tool.mjs',
    'const helper = x => x + 2;\nexport function run(x) { return helper(x); }\nexport function unrelated() { return 9; }\n',
  );
  assert.deepEqual(
    f
      .inspect()
      .sections.filter((x) => x.stale)
      .map((x) => x.id),
    ['owner'],
  );
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  assert.deepEqual(f.inspect().errors, []);
  const file = join(f.root, 'docs/development/guide.md');
  writeFileSync(
    file,
    readFileSync(file, 'utf8').replace('computes the result', 'computes a revised result'),
  );
  assert.deepEqual(
    f
      .inspect()
      .sections.filter((x) => x.stale)
      .map((x) => x.id),
    ['owner'],
  );
  assert.throws(
    () =>
      reviewSection(f.root, 'docs/development/guide.md', 'owner', {
        disposition: 'still accurate',
        rationale: 'okay',
      }),
    /rationale/i,
  );
});
test('missing symbols, broken source imports, malformed receipts and duplicate IDs fail actionably', (t) => {
  const f = fixture(t);
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=gone)\n');
  assert.match(f.inspect().errors.join('\n'), /gone/);
  assert.throws(() => reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt), /gone/);
  f.put(
    'docs/development/guide.md',
    '# Owner\n<!-- doc-review nope -->\n[run](../../src/model/tool.mjs#symbol=run)\n',
  );
  assert.match(f.inspect().errors.join('\n'), /malformed/i);
  f.put(
    'docs/development/guide.md',
    '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n# Owner\nAgain\n',
  );
  assert.match(f.inspect().errors.join('\n'), /duplicate/i);
  f.put('docs/development/guide.md', '# Owner\n[module](../../src/model/tool.mjs)\n');
  f.put('src/model/tool.mjs', "import './missing.mjs'; export const run=1;");
  assert.match(f.inspect().errors.join('\n'), /missing.mjs/);
});
test('whole modules and imported helpers are covered; generated documents need no authored receipt', (t) => {
  const f = fixture(t);
  f.put('src/model/helper.mjs', 'export const adjust = x => x + 1;');
  f.put(
    'src/model/tool.mjs',
    "import {adjust} from './helper.mjs'; export function run(x){return adjust(x);}",
  );
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n');
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  f.put('src/model/helper.mjs', 'export const adjust = x => x + 2;');
  assert.equal(f.inspect().sections[0].stale, true);
  f.put(
    'docs/development/reference.md',
    '<!-- generated: development-reference -->\n# Commands\n[ci](../../package.json#script=ci)\n',
  );
  assert.deepEqual(f.inspect(['docs/development/reference.md']).errors, []);
});
test('referenced Markdown contracts bind authored text, never receipt metadata or recursive references', (t) => {
  const f = fixture(t);
  f.put(
    'docs/contracts/runtime.md',
    '# Runtime\n[back](../development/guide.md)\n## Ownership\nOne owner writes each quantity.\n',
  );
  f.put(
    'docs/development/guide.md',
    '# Owner\n[contract](../contracts/runtime.md#ownership) governs this implementation.\n',
  );
  assert.equal(f.inspect().sections.length, 1);
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  assert.deepEqual(f.inspect().errors, []);
  const reviewed = JSON.stringify({
    version: 1,
    fingerprint: 'a'.repeat(64),
    dependencies: {},
    ...receipt,
  });
  f.put(
    'docs/contracts/runtime.md',
    `# Runtime\n[back](../development/guide.md)\n## Ownership\n<!-- doc-review ${reviewed} -->\nOne owner writes each quantity.\n`,
  );
  assert.deepEqual(f.inspect().errors, [], 'receipt metadata is not authored contract text');
  f.put(
    'docs/contracts/runtime.md',
    '# Runtime\n[back](../development/guide.md)\n## Ownership\nTwo owners may write the same quantity.\n',
  );
  assert.equal(f.inspect().sections[0].stale, true);
  f.put('docs/internal/private.md', '# Private\n');
  f.put('README.md', '[private](docs/internal/private.md)');
  assert.match(f.inspect(['README.md']).errors.join('\n'), /internal/i);
});
test('external resolved dependencies and opaque module behavior invalidate scoped provenance', (t) => {
  const f = fixture(t);
  f.put('package-lock.json', '{"version":1}');
  f.put(
    'src/model/tool.mjs',
    "import {work} from 'some-package'; export function run(x){return work(x);}",
  );
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n');
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  f.put('package-lock.json', '{"version":2}');
  assert.equal(f.inspect().sections[0].stale, true);
  f.put(
    'scripts/opaque.mjs',
    "import {readFileSync} from 'node:fs'; export function run(p){return readFileSync(p)} export function other(){return 1}",
  );
  f.put('docs/development/guide.md', '# Owner\n[run](../../scripts/opaque.mjs#symbol=run)\n');
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  f.put(
    'scripts/opaque.mjs',
    "import {readFileSync} from 'node:fs'; export function run(p){return readFileSync(p)} export function other(){return 2}",
  );
  assert.equal(f.inspect().sections[0].stale, true);
});
test('developer implementation references cannot evade provenance by removing their heading', (t) => {
  const f = fixture(t);
  f.put('docs/development/guide.md', '[run](../../src/model/tool.mjs#symbol=run)\n');
  assert.match(f.inspect().errors.join('\n'), /owning heading/);
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n');
  assert.match(f.inspect().errors.join('\n'), /npm run docs:review/);
});
test('opaque file readers cover otherwise unreferenced public data with a stated fallback', (t) => {
  const f = fixture(t);
  f.put('policy.json', '{"limit":1}');
  f.put(
    'scripts/opaque.mjs',
    "import {readFileSync} from 'node:fs'; const path='policy.json'; export function run(){return readFileSync(path,'utf8')}",
  );
  f.put('docs/development/guide.md', '# Owner\n[run](../../scripts/opaque.mjs#symbol=run)\n');
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  f.put('policy.json', '{"limit":2}');
  const row = f.inspect().sections[0];
  assert.equal(row.stale, true);
  assert.ok(row.scopeNotes.some((note) => /opaque.*public/.test(note)));
});
test('copied receipts, removed canonical IDs and unresolved dynamic scope cannot turn green', (t) => {
  const f = fixture(t);
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n');
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  const saved = readFileSync(join(f.root, 'docs/development/guide.md'), 'utf8');
  f.put('docs/development/other.md', saved);
  assert.equal(f.inspect(['docs/development/other.md']).sections[0].stale, true);
  for (const reference of [
    '../../package.json#script=absent',
    '../../scripts/manifest.json#rule=absent',
    '../../scripts/manifest.json#check=absent',
    '../../scripts/manifest.json#bar=absent',
  ]) {
    f.put('docs/development/guide.md', `# Owner\n[missing](${reference})\n`);
    assert.match(f.inspect().errors.join('\n'), /missing.*absent/);
  }
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n');
  f.put('src/model/tool.mjs', 'export function run(path){return import(path)}');
  assert.match(f.inspect().errors.join('\n'), /nonliteral dynamic import/);
});
test('section sidecars keep prose compact and refuse missing or tampered dependency metadata', (t) => {
  const f = fixture(t);
  f.put('docs/development/guide.md', '# Owner\n[run](../../src/model/tool.mjs#symbol=run)\n');
  const review = reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  assert.equal(typeof review.dependencies, 'string');
  assert.match(review.dependencies, /docs\/development\/\.reviews\/guide\/owner\.json$/);
  const file = join(f.root, review.dependencies),
    sidecar = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(sidecar.dependencies['src/model/tool.mjs']);
  assert.deepEqual(f.inspect().errors, []);
  sidecar.dependencies['src/model/tool.mjs'] = '0'.repeat(64);
  writeFileSync(file, JSON.stringify(sidecar));
  assert.match(f.inspect().errors.join('\n'), /sidecar|digest/i);
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  rmSync(file);
  assert.match(f.inspect().errors.join('\n'), /sidecar|ENOENT/);
});
test('opaque section receipts and sidecars never invalidate another section review', (t) => {
  const f = fixture(t);
  f.put(
    'scripts/opaque.mjs',
    "import {readFileSync} from 'node:fs'; export function run(path){return readFileSync(path)}",
  );
  f.put(
    'docs/development/guide.md',
    '# First\n[run](../../scripts/opaque.mjs#symbol=run)\n# Second\n[run](../../scripts/opaque.mjs#symbol=run)\n',
  );
  reviewSection(f.root, 'docs/development/guide.md', 'first', receipt);
  reviewSection(f.root, 'docs/development/guide.md', 'second', receipt);
  assert.deepEqual(f.inspect().errors, []);
  const before = f.inspect().sections.find((row) => row.id === 'second').fingerprint;
  const reviewed = reviewSection(f.root, 'docs/development/guide.md', 'first', {
    ...receipt,
    rationale: 'The opaque reader still uses the same reviewed policy and checked file inputs.',
  });
  const file = join(f.root, reviewed.dependencies);
  writeFileSync(file, JSON.stringify(JSON.parse(readFileSync(file, 'utf8')), null, 4) + '\n');
  assert.deepEqual(f.inspect().errors, []);
  assert.equal(f.inspect().sections.find((row) => row.id === 'second').fingerprint, before);
});
test('public document symlinks cannot redirect review reads or writes outside the project', (t) => {
  const f = fixture(t),
    outside = mkdtempSync(join(tmpdir(), 'documentation-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const source = '# Owner\n[ci](../../package.json#script=ci)\n';
  f.put('docs/development/guide.md', source);
  const target = join(outside, 'guide.md');
  writeFileSync(target, source);
  const link = join(f.root, 'docs/development/guide.md');
  rmSync(link);
  symlinkSync(target, link);
  assert.match(f.inspect().errors.join('\n'), /symlink|outside/i);
  assert.throws(
    () => reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt),
    /symlink|outside/i,
  );
  assert.equal(readFileSync(target, 'utf8'), source);
});
test('review metadata symlink ancestors reject both initial writes and existing sidecar reads', (t) => {
  const f = fixture(t),
    outside = mkdtempSync(join(tmpdir(), 'documentation-metadata-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  f.put('docs/development/guide.md', '# Owner\n[ci](../../package.json#script=ci)\n');
  const directory = join(f.root, 'docs/development/.reviews');
  symlinkSync(outside, directory, 'dir');
  assert.throws(
    () => reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt),
    /symlink|outside/i,
  );
  rmSync(directory);
  const reviewed = reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  renameSync(directory, join(outside, 'valid-reviews'));
  symlinkSync(join(outside, 'valid-reviews'), directory, 'dir');
  assert.match(f.inspect().errors.join('\n'), /symlink|outside/i);
  assert.throws(
    () => reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt),
    /symlink|outside/i,
  );
  assert.ok(
    readFileSync(
      join(outside, 'valid-reviews', reviewed.dependencies.split('/.reviews/')[1]),
      'utf8',
    ),
  );
});

test('opaque readers cover authored Markdown policy while receipt-only changes converge', (t) => {
  const f = fixture(t);
  f.put('policy.md', '# Policy\nlimit=1\n');
  f.put(
    'scripts/reader.mjs',
    "import {readFileSync} from 'node:fs'; const path='policy.md'; export function readPolicy(){return readFileSync(path,'utf8')}",
  );
  f.put(
    'docs/development/guide.md',
    '# Reader\n[implementation](../../scripts/reader.mjs#symbol=readPolicy)\n',
  );
  reviewSection(f.root, 'docs/development/guide.md', 'reader', receipt);
  assert.deepEqual(f.inspect().errors, []);
  const before = f.inspect().sections[0].fingerprint;
  reviewSection(f.root, 'docs/development/guide.md', 'reader', {
    ...receipt,
    rationale: 'The filesystem reader still consumes the same authored policy contents.',
  });
  f.put('policy.md', '# Policy\n<!-- doc-review {"rationale":"metadata only"} -->\nlimit=1\n');
  assert.deepEqual(f.inspect().errors, []);
  assert.equal(f.inspect().sections[0].fingerprint, before);
  f.put('policy.md', '# Policy\nlimit=999\n');
  assert.equal(f.inspect().sections[0].stale, true);
  assert.ok(f.inspect().sections[0].dependencies['policy.md']);
});

test('implementation links cover code and declared inputs without claiming arbitrary runtime payloads', (t) => {
  const f = fixture(t);
  f.put(
    'scripts/reader.mjs',
    "import { readFileSync } from 'node:fs';\nimport { run } from '../src/model/tool.mjs';\nexport const read = path => run(readFileSync(path, 'utf8'));\n",
  );
  f.put('payload.json', '{"value":1}');
  f.put(
    'docs/development/guide.md',
    '# Owner\n[Reader implementation](../../scripts/reader.mjs#implementation) owns file admission.\n',
  );
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  assert.deepEqual(f.inspect().errors, []);
  assert.ok(f.inspect().sections[0].scopeNotes.some((note) => /runtime.*excluded/.test(note)));
  f.put('payload.json', '{"value":2}');
  assert.deepEqual(f.inspect().errors, []);
  f.put('src/model/tool.mjs', 'export const run = x => x + 2;');
  assert.equal(f.inspect().sections[0].stale, true);
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  f.put('scripts/reader.mjs', "import { missing } from './gone.mjs';\n");
  assert.match(f.inspect().errors.join('\n'), /gone|coverage/);
});

test('batch reviews keep per-section decisions, reject invalid batches before writing, and still become stale', async (t) => {
  const { reviewSections } = await import('../scripts/documentation.mjs');
  const f = fixture(t),
    file = 'docs/development/guide.md';
  f.put(
    file,
    '# Owner\n[run](../../src/model/tool.mjs#symbol=run).\n\n# Other\n[other](../../src/model/tool.mjs#symbol=unrelated).\n',
  );
  const rows = ['owner', 'other'].map((id) => ({ file, id, ...receipt }));
  const before = readFileSync(join(f.root, file), 'utf8');
  assert.throws(() => reviewSections(f.root, [...rows, { ...rows[0], id: 'absent' }]));
  assert.equal(readFileSync(join(f.root, file), 'utf8'), before);
  assert.throws(() => reviewSections(f.root, [rows[0], rows[0]]), /duplicate/);
  assert.throws(() => reviewSections(f.root, [{ ...rows[0], rationale: '' }]), /rationale/);
  assert.throws(() => reviewSections(f.root, []), /nonempty/);
  reviewSections(f.root, rows);
  assert.deepEqual(f.inspect().errors, []);
  f.put(
    'src/model/tool.mjs',
    'export function run(x) { return x + 8; }\nexport function unrelated() { return 9; }\n',
  );
  assert.ok(f.inspect().sections.find((s) => s.id === 'owner').stale);
});

test('direct source scope binds module bodies and explicit wider claims without unrelated dependency churn', (t) => {
  const f = fixture(t),
    file = 'docs/development/guide.md';
  f.put('src/model/owner.mjs', "import {run} from './tool.mjs'; export const owner=()=>run(1);\n");
  f.put(
    file,
    '# Owner\n[composition](../../src/model/owner.mjs#source) calls its helper.\n\n# Behavior\n[implementation](../../src/model/owner.mjs#implementation) delegates calculation.\n',
  );
  for (const id of ['owner', 'behavior']) reviewSection(f.root, file, id, receipt);
  assert.deepEqual(f.inspect().errors, []);
  f.put('src/model/tool.mjs', 'export function run(x) { return x + 2; }\n');
  const rows = f.inspect().sections;
  assert.equal(rows.find((s) => s.id === 'owner').stale, false);
  assert.equal(rows.find((s) => s.id === 'behavior').stale, true);
  f.put('src/model/owner.mjs', "import {run} from './tool.mjs'; export const owner=()=>run(2);\n");
  assert.equal(f.inspect().sections.find((s) => s.id === 'owner').stale, true);
});

test('one direct-source section retains explicitly linked dependency behavior', (t) => {
  const f = fixture(t),
    file = 'docs/development/guide.md';
  f.put('src/model/owner.mjs', "import {run} from './tool.mjs'; export const owner=()=>run(1);\n");
  f.put(
    file,
    '# Owner\n[composition](../../src/model/owner.mjs#source) calls [run](../../src/model/tool.mjs#symbol=run).\n',
  );
  reviewSection(f.root, file, 'owner', receipt);
  assert.deepEqual(f.inspect().errors, []);
  f.put('src/model/tool.mjs', 'export function run(x) { return x + 99; }\n');
  assert.equal(f.inspect().sections[0].stale, true);
});

test('architecture preview and cancellation claims bind their actual control owners', () => {
  const report = inspectDocumentation(process.cwd(), {
    files: ['docs/development/architecture.md'],
  });
  const section = report.sections.find((s) => s.id === 'trace-an-edit');
  for (const owner of [
    'assembly-mirror',
    'surface-controls',
    'placement-lifecycle',
    'direct-drag',
    'editing-controls',
    'vehicle-controls',
  ])
    assert.ok(
      Object.hasOwn(section.dependencies, `src/presentation/${owner}.mjs`),
      `${owner} behavior must invalidate the architecture claim`,
    );
});

test('JavaScript review ignores only whitespace with identical structure, tokens and comments', (t) => {
  for (const scope of ['source', 'implementation', 'symbol=run']) {
    const f = fixture(t);
    const original = 'export function run() { /* rationale */ return 9; }';
    f.put('src/model/tool.mjs', original);
    f.put('docs/development/guide.md', `# Owner\nUses [run](../../src/model/tool.mjs#${scope}).\n`);
    reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
    f.put('src/model/tool.mjs', 'export function run() {\n  /* rationale */ return 9;\n}\n');
    assert.deepEqual(f.inspect().errors, [], scope);
    for (const wrong of [
      original.replace('9', '8'),
      original.replace('return 9', 'return\n9'),
      original.replace('rationale', 'changed'),
    ]) {
      f.put('src/model/tool.mjs', wrong);
      assert.match(f.inspect().errors.join('\n'), /stale documentation review/, scope);
    }
  }
});

test('review equivalence never decodes binary dependency bytes', (t) => {
  const f = fixture(t);
  f.put('src/model/tool.mjs', "export const asset = new URL('./asset.wasm', import.meta.url);");
  f.put('src/model/asset.wasm', Buffer.from([255]));
  f.put(
    'docs/development/guide.md',
    '# Owner\nUses [asset](../../src/model/tool.mjs#implementation).\n',
  );
  reviewSection(f.root, 'docs/development/guide.md', 'owner', receipt);
  assert.deepEqual(f.inspect().errors, []);
  f.put('src/model/asset.wasm', Buffer.from([254]));
  assert.match(f.inspect().errors.join('\n'), /stale documentation review/);
});

test('overlay claims retain performance assertions without unrelated fingerprint payloads', () => {
  const report = inspectDocumentation(process.cwd());
  const section = report.sections.find(
    (s) => s.file === 'docs/development/recipes.md' && s.id === 'change-a-presentation-overlay',
  );
  assert.ok(section.dependencies['scripts/measure-springs.mjs']);
  assert.ok(section.dependencies['test/spring-performance.test.mjs']);
  assert.ok(section.dependencies['scripts/browser-evidence.mjs']);
  assert.equal(section.dependencies['src/model/messages.mjs'], undefined);
});
