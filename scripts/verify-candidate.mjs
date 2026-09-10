import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureCandidate, candidateMatchesOrigin } from './candidate.mjs';
import { assertRuntime } from './runtime-preflight.mjs';
import { runProcess } from './run-check.mjs';
const origin = process.cwd(),
  report = { status: 'running', qualification: 'NOT_EVALUATED' };
const output = 'artifacts/verification-candidate.json';
const write = () => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
};
write();
try {
  assertRuntime();
  const [tier, ...args] = process.argv.slice(2);
  if (
    !['local', 'final'].includes(tier) ||
    (args.length && !(tier === 'local' && args.length === 2 && args[0] === '--base'))
  )
    throw Error('Usage: verify:candidate -- local [--base <commit>] | final');
  const directory = mkdtempSync(join(tmpdir(), 'simulacrum-candidate-'));
  report.directory = directory;
  report.tier = tier;
  write();
  const candidate = await captureCandidate(origin, join(directory, 'source'), {
    base: args[1] ?? 'HEAD',
  });
  report.candidate = candidate;
  write();
  await runProcess('npm', ['ci', '--prefer-offline'], {
    cwd: candidate.destination,
    timeoutMs: 300000,
    inheritOutput: true,
  });
  let result;
  try {
    result = await runProcess(
      process.execPath,
      [
        'scripts/verification-window.mjs',
        `scripts/verify-${tier}.mjs`,
        ...(tier === 'local' ? ['--base', candidate.base] : []),
      ],
      { cwd: candidate.destination, timeoutMs: 3600000, inheritOutput: true },
    );
  } catch (e) {
    result = e;
  }
  report.verification = JSON.parse(
    readFileSync(join(candidate.destination, `artifacts/verification-${tier}.json`), 'utf8'),
  );
  if (!(await candidateMatchesOrigin(candidate.destination, candidate)))
    throw Error('Candidate changed during verification');
  report.originStillMatches = await candidateMatchesOrigin(origin, candidate);
  report.status = report.verification.status;
  report.qualification = report.verification.outcome?.qualification ?? 'NOT_EVALUATED';
  process.exitCode = result.code === 0 ? 0 : result.code === 2 ? 2 : 1;
} catch (e) {
  report.status = 'failed';
  report.error = e.message;
  process.exitCode = 1;
} finally {
  write();
  console.log(
    JSON.stringify({
      status: report.status,
      directory: report.directory,
      originStillMatches: report.originStillMatches,
    }),
  );
}
