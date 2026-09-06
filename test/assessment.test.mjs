import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateManifest } from '../scripts/validate-manifest.mjs';
const root = process.cwd();
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'assessment-'));
  for (const sub of [
    'scripts',
    'assessments/protocol',
    'assessments/sessions',
    'src',
    'docs',
    'config',
  ])
    mkdirSync(join(dir, sub), { recursive: true });
  for (const file of [
    'app-fingerprint.mjs',
    'build-fingerprint.mjs',
    'bars.mjs',
    'assess.mjs',
    'manifest.json',
    'module-graph.mjs',
  ])
    copyFileSync(join(root, 'scripts', file), join(dir, 'scripts', file));
  for (const id of ['F1', 'F3', 'F4', 'F5'])
    writeFileSync(join(dir, 'assessments/protocol', id + '.md'), 'Protocol ' + id);
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  writeFileSync(join(dir, '.git/info/exclude'), 'node_modules\n');
  const run = (script, ...args) =>
    spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: 'utf8' });
  const fingerprint = () => run('scripts/build-fingerprint.mjs').stdout.trim();
  const manifest = JSON.parse(readFileSync(join(dir, 'scripts/manifest.json')));
  const proto = (id) =>
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {protocolHash} from './scripts/build-fingerprint.mjs'; console.log(protocolHash(${JSON.stringify(id)},${JSON.stringify(manifest.bars[id].contract)}))`,
      ],
      { cwd: dir, encoding: 'utf8' },
    ).trim();
  const record = (id, participant, verdict, recordedAt, name = participant) =>
    writeFileSync(
      join(dir, 'assessments/sessions', name + '.json'),
      JSON.stringify({
        bar: id,
        participant,
        verdict,
        recordedAt,
        app: fingerprint(),
        servedBuild: fingerprint(),
        protocol: proto(id),
        date: '2026-09-05',
        assessor: 'Test',
        notes: 'Observed',
      }),
    );
  return {
    dir,
    run,
    fingerprint,
    record,
    close: () => rmSync(dir, { recursive: true, force: true }),
  };
}
function check(name, fn) {
  test(name, () => {
    const f = fixture();
    try {
      fn(f);
    } finally {
      f.close();
    }
  });
}
check('arbitrary config and imported markdown change app identity', (f) => {
  writeFileSync(join(f.dir, 'config/runtime.json'), '{}');
  const before = f.fingerprint();
  writeFileSync(join(f.dir, 'config/runtime.json'), '{"x":1}');
  assert.notEqual(before, f.fingerprint());
  writeFileSync(join(f.dir, 'src/main.js'), "import text from '../docs/runtime.md?raw';");
  writeFileSync(join(f.dir, 'docs/runtime.md'), 'one');
  const first = f.fingerprint();
  writeFileSync(join(f.dir, 'docs/runtime.md'), 'two');
  assert.notEqual(first, f.fingerprint());
});
check('valid assessment passes; newer failure supersedes it', (f) => {
  f.record('F3', 'one', 'pass', '2026-09-05T01:00:00.000Z');
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 0);
  f.record('F3', 'two', 'fail', '2026-09-05T02:00:00.000Z');
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 1);
});
for (const timestamp of [
  'invalid',
  '2026-02-30T01:00:00.000Z',
  '2026-09-05',
  '2026-09-05T01:00:00.000Z',
])
  check('ambiguous or invalid timestamp fails closed: ' + timestamp, (f) => {
    f.record('F3', 'a', 'fail', '2026-09-05T01:00:00.000Z');
    f.record('F3', 'z', 'pass', timestamp);
    const result = f.run('scripts/bars.mjs', 'F3');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /recordedAt|ambiguous/);
  });
check('missing or unreadable protocol rejects assessment reader and writer', (f) => {
  f.record('F3', 'a', 'pass', '2026-09-05T01:00:00.000Z');
  const path = join(f.dir, 'assessments/protocol/F3.md');
  rmSync(path);
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 1);
  assert.notEqual(
    f.run('scripts/assess.mjs', 'F3', 'pass', 'b', f.fingerprint(), 'Observed').status,
    0,
  );
  mkdirSync(path);
  assert.equal(f.run('scripts/bars.mjs', 'F3').status, 1);
});
check('designated player may repeat F1 after F4 and prior F1 exposure', (f) => {
  f.record('F4', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'exposure');
  f.record('F1', 'designated-player', 'fail', '2026-09-05T02:00:00.000Z', 'prior-f1');
  const result = f.run(
    'scripts/assess.mjs',
    'F1',
    'pass',
    'designated-player',
    f.fingerprint(),
    'Observed',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
});
check('writer rejects another participant even without prior exposure', (f) => {
  const result = f.run(
    'scripts/assess.mjs',
    'F1',
    'pass',
    'another-player',
    f.fingerprint(),
    'Observed',
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /designated participant/);
});
check('reader rejects externally supplied F1 from another participant', (f) => {
  f.record('F1', 'another-player', 'pass', '2026-09-05T01:00:00.000Z');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /designated participant/);
});
check('designated player repeated pass becomes red when latest session fails', (f) => {
  f.record('F1', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'first');
  f.record('F1', 'designated-player', 'pass', '2026-09-05T02:00:00.000Z', 'repeat');
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
  f.record('F1', 'designated-player', 'fail', '2026-09-05T03:00:00.000Z', 'latest');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /assessed FAIL/);
});
check('returning designated player evidence must use current protocol', (f) => {
  f.record('F4', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'exposure');
  f.record('F1', 'designated-player', 'pass', '2026-09-05T02:00:00.000Z', 'f1');
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
  writeFileSync(join(f.dir, 'assessments/protocol/F1.md'), 'Revised target player protocol');
  const result = f.run('scripts/bars.mjs', 'F1');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contract changed/);
});
test('manifest requires a nonempty designated F1 participant only', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'scripts/manifest.json')));
  for (const participant of [undefined, '', '   ', 17]) {
    const bad = structuredClone(manifest);
    bad.bars.F1.participant = participant;
    assert.throws(() => validateManifest(bad), /F1.*participant/);
  }
  manifest.bars.F1.participant = 'designated-player';
  for (const [id, bar] of Object.entries(manifest.bars)) if (id !== 'F1') delete bar.participant;
  assert.doesNotThrow(() => validateManifest(manifest));
});
check('unimported documentation preserves app identity', (f) => {
  const before = f.fingerprint();
  writeFileSync(join(f.dir, 'docs/readme.md'), 'Contributor prose');
  assert.equal(f.fingerprint(), before);
});
check('ignored imported dependency is included and missing import fails closed', (f) => {
  writeFileSync(join(f.dir, '.gitignore'), 'config/secret.json\n');
  writeFileSync(join(f.dir, 'src/main.js'), "import settings from '../config/secret.json';");
  writeFileSync(join(f.dir, 'config/secret.json'), '{}');
  const first = f.fingerprint();
  writeFileSync(join(f.dir, 'config/secret.json'), '{"changed":true}');
  assert.notEqual(first, f.fingerprint());
  rmSync(join(f.dir, 'config/secret.json'));
  assert.notEqual(f.run('scripts/build-fingerprint.mjs').status, 0);
});
check('later valid exposure preserves designated player evidence', (f) => {
  f.record('F1', 'designated-player', 'pass', '2026-09-05T01:00:00.000Z', 'first');
  f.record('F4', 'designated-player', 'pass', '2026-09-05T02:00:00.000Z', 'later');
  assert.equal(f.run('scripts/bars.mjs', 'F1').status, 0);
});
check('nonliteral imports refuse a certifying fingerprint', (f) => {
  writeFileSync(join(f.dir, 'src/main.js'), "const path = '../docs/runtime.md'; import(path);");
  assert.notEqual(f.run('scripts/build-fingerprint.mjs').status, 0);
});
