import { writeBrowserHistory, readBrowserHistory } from '../../scripts/browser-history.mjs';
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseCompletionArgs } from '../../scripts/verification-tiers.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const root = mkdtempSync('/tmp/candidate-priority-');
const [tier, codeText, pair] = process.argv.slice(2);
const code = Number(codeText);
const calls = [];
let captured;
globalThis.candidateTransport = {
  async capture(origin, destination, options) {
    captured = { origin, destination, base: `resolved-${options.base}` };
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
    return 'fixture-drift';
  },
  async run(binary, args, options) {
    calls.push({
      kind: 'process',
      binary,
      args,
      cwd: options.cwd,
      intent: options.env?.SIMULACRUM_VERIFICATION_INTENT
        ? JSON.parse(options.env.SIMULACRUM_VERIFICATION_INTENT)
        : null,
    });
    if (binary === 'npm') return { code: 0 };
    const hint = JSON.parse(
      readFileSync(join(options.cwd, 'artifacts/browser-suite/scheduling-history.json')),
    ).runs;
    if (hint.find((row) => row.id === 'verify-recording-browser')?.ok !== false)
      throw Error('fresh candidate lost origin scheduling history');
    writeBrowserHistory(join(options.cwd, 'artifacts/browser-suite/scheduling-history.json'), [
      { id: 'verify-recording-browser', ok: true, elapsedMs: 1 },
    ]);
    writeFileSync(
      join(options.cwd, 'artifacts/browser-suite/last-run.json'),
      JSON.stringify({
        runId: 'current-run',
        startedAt: new Date().toISOString(),
        runs: [{ id: 'verify-recording-browser', ok: true, elapsedMs: 1 }],
      }),
    );
    // Another completed candidate fails a check that this candidate never ran.
    writeBrowserHistory(join(root, 'artifacts/browser-suite/scheduling-history.json'), [
      { id: 'untouched', ok: false },
    ]);
    const forwarded = parseCompletionArgs(tier, args.slice(2));
    writeFileSync(
      join(options.cwd, `artifacts/verification-${tier}.json`),
      JSON.stringify({
        status: code === 1 ? 'failed' : 'passed',
        attempt: options.env.SIMULACRUM_VERIFICATION_ATTEMPT,
        elapsedMs: 1,
        results: [],
        checks: [],
        priority: forwarded,
        outcome: {
          automation: { status: code === 1 ? 'FAIL' : 'PASS' },
          exitCode: code,
          qualification: { status: tier !== 'final' ? 'NOT_EVALUATED' : code ? 'BLOCKED' : 'PASS' },
        },
      }),
    );
    if (code) throw Object.assign(Error('fixture phase exit'), { code });
    return { code: 0 };
  },
};
registerHooks({
  load(url, context, next) {
    let source;
    if (url === `file://${repo}/scripts/candidate.mjs`)
      source =
        'export const captureCandidate=(...args)=>globalThis.candidateTransport.capture(...args); export const candidateMatchesOrigin=(...args)=>globalThis.candidateTransport.matches(...args); export const destinationStillMatches=(...args)=>globalThis.candidateTransport.drift(...args); export const currentBranch=()=>"fixture-branch";';
    if (url === `file://${repo}/scripts/verification-preparation.mjs`)
      source = 'export async function assertVerificationReady() {return {status: "READY"}}';
    if (url === `file://${repo}/scripts/merge-selection.mjs`)
      source =
        'export function mergeChanges(o) { return { refs: { base: o.base, ...(o.incoming ? { incoming: `resolved-${o.incoming}`, destination: `resolved-${o.destination}`, destinationName: o.destination } : {}) } }; }';
    if (url === `file://${repo}/scripts/runtime-preflight.mjs`)
      // The fixture models an un-niced launch; the refusal itself is unit-tested on the real module.
      source =
        'export function assertRuntime() {} export function assertUnnicedLaunch({ priority = 0 } = {}) { return priority; }';
    if (url === `file://${repo}/scripts/run-check.mjs`)
      source = 'export const runProcess=(...args)=>globalThis.candidateTransport.run(...args);';
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
process.chdir(root);
mkdirSync('artifacts/browser-suite', { recursive: true });
writeFileSync(
  'artifacts/browser-suite/scheduling-history.json',
  JSON.stringify({
    runs: [
      { id: 'verify-recording-browser', ok: false },
      { id: 'untouched', ok: true, elapsedMs: 8 },
    ],
  }),
);
process.argv = [
  process.execPath,
  `${repo}/scripts/verify-candidate.mjs`,
  tier,
  ...(tier !== 'final' ? ['--base', 'HEAD~1'] : []),
  ...(pair ? ['--incoming', 'feature', '--destination', 'target'] : []),
  '--priority-files',
  './scripts/verify-recording-browser.mjs',
  'src/application/workshop-app.mjs',
];
try {
  await import('../../scripts/verify-candidate.mjs');
  const report = JSON.parse(readFileSync('artifacts/verification-candidate.json', 'utf8'));
  if (
    readBrowserHistory('artifacts/browser-suite/scheduling-history.json').get(
      'verify-recording-browser',
    )?.ok !== true
  )
    throw Error('candidate did not return scheduling hints');
  if (
    readBrowserHistory('artifacts/browser-suite/scheduling-history.json').get('untouched')?.ok !==
    false
  )
    throw Error('inherited history erased a newer failure');
  console.log('TRANSPORT ' + JSON.stringify({ calls, captured, report }));
} finally {
  process.chdir(repo);
  if (captured) rmSync(join(captured.destination, '..'), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  delete globalThis.candidateTransport;
}
