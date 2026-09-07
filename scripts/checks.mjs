import { readManifest } from './validate-manifest.mjs';
import { suiteDeadline } from './browser-registry.mjs';
import { createVerificationContext } from './verification-run.mjs';
import { runCI } from './ci.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
// Each obligation owns one definition; execution expands its shared prerequisites.
export const CHECK_DEFINITIONS = Object.freeze({
  'no-live-state-reads': { units: ['test/controllers.test.mjs', 'test/m3-session.test.mjs'] },
  'identity-invariance-minimal': {
    units: ['test/m3-authoring.test.mjs'],
    node: ['scripts/verify-m3.mjs'],
  },
  'workshop-response': { browser: 'performance' },
  'production-control-path': { units: ['test/free-build-continuity.test.mjs'], browser: 'smoke' },
  'm1-qualification': { node: ['scripts/qualify-m1.mjs'], timeoutMs: 110000 },
  'minimal-failure-bundle': { node: ['scripts/replay.mjs', 'artifacts/m1/failure.json'] },
  'physics-library-adr': {
    leaf: async () => {
      const { readFileSync } = await import('node:fs');
      if (
        !readFileSync('docs/adr/0001-physics-library.md', 'utf8').includes(
          '@dimforge/rapier3d-deterministic-compat',
        )
      )
        throw Error('ADR missing library');
    },
  },
  'schema-rejects-malformed': {
    units: ['test/blueprint.test.mjs'],
    leaf: async () => {
      const { generateSchema } = await import('./generate-schema.mjs');
      generateSchema({ check: true });
    },
  },
  'single-library-importer': {
    leaf: async () => {
      const { checkPhysicsBoundary } = await import('./check-physics-boundary.mjs');
      checkPhysicsBoundary();
    },
  },
  'no-live-object-escape': { units: ['test/physics.test.mjs', 'test/workshop.test.mjs'] },
  'milestone-breadth-reject': {
    leaf: async () => {
      const { checkBreadth } = await import('./check-breadth.mjs');
      checkBreadth();
    },
  },
  'manifest-validates': { leaf: () => readManifest() },
  'ci-under-3min': { ci: true },
  'tooling-tests': {
    units: [
      'test/manifest.test.mjs',
      'test/browser-registry.test.mjs',
      'test/process-runner.test.mjs',
    ],
  },
});
// The leaf export is invoked only inside a killable child when a context is shared.
export async function checkLeaf(id) {
  const check = CHECK_DEFINITIONS[id];
  if (!check?.leaf) throw Error(`unknown leaf check: ${id}`);
  return check.leaf();
}
export async function executeCheck(id, context = createVerificationContext()) {
  const check = CHECK_DEFINITIONS[id];
  if (!check) throw Error(`unknown check: ${id}`);
  return context.check(`check:${id}`, { id }, async () => {
    if (check.leaf)
      await context.module(
        `leaf:${id}`,
        'scripts/checks.mjs',
        'checkLeaf',
        [id],
        checkDeadline(id),
      );
    if (check.units) await context.unit(check.units);
    if (check.node) await context.node(`process:${id}`, check.node, check.timeoutMs ?? 30000);
    if (check.browser) await verifyBrowserSuite(check.browser, { context, reuseBuild: true });
    if (check.ci) await runCI(context);
  });
}
export const CHECKS = Object.freeze(
  Object.fromEntries(Object.keys(CHECK_DEFINITIONS).map((id) => [id, () => executeCheck(id)])),
);
export function checkDeadline(id) {
  return id === 'production-control-path'
    ? suiteDeadline('smoke') + 40000
    : id === 'workshop-response'
      ? suiteDeadline('performance') + 10000
      : id === 'ci-under-3min'
        ? 190000
        : 120000;
}
