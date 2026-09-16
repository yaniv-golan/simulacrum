// Runs the real verify-candidate.mjs with the transport stubbed (capture, identity match, drift,
// processes) against an in-temp release directory: the citation path must read the release
// before capture, capture, install and digest like a merge candidate, then compare and record
// instead of running a tier.
// argument: scenario in identical | differing | deps | pending | pending-allowed | legacy |
//           red | resume-citation | after-citation | cite-final | cite-final-red |
//           cite-final-pointer
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { dependencyDigest } from '../../scripts/candidate-resume.mjs';
import { sourceRecord, finalReport, packageRecord } from './release-record.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
// A second command on the same root (resume/--after of a citation) runs as a child of this
// fixture with the same stubs: `<scenario> <root> <attempt report>` — the module graph sees
// one literal import of verify-candidate.mjs per process.
const scenario = process.argv[2];
const second = process.argv[3] ? { root: process.argv[3], attempt: process.argv[4] } : null;
const root = second ? second.root : mkdtempSync('/tmp/candidate-cite-');
const head = 'c'.repeat(40);
const files = {
  'src/a.mjs': { sha256: '1'.repeat(64), mode: 0o644 },
  'scripts/b.mjs': { sha256: '2'.repeat(64), mode: 0o755 },
};
// The digest verify-candidate will compute: an empty install plus the two scratch directories
// it admits before freezing.
const model = mkdtempSync('/tmp/candidate-cite-model-');
for (const path of ['.vite-temp', '.cache/prettier'])
  mkdirSync(join(model, 'node_modules', path), { recursive: true });
