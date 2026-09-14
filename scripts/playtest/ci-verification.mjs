import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const policy = JSON.parse(readFileSync(new URL('./release-policy.json', import.meta.url), 'utf8'));
// Pushes to the release branch verify under the hosted profile; a release package is
// produced only by an explicit dispatch on that branch.
export const releaseEligible = (event, branch) =>
  event === 'workflow_dispatch' && branch === policy.releaseBranch;
export function assertVerificationJobs(eligible, jobs) {
  if (typeof eligible !== 'boolean' || jobs.route !== 'success')
    throw Error('Verification routing failed');
  const expected = eligible
    ? { 'release-package': 'success', automated: 'skipped', browser: 'skipped' }
    : { 'release-package': 'skipped', automated: 'success', browser: 'success' };
  for (const [job, result] of Object.entries(expected))
    if (jobs[job] !== result)
      throw Error(`Required verification job ${job}: expected ${result}, received ${jobs[job]}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'route')
    console.log(releaseEligible(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF_NAME));
  else if (process.argv[2] === 'assert') {
    const jobs = JSON.parse(process.env.VERIFICATION_JOBS || '{}');
    const eligible = jobs.route?.outputs?.eligible;
    if (!['true', 'false'].includes(eligible)) throw Error('Missing verification routing decision');
    assertVerificationJobs(
      eligible === 'true',
      Object.fromEntries(Object.entries(jobs).map(([id, job]) => [id, job.result])),
    );
  } else throw Error('Use route or assert');
}
