import test from 'node:test';
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
const root = process.cwd();
/** An isolated copy of the assessment tooling: its own git repo, protocols and session log.
 * Every check that records or reads evidence spawns the real scripts against it. */
export function fixture() {
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
export function check(name, fn) {
  test(name, () => {
    const f = fixture();
    try {
      fn(f);
    } finally {
      f.close();
    }
  });
}