const installed = dependencyDigest(model);
rmSync(model, { recursive: true, force: true });
const calls = [];
let captured;
globalThis.candidateTransport = {
  async capture(origin, destination, options) {
    captured = { head, index: 'idx', files, base: `resolved-${options.base}`, destination };
    calls.push({ kind: 'capture', origin, options });
    mkdirSync(join(destination, 'artifacts/verification-windows'), { recursive: true });
    mkdirSync(join(destination, 'node_modules'), { recursive: true });
    return captured;
  },
  async matches(path) {
    calls.push({ kind: 'identity', path });
    return true;
  },
  drift(root, refs) {
    calls.push({ kind: 'drift', root, refs });
    return true;
  },
  async run(binary, args, options) {
    calls.push({ kind: 'process', binary, args, cwd: options.cwd });
    if (binary === 'npm') return { code: 0 };
    throw Error('a citation must not run a tier');
  },
};
registerHooks({
  load(url, context, next) {
    let source;
    if (url === `file://${repo}/scripts/candidate.mjs`)
      source =
        'export const captureCandidate=(...args)=>globalThis.candidateTransport.capture(...args); export const candidateMatchesOrigin=(...args)=>globalThis.candidateTransport.matches(...args); export const destinationStillMatches=(...args)=>globalThis.candidateTransport.drift(...args); export const resolveCandidateBase=(root,base)=>base; export const currentBranch=()=>"fixture-branch"; export const candidateSelection=()=>["src.mjs"];';
    if (url === `file://${repo}/scripts/verification-preparation.mjs`)
      source = 'export async function assertVerificationReady() {return {status: "READY"}}';
    if (url === `file://${repo}/scripts/merge-selection.mjs`)
      source =
        'export function mergeChanges(o) { return { refs: { base: o.base, ...(o.incoming ? { incoming: `resolved-${o.incoming}`, destination: `resolved-${o.destination}`, destinationName: o.destination } : {}) } }; } export function mergeSelection() { throw Error("fixture: no merge selection is scripted"); }';
    if (url === `file://${repo}/scripts/runtime-preflight.mjs`)
      source =
        'export function assertRuntime() {} export function assertUnnicedLaunch({ priority = 0 } = {}) { return priority; } export function assertAwake() { return { method: "fixture", pid: process.pid }; }';
    if (url === `file://${repo}/scripts/run-check.mjs`)
      source =
        'export const runProcess=(...args)=>globalThis.candidateTransport.run(...args); export const SLEEP_GAP_MS=60000;';
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
// The release directory as release:prepare leaves it: source.json always; the final's report
// (running, passed or failed) and, once green, the package.
const release = join(root, '.release-private', 'main-r9');
if (!second) mkdirSync(join(release, 'source', 'artifacts'), { recursive: true });
const releaseFiles =
  scenario === 'differing'
    ? { ...files, 'src/a.mjs': { sha256: '9'.repeat(64), mode: 0o644 } }
    : files;
const source =
  scenario === 'legacy'
    ? { head, source: {} }
    : sourceRecord({
        head,
        files: releaseFiles,
        installed: scenario === 'deps' ? 'd'.repeat(64) : installed,
      });
if (!second) writeFileSync(join(release, 'source.json'), JSON.stringify(source));
const writeFinal = (status) => {
  const final = finalReport({ head, status, failure: 'bar B7 unmet' });
  writeFileSync(join(release, 'source/artifacts/verification-final.json'), JSON.stringify(final));
  if (status === 'passed')
    writeFileSync(
      join(release, 'release.json'),
      JSON.stringify(packageRecord({ source, final, installed: source.installed })),
    );
};
const pendingScenarios = [
  'pending',
  'pending-allowed',
  'cite-final',
  'cite-final-red',
  'cite-final-pointer',
];
// A running final has already written its first report (status running).
if (!second)
  writeFinal(
    pendingScenarios.includes(scenario) ? 'running' : scenario === 'red' ? 'failed' : 'passed',
  );
process.chdir(root);
mkdirSync('artifacts', { recursive: true });
const merge = ['merge', '--base', 'HEAD~1', '--incoming', 'feature', '--destination', 'target'];
const cite = [...merge, '--satisfied-by', release];
const argvFor = {
  identical: cite,
  differing: cite,
  deps: cite,
  legacy: cite,
  red: cite,
  pending: cite,
  'pending-allowed': [...cite, '--pending'],
  'cite-final': [...cite, '--pending'],
  'cite-final-red': [...cite, '--pending'],
  'cite-final-pointer': [...cite, '--pending'],
};
const runCandidate = async (args) => {
  process.argv = [process.execPath, `${repo}/scripts/verify-candidate.mjs`, ...args];
  process.exitCode = 0;
  await import('../../scripts/verify-candidate.mjs');
  return {
    code: process.exitCode ?? 0,
    report: JSON.parse(readFileSync('artifacts/verification-candidate.json', 'utf8')),
  };
};
if (second) {
  // The second command of a resume/after scenario, on the parent's root.
  const result = await runCandidate(
    scenario === 'resume-citation'
      ? ['resume', second.attempt]
      : [...merge, '--after', second.attempt, '--cause', 'x=y'],
  );
  console.log('SECOND ' + JSON.stringify(result));
  delete globalThis.candidateTransport;
  process.exit(0);
}
try {
  let first, second;
  if (scenario === 'resume-citation' || scenario === 'after-citation') {
    // A citation report can be neither resumed nor retried.
    first = await runCandidate(cite);
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), scenario, root, first.report.attemptReport],
      { encoding: 'utf8' },
    );
    const line = child.stdout.split('\n').find((x) => x.startsWith('SECOND '));
    if (!line) throw Error(`second command produced no result: ${child.stderr}`);
    second = JSON.parse(line.slice(7));
  } else {
    first = await runCandidate(argvFor[scenario]);
    if (scenario.startsWith('cite-final')) {
      writeFinal(scenario === 'cite-final-red' ? 'failed' : 'passed');
      const target =
        scenario === 'cite-final-pointer'
          ? join(root, 'artifacts/verification-candidate.json')
          : first.report.attemptReport;
      // cite-final ends the process when done, so it runs as a child in the same directory;
      // it needs no transport (no capture, no tier) — only the report, its key and the release.
      const child = spawnSync(
        process.execPath,
        [`${repo}/scripts/verify-candidate.mjs`, 'cite-final', target],
        { cwd: root, encoding: 'utf8' },
      );
      second = {
        code: child.status,
        stdout: child.stdout.trim(),
        stderr: child.stderr.trim(),
        attempt: JSON.parse(readFileSync(first.report.attemptReport, 'utf8')),
        latest: JSON.parse(readFileSync('artifacts/verification-candidate.json', 'utf8')),
      };
    }
  }
  console.log(
    'CITE ' +
      JSON.stringify({
        calls,
        installed,
        first,
        second: second ?? null,
        attemptExists: first.report.attemptReport ? existsSync(first.report.attemptReport) : null,
      }),
  );
} finally {
  process.chdir(repo);
  if (captured) rmSync(join(captured.destination, '..'), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  delete globalThis.candidateTransport;
}
