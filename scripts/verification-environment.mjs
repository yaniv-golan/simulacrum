import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const stable = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
/** Environment that changes what a check does or selects. Terminal, cwd and private variables
 * must not change identity, or no two invocations ever share a receipt. Every variable a leaf
 * reads under scripts, src or test is either listed here or exempted below with its reason. */
export const RELEVANT_ENVIRONMENT = Object.freeze({
  // The hosted profile changes budgets and which rows are evaluated; verify:candidate refuses it
  // outright, so no hosted (measurement) receipt can ever be offered to a retry, and binding it
  // keeps the direct tiers' receipts honest too.
  names: Object.freeze([
    'NODE_ENV',
    'NODE_OPTIONS',
    'POWER_BASELINE_SOURCE',
    'SIMULACRUM_HOST_PROFILE',
  ]),
  prefixes: Object.freeze([
    'FEEDBACK_',
    'LOAD_CELL_MATRIX_',
    'PLAYWRIGHT_',
    'PLAYTEST_',
    'SIMULACRUM_BROWSER_',
  ]),
});
/** Variables read in the tree that deliberately do not bind receipt identity. */
export const ENVIRONMENT_EXEMPTIONS = Object.freeze({
  'scheduling admission for timing-sensitive rows, which never reuse a receipt': [
    'SIMULACRUM_TIMING_LOAD_BOUND',
    'SIMULACRUM_TIMING_IDLE_BOUND',
    'SIMULACRUM_TIMING_FOREIGN_BOUND',
    'SIMULACRUM_TIMING_PRESSURE',
    'SIMULACRUM_TIMING_WAIT_MS',
    'SIMULACRUM_LAUNCH_ADMISSION_WAIT_MS',
  ],
  'attempt coordination, set per attempt or per candidate by the candidate command or the window': [
    'SIMULACRUM_VERIFICATION_WINDOW',
    'SIMULACRUM_LEAF_LEDGER',
    'SIMULACRUM_VERIFICATION_ATTEMPT',
    'SIMULACRUM_VERIFICATION_INTENT',
    'SIMULACRUM_CANDIDATE_INSTALLED_AT',
  ],
  'host plumbing: binary lookup and per-candidate cache locations, recorded forensically': [
    'PATH',
    'SIMULACRUM_VITE_CACHE_DIR',
    'MINIFLARE_CACHE_DIR',
  ],
  'release pipeline inputs and secrets; never read by a verification leaf': [
    'GITHUB_ACTIONS',
    'GITHUB_EVENT_NAME',
    'GITHUB_EVENT_PATH',
    'GITHUB_REF_NAME',
    'GITHUB_REPOSITORY',
    'GITHUB_RUN_ATTEMPT',
    'GITHUB_RUN_ID',
    'GITHUB_RUN_NUMBER',
    'GH_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CALIBRATION_BUNDLE_TOKEN',
    'RELEASE_ACKNOWLEDGE_FAILURES',
    'RELEASE_CONFIG',
    'RELEASE_DIGEST',
    'RELEASE_PREDECESSOR',
    'RELEASE_ROLLBACK',
    'RELEASE_RUN_ID',
    'RELEASE_VERIFICATION_MODE',
    'RELEASE_VERIFICATION_REASON',
    'VERIFICATION_JOBS',
  ],
  'test-owned knobs set by the test for the child it spawns, never inherited from the verifier': [
    'CALL_LOG',
    'DRIFT',
    'FAIL_AUTOMATION',
    'MUTATE_DEPS',
    'PARENT_ATTEMPT',
    'PARENT_REPORT',
    'PURGED',
    'SIM_VERIFIER_TEST_CONFIGURATION',
  ],
});
export const isRelevantEnvironmentName = (name) =>
  RELEVANT_ENVIRONMENT.names.includes(name) ||
  RELEVANT_ENVIRONMENT.prefixes.some((prefix) => name.startsWith(prefix));
const attemptScopedKeys = [
  'SIMULACRUM_VERIFICATION_WINDOW',
  'SIMULACRUM_LEAF_LEDGER',
  'SIMULACRUM_VERIFICATION_ATTEMPT',
];
const digestEnvironment = (entries) =>
  createHash('sha256')
    .update(stable(Object.fromEntries(entries)))
    .digest('hex');
export function relevantEnvironmentDigest(env = process.env) {
  // The verification runtime defaults NODE_ENV to production before any check runs; digest the
  // same default so the candidate command and the tier agree on identity.
  const entries = Object.entries({ ...env, NODE_ENV: env.NODE_ENV ?? 'production' });
  return digestEnvironment(entries.filter(([k]) => isRelevantEnvironmentName(k)));
}
/** Forensic record of the whole environment; never part of receipt identity. */
export function environmentForensics(env = process.env) {
  return {
    environmentDigest: digestEnvironment(
      Object.entries(env).filter(([k]) => !attemptScopedKeys.includes(k)),
    ),
    relevant: RELEVANT_ENVIRONMENT,
    systemBrowsers: { chrome: systemBrowserVersion('chrome') },
  };
}
/** The process-level part of verification identity, computable without the verification runtime. */
export function processIdentity(env = process.env) {
  return {
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    environmentDigest: relevantEnvironmentDigest(env),
  };
}
const chromeCandidates = {
  darwin: ['/Applications/Google Chrome.app/Contents/Info.plist'],
  linux: ['google-chrome', 'google-chrome-stable', 'chrome'],
  win32: [],
};
/** Version of the system browser a `channel` check launches; installed dependencies pin only the
 * bundled Playwright browsers, so a system channel is bound per check through its configuration.
 * Unavailable browsers are reported as such, never silently equal across hosts. */
export function systemBrowserVersion(channel, platform = process.platform) {
  if (channel !== 'chrome') throw Error(`unknown browser channel: ${channel}`);
  for (const candidate of chromeCandidates[platform] ?? []) {
    try {
      if (platform === 'darwin') {
        const match = readFileSync(candidate, 'utf8').match(
          /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/,
        );
        if (match) return `chrome ${match[1].trim()}`;
      } else {
        const text = execFileSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
        if (text.trim()) return text.trim().toLowerCase();
      }
    } catch {
      // try the next candidate
    }
  }
  return 'unavailable';
}
