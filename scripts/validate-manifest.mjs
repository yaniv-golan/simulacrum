import { readFileSync } from 'node:fs';
import { validateInvariantCoverage } from './invariant-coverage.mjs';
export function validateManifest(m) {
  const unique = (values, what) => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${what}`);
  };
  if (!Number.isInteger(m.contractVersion) || m.contractVersion < 1)
    throw new Error('contract version required');
  if (!Array.isArray(m.milestones) || !m.milestones.length) throw new Error('milestones required');
  unique(m.milestones, 'milestone');
  const milestone = (x) => {
    if (!m.milestones.includes(x)) throw new Error(`unknown milestone: ${x}`);
  };
  milestone(m.milestone);
  if (!m.rules?.length) throw new Error('rules required');
  unique(
    m.rules.map((x) => x.id),
    'rule',
  );
  unique(
    m.checks.map((x) => x.id),
    'check',
  );
  const rules = new Set(m.rules.map((x) => x.id));
  const bars = new Set(Object.keys(m.bars));
  for (const [id, b] of Object.entries(m.bars)) {
    milestone(b.dueAt);
    if (id === 'F1' && (typeof b.participant !== 'string' || !b.participant.trim()))
      throw new Error('F1 designated participant required');
    if (typeof b.human !== 'boolean' || !b.contract?.trim()) throw new Error(`invalid bar ${id}`);
  }
  const own = (x) => {
    if (
      Number(rules.has(x.ruleId)) + Number(bars.has(x.barId)) !== 1 ||
      (x.ruleId !== undefined && !rules.has(x.ruleId)) ||
      (x.barId !== undefined && !bars.has(x.barId))
    )
      throw new Error(`missing or unknown owner: ${x.id}`);
  };
  for (const x of m.checks) {
    milestone(x.dueAt);
    own(x);
  }
  const obligations = [];
  for (const key of m.milestones) {
    if (!Array.isArray(m.exitObligations[key])) throw new Error(`missing obligations: ${key}`);
    for (const x of m.exitObligations[key]) {
      own(x);
      obligations.push(x.id);
    }
  }
  const browser = m.browserChecks ?? [];
  unique(
    browser.map((x) => x.id),
    'browser check',
  );
  unique(
    browser.map((x) => x.script),
    'browser script',
  );
  for (const x of browser) {
    own(x);
    if (
      !/^scripts\/[a-z0-9-]+\.mjs$/.test(x.script) ||
      !['browser', 'performance'].includes(x.tier) ||
      !['workshop', 'self', 'probe'].includes(x.environment) ||
      (x.execution !== undefined && !['parallel', 'exclusive'].includes(x.execution)) ||
      (x.execution === 'parallel' && (x.tier === 'performance' || x.environment !== 'workshop')) ||
      typeof x.smoke !== 'boolean' ||
      !Number.isSafeInteger(x.timeoutMs) ||
      x.timeoutMs <= 0
    )
      throw Error(`invalid browser check: ${x.id}`);
  }
  unique(obligations, 'obligation');
  for (const key of Object.keys(m.exitObligations)) milestone(key);
  validateInvariantCoverage(m);
  const scopes = m.browserLocalScopes ?? [];
  unique(
    scopes.map((s) => s.entrypoint),
    'local browser entrypoint',
  );
  for (const scope of scopes) {
    if (
      typeof scope.entrypoint !== 'string' ||
      !(
        scope.entrypoint.startsWith('src/') ||
        browser.some((c) => c.script === scope.entrypoint && scope.checks?.includes(c.id))
      ) ||
      !Array.isArray(scope.externalImports ?? []) ||
      !(scope.externalImports ?? []).every((p) => typeof p === 'string') ||
      !Array.isArray(scope.dependencies) ||
      !scope.dependencies.every((p) => typeof p === 'string') ||
      !Array.isArray(scope.checks) ||
      scope.checks.length < (scope.entrypoint.startsWith('src/') ? 2 : 1) ||
      !scope.checks.every((id) => browser.some((c) => c.id === id))
    )
      throw Error('invalid local browser scope');
    unique(scope.dependencies, 'local browser dependency');
    unique(scope.checks, 'local browser check');
  }
  const experiments = m.experimentInputScopes ?? [];
  if (!Array.isArray(experiments)) throw Error('invalid experiment scopes');
  unique(
    experiments.map((x) => `${x.family}:${x.entrypoint}`),
    'experiment entrypoint',
  );
  const localPath = (p) =>
    typeof p === 'string' && !p.startsWith('/') && !p.split('/').includes('..');
  for (const scope of experiments) {
    if (
      !['capacity', 'endurance'].includes(scope.family) ||
      !localPath(scope.entrypoint) ||
      !scope.entrypoint.startsWith('scripts/') ||
      !/^[a-f0-9]{64}$/.test(scope.sourceSha256 ?? '') ||
      scope.runtimeBoundary !==
        (scope.family === 'capacity'
          ? 'synthetic-capacity-envelope-v1'
          : 'packaged-capture-runtime-v1') ||
      !Array.isArray(scope.dependencies) ||
      !scope.dependencies.every(localPath) ||
      !Array.isArray(scope.externalImports) ||
      !scope.externalImports.every((x) => typeof x === 'string') ||
      !Array.isArray(scope.checks) ||
      !scope.checks.length ||
      !scope.checks.every((id) => m.checks.some((c) => c.id === id))
    )
      throw Error('invalid experiment input scope');
    unique(scope.dependencies, 'experiment dependency');
    unique(scope.checks, 'experiment check');
  }
  const metadataScopes = m.browserReviewMetadataScopes ?? [];
  if (!Array.isArray(metadataScopes)) throw Error('invalid browser review metadata scopes');
  unique(
    metadataScopes.map((s) => s.entrypoint),
    'browser review metadata owner',
  );
  for (const scope of metadataScopes) {
    if (
      !localPath(scope.entrypoint) ||
      !scope.entrypoint.startsWith('scripts/') ||
      !/^[a-f0-9]{64}$/.test(scope.sourceSha256 ?? '') ||
      !Array.isArray(scope.dependencies) ||
      !scope.dependencies.every(localPath) ||
      !Array.isArray(scope.externalImports) ||
      !scope.externalImports.every((x) => typeof x === 'string') ||
      !Array.isArray(scope.checks) ||
      !scope.checks.length ||
      !scope.checks.every((id) => m.checks.some((c) => c.id === id))
    )
      throw Error('invalid browser review metadata scope');
  }
  return m;
}
export function readManifest() {
  return validateManifest(JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url))));
}
