import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseCompletionArgs } from '../../scripts/verification-tiers.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const root = mkdtempSync('/tmp/candidate-priority-');
const [tier, codeText] = process.argv.slice(2);
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
  async run(binary, args, options) {
    calls.push({ kind: 'process', binary, args, cwd: options.cwd });
    if (binary === 'npm') return { code: 0 };
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
        'export const captureCandidate=(...args)=>globalThis.candidateTransport.capture(...args); export const candidateMatchesOrigin=(...args)=>globalThis.candidateTransport.matches(...args);';
    if (url === `file://${repo}/scripts/verification-preparation.mjs`)
      source = 'export async function assertVerificationReady() {return {status: "READY"}}';
    if (url === `file://${repo}/scripts/merge-selection.mjs`)
      source = 'export function mergeChanges(options) { return { refs: { base: options.base } }; }';
    if (url === `file://${repo}/scripts/runtime-preflight.mjs`)
      source = 'export function assertRuntime() {}';
    if (url === `file://${repo}/scripts/run-check.mjs`)
      source = 'export const runProcess=(...args)=>globalThis.candidateTransport.run(...args);';
    return source ? { format: 'module', source, shortCircuit: true } : next(url, context);
  },
});
process.chdir(root);
process.argv = [
  process.execPath,
  `${repo}/scripts/verify-candidate.mjs`,
  tier,
  ...(tier !== 'final' ? ['--base', 'HEAD~1'] : []),
  '--priority-files',
  './scripts/verify-recording-browser.mjs',
  'src/application/workshop-app.mjs',
];
try {
  await import('../../scripts/verify-candidate.mjs');
  const report = JSON.parse(readFileSync('artifacts/verification-candidate.json', 'utf8'));
  console.log('TRANSPORT ' + JSON.stringify({ calls, captured, report }));
} finally {
  process.chdir(repo);
  if (captured) rmSync(join(captured.destination, '..'), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  delete globalThis.candidateTransport;
}
