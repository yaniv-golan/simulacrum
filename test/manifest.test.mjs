import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../scripts/validate-manifest.mjs';
const manifest = JSON.parse(readFileSync(new URL('../scripts/manifest.json', import.meta.url)));
test('manifest owns every check and resolves milestone references', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
  const bad = structuredClone(manifest);
  delete bad.checks[0].ruleId;
  assert.throws(() => validateManifest(bad), /owner/);
  const deadline = structuredClone(manifest);
  deadline.checks[0].dueAt = 'M99';
  assert.throws(() => validateManifest(deadline), /milestone/);
  const duplicate = structuredClone(manifest);
  duplicate.checks.push(duplicate.checks[0]);
  assert.throws(() => validateManifest(duplicate), /duplicate/);
});
test('the dependency order places the ADR at M1 and all early legged bars at M7', () => {
  assert.ok(manifest.exitObligations.M1.some(x => x.id === 'physics-library-adr'));
  assert.deepEqual(['L1a','L1b','L1c'].map(x => manifest.bars[x].dueAt), ['M7','M7','M7']);
});
