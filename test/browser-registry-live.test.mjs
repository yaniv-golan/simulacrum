import test from 'node:test';
import assert from 'node:assert/strict';
import { browserChecks } from '../scripts/browser-registry.mjs';
import { assertVerificationReady } from '../scripts/verification-preparation.mjs';
test('live registry freshness and mirror coverage contract', async () => {
  await assertVerificationReady(process.cwd(), {
    documentation: async () => ({ value: { errors: [] } }),
  });
  const { affectedBrowserChecks } = await import('../scripts/browser-selection.mjs');
  // A widened selection must name its cause here, not surface as sixty unexpected ids below.
  const audit = affectedBrowserChecks(['scripts/verify-mirror-browser.mjs']).audit;
  assert.equal(
    audit.readKindsAudited,
    true,
    `opaque reads are not audited: ${audit.unaudited.map((u) => `${u.entrypoint ?? 'environment'}: ${u.reason}`).join('; ')}`,
  );
  const docs = [
    'docs/development/.reviews/recipes/change-a-presentation-overlay.json',
    'docs/development/.reviews/recipes/change-an-interaction.json',
    'docs/development/.reviews/recipes/change-multi-part-authoring.json',
    'docs/development/recipes.md',
  ];
  const code = [
    'scripts/verify-mirror-browser.mjs',
    'src/model/messages.mjs',
    'test/failure-messages.test.mjs',
  ];
  const expected = [
    'verify-mirror-browser',
    'verify-assembly-ux-browser',
    'verify-assembly-library-browser',
    'verify-assemblies-browser',
    'verify-surface-browser',
    'verify-connection-test-browser',
    'verify-workshop',
    'verify-spring-browser',
    'verify-learning-examples',
    'verify-authorable-scenes',
    'verify-beam-length-browser',
  ].sort();
  assert.deepEqual(
    affectedBrowserChecks([...docs, ...code])
      .checks.map((c) => c.id)
      .sort(),
    expected,
  );
  assert.deepEqual(
    affectedBrowserChecks(code)
      .checks.map((c) => c.id)
      .sort(),
    expected,
  );
  assert.equal(affectedBrowserChecks(docs).checks.length, 0);
  assert.equal(affectedBrowserChecks([code[2]]).checks.length, 0);
  assert.equal(
    affectedBrowserChecks(['config/unknown-fixture.json']).checks.length,
    browserChecks().length,
  );
});
