import { parseCompletionArgs } from './verification-tiers.mjs';
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
  const options = parseCompletionArgs(tier, args);
  report.priority = options;
  const directory = mkdtempSync(join(tmpdir(), 'simulacrum-candidate-'));
  report.directory = directory;
  report.tier = tier;
  write();
  const candidate = await captureCandidate(origin, join(directory, 'source'), {
    base: options.base,
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
        ...(options.priorityFiles.length ? ['--priority-files', ...options.priorityFiles] : []),
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
