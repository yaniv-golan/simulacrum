// One candidate attempt per process: `first` fails browser:x; `after` retries with --after/--cause;
// `resume` resumes a report;
// arguments: <mode> <origin root or "new"> [attemptReport] [flags...]
// flags: x=fail|pass, unit=fail (unit:test/a.test.mjs fails inside ci:budget so the browser phase
// never runs), omit=<ids>, touch=<file>, drift=yes (origin edited after the tier so the candidate
// itself fails), tier=<tier>, base=<ref>, moved=yes (the base ref now names another commit),
// cleanup=yes, --cause=<id>=<text>, --arg=<extra tier argument>
// Stubs keep capture, preflight and processes local; the tier is emulated with a real
// verification context and leaf ledger so receipts, reuse and origins are the production ones.
import { registerHooks } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const [mode, rootArg, parentReport, ...flags] = process.argv.slice(2);
const root = rootArg === 'new' ? mkdtempSync('/tmp/candidate-after-') : rootArg;
const flag = (name) => flags.find((f) => f.startsWith(`${name}=`))?.slice(name.length + 1);
const tier = flag('tier') ?? 'local';
const calls = [],
  unitRuns = [];
let tierRan = false;
const manifest = {
  // y runs before x so the first attempt leaves one reusable browser pass behind its failure.
  browserChecks: [
    { id: 'y', script: 'scripts/y.mjs', tier: 'browser' },
    { id: 'x', script: 'scripts/x.mjs', tier: 'browser' },
    { id: 'perf', script: 'scripts/perf.mjs', tier: 'browser', timingSensitive: true },
    { id: 'smoke', script: 'scripts/smoke.mjs', tier: 'browser', mergeSmoke: true },
    { id: 'hosted', script: 'scripts/hosted.mjs', tier: 'browser', environment: 'self' },
  ],
  checks: [{ id: 'layers' }],
  invariants: [
    {
      id: 'inv',
      checks: ['x'],
      controls: { positive: [{ path: 'test/geometry.test.mjs' }], negative: [] },
    },
  ],
  verificationResumeLeaves: [],
};
const filesOf = (dir) => {
  const out = {};
  const visit = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name),
        rel = relative(dir, p);
      if (rel.startsWith('artifacts') || rel.startsWith('node_modules') || rel.startsWith('.git'))
        continue;
      if (statSync(p).isDirectory()) visit(p);
      else
        out[rel] = {
          sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
          mode: 420,
        };
    }
  };
  visit(dir);
  return out;
};
if (mode === 'first') {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'src.mjs'), 'export const v = 1;');
  writeFileSync(join(root, 'scripts/y.mjs'), 'export const y = 1;');
}
if (flag('touch')) writeFileSync(join(root, flag('touch')), `changed ${Date.now()}`);
globalThis.candidateTransport = {
  // Refs resolve by name; moved=yes models the same name now pointing at another commit.
  resolveBase(base) {
    const resolved = base.startsWith('resolved-') ? base : `resolved-${base}`;
    return flag('moved') === 'yes' ? `${resolved}-moved` : resolved;
  },
  async capture(origin, destination, options) {
    mkdirSync(join(destination, 'artifacts/verification-windows'), { recursive: true });
    mkdirSync(join(destination, 'node_modules'), { recursive: true });
    cpSync(join(origin, 'scripts'), join(destination, 'scripts'), { recursive: true });
    cpSync(join(origin, 'src.mjs'), join(destination, 'src.mjs'));
    calls.push({ kind: 'capture', origin, options });
    return {
      origin,
      destination,
      base: options.base.startsWith('resolved-') ? options.base : `resolved-${options.base}`,
      head: 'fixture-head',
      index: 'fixture-index',
      files: filesOf(origin),
    };
  },
  async matches(path, candidate) {
    calls.push({ kind: 'identity', path });
    // drift=yes: the candidate's own bytes change once the tier has run (an editor save into
    // the frozen clone), so the attempt fails around a green tier.
    if (flag('drift') === 'yes' && tierRan && path !== root) return false;
    return JSON.stringify(filesOf(path)) === JSON.stringify(candidate.files);
  },
  drift() {
    return 'NOT_EVALUATED';
  },
  async run(binary, args, options) {
    calls.push({ kind: 'process', binary, args, cwd: options?.cwd });
    if (binary === 'npm') return { code: 0 };
    // Unit leaves inside the emulated tier: record the execution, never spawn.
    if (args[0] === '--test') {
      unitRuns.push(`unit:${args[1]}`);
      if (flag('unit') === 'fail' && args[1] === 'test/a.test.mjs')
        throw Object.assign(Error('unit failed'), { code: 1, output: 'boom' });
      return { code: 0, output: `ran ${args[1]}` };
    }
    const tier = args[1].match(/verify-(\w+)\.mjs/)[1];
    tierRan = true;
    const previous = process.cwd(),
      env = { ...process.env };
    process.chdir(options.cwd);
    for (const key of ['SIMULACRUM_LEAF_LEDGER', 'SIMULACRUM_VERIFICATION_ATTEMPT'])
      process.env[key] = options.env[key];
    let code = 0;
    try {
      const { initializeVerificationEnvironment, createVerificationContext } = await import(
        '../../scripts/verification-run.mjs'
      );
      const { resolveRetrySelection, withRequiredChecks } = await import(
        '../../scripts/candidate-after.mjs'
      );
      initializeVerificationEnvironment();
      const context = createVerificationContext();
      // The retry selection reaches the tier through the ledger only and is resolved by the
      // production resolver: the emulated fresh policy selects every check (no git scope here),
      // the byte delta reaches the checks whose script it names.
      const retrySelection = context.selection;
      const fresh = { scope: 'full', checks: manifest.browserChecks, reasons: [] };
      const resolved = retrySelection?.changedFiles
        ? resolveRetrySelection({
            fresh,
            narrow: {
              scope: 'delta',
              checks: manifest.browserChecks.filter((c) =>
                retrySelection.changedFiles.includes(c.script),
              ),
              reasons: [],
            },
            required: retrySelection.required,
            covered: retrySelection.covered,
            checks: manifest.browserChecks,
          })
        : withRequiredChecks(fresh, retrySelection?.required ?? [], manifest.browserChecks);
      const selected = (check) => resolved.checks.some((c) => c.id === check.id);
      const executed = [];
      const leaf = (id, value) => () => {
        executed.push(id);
        return value;
      };
      const omit = (flag('omit') ?? '').split(',').filter(Boolean);
      const results = [];
      const phase = async (id, run) => {
        try {
          await run();
          results.push({ id, status: 'passed' });
        } catch (error) {
          results.push({ id, status: 'failed' });
          throw error;
        }
      };
      try {
        await phase('ci', async () => {
          await context.check('check:layers', {}, leaf('check:layers', undefined));
          await context.check('ci:budget', { limitMs: 1 }, async () => {
            executed.push('ci:budget');
            await context.node('unit:test/a.test.mjs', ['--test', 'test/a.test.mjs']);
            await context.node('unit:test/geometry.test.mjs', ['--test', 'test/geometry.test.mjs']);
            return { elapsedMs: 1, resumed: 0 };
          });
        });
        await phase('browser', async () => {
          await context.check(
            'build:browser',
            { mode: 'production' },
            leaf('build:browser', { code: 0 }),
          );
          for (const check of manifest.browserChecks) {
            const id = `browser:${check.id}`;
            if (omit.includes(id) || !selected(check)) continue;
            await context.check(id, { script: id }, () => {
              executed.push(id);
              if (id === 'browser:x' && flag('x') === 'fail')
                throw Object.assign(Error('assertion failed'), { code: 1, output: 'boom' });
              // Retained evidence as the suite leaves it: a directory, a witness and a log.
              const attempt = options.env.SIMULACRUM_VERIFICATION_ATTEMPT;
              const directory = join(options.cwd, 'artifacts/browser-suite/runs', attempt, id.slice(8));
              mkdirSync(directory, { recursive: true });
              const witness = join(directory, 'witness.json'),
                log = `${directory}.log`;
              writeFileSync(witness, JSON.stringify({ id, attempt }));
              writeFileSync(log, `ok ${id}`);
              const sum = (path) => ({
                path,
                sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
                bytes: statSync(path).size,
              });
              return {
                code: 0,
                output: 'ok',
                evidenceOrigin: { evidenceDirectory: directory, log },
                evidenceChecksums: [{ path: directory, directory: true }, sum(witness), sum(log)],
              };
            });
          }
        });
      } catch {
        code = 1;
      }
      writeFileSync(
        `artifacts/verification-${tier}.json`,
        JSON.stringify({
          status: code ? 'failed' : 'passed',
          attempt: options.env.SIMULACRUM_VERIFICATION_ATTEMPT,
          elapsedMs: 1,
          ...context.identity,
          results,
          checks: context.receipts(),
          executed: [...executed, ...unitRuns],
          retrySelection,
          selection: {
            checks: resolved.checks.map((c) => c.id),
            skippedByDelta: resolved.skippedByDelta ?? [],
          },
          argv: args.slice(2),
          outcome: {
            automation: { status: code ? 'FAIL' : 'PASS' },
            exitCode: code,
            qualification: { status: 'NOT_EVALUATED' },
          },
        }),
      );
      writeFileSync(
        'artifacts/browser-suite/last-run.json',
        JSON.stringify({ runId: 'r', startedAt: new Date().toISOString(), runs: [] }),
      );
    } finally {
      process.chdir(previous);
      for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
      Object.assign(process.env, env);
    }
    if (code) throw Object.assign(Error('tier exit'), { code });
    return { code: 0 };
  },
};
registerHooks({
  load(url, context, next) {
    let source;
    if (url === `file://${repo}/scripts/candidate.mjs`)
      source =
        'export const captureCandidate=(...a)=>globalThis.candidateTransport.capture(...a); export const candidateMatchesOrigin=(...a)=>globalThis.candidateTransport.matches(...a); export const destinationStillMatches=(...a)=>globalThis.candidateTransport.drift(...a); export const currentBranch=()=>"fixture-branch"; export const resolveCandidateBase=(root,base)=>globalThis.candidateTransport.resolveBase(base);';
    if (url === `file://${repo}/scripts/verification-preparation.mjs`)
      source = 'export async function assertVerificationReady() {return {status: "READY"}}';
    if (url === `file://${repo}/scripts/runtime-preflight.mjs`)
      source =
        'export function assertRuntime() {} export async function assertLocalServerAccess() {}';
    if (url === `file://${repo}/scripts/run-check.mjs`)
      source =
        'export const runProcess=(...a)=>globalThis.candidateTransport.run(...a); export const runModuleCheck=async()=>({code:0});';
    if (url === `file://${repo}/scripts/source-identity.mjs`)
      source =
        'export function sourceIdentity() { return { head: "fixture", workingTreeDigest: "fixture" }; }';
    if (url === `file://${repo}/scripts/app-fingerprint.mjs`)
      source = 'export function appFingerprint() { return "fixture-build"; }';
    if (url === `file://${repo}/scripts/merge-selection.mjs`)
      source =
        'export function mergeChanges(options) { return { refs: { base: `resolved-${options.base}`, incoming: null, destination: null, destinationName: null } }; }';
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
process.chdir(root);
mkdirSync('artifacts/browser-suite', { recursive: true });
if (mode === 'first')
  writeFileSync('artifacts/browser-suite/scheduling-history.json', JSON.stringify({ runs: [] }));
process.argv = [
  process.execPath,
  `${repo}/scripts/verify-candidate.mjs`,
  ...(mode === 'resume'
    ? ['resume', parentReport]
    : [tier, ...(tier === 'final' ? [] : ['--base', flag('base') ?? 'HEAD~1'])]),
  ...(mode === 'after' ? ['--after', parentReport] : []),
  ...flags.filter((f) => f.startsWith('--cause=')).flatMap((f) => ['--cause', f.slice(8)]),
  ...flags.filter((f) => f.startsWith('--arg=')).map((f) => f.slice(6)),
];
let report = null;
try {
  await import('../../scripts/verify-candidate.mjs');
} finally {
  try {
    report = JSON.parse(readFileSync('artifacts/verification-candidate.json', 'utf8'));
  } catch {}
  process.chdir(repo);
  console.log(
    'TRANSPORT ' + JSON.stringify({ root, calls, report, exitCode: process.exitCode ?? 0 }),
  );
  if (flag('cleanup') === 'yes') {
    if (report?.directory) rmSync(report.directory, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
  delete globalThis.candidateTransport;
}
