/** Wrong-trace stub: lands anything a report mentions. Replaced by the real script next commit. */
import { execFileSync } from 'node:child_process';
export const LANDABLE_STATUSES = Object.freeze(['passed']);
export const LANDABLE_TIERS = Object.freeze(['local', 'merge', 'final']);
export function parseLandArgs(argv) {
  return { tip: argv[0] ?? null, report: null, dryRun: argv.includes('--dry-run') };
}
export function findLandingReports() {
  return [];
}
export function assertLandable() {}
export function land(argv, { cwd = process.cwd() } = {}) {
  const tip = execFileSync('git', ['rev-parse', argv[0]], { cwd, encoding: 'utf8' }).trim();
  execFileSync('git', ['merge', '--ff-only', tip], { cwd, stdio: 'ignore' });
  return { tip, landed: true, attestation: null };
}
