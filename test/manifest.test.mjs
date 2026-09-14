import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateManifest,
  validateManifestText,
  CANONICAL_LAYOUT_MESSAGE,
} from '../scripts/validate-manifest.mjs';
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
  assert.ok(manifest.exitObligations.M1.some((x) => x.id === 'physics-library-adr'));
  assert.deepEqual(
    ['L1a', 'L1b', 'L1c'].map((x) => manifest.bars[x].dueAt),
    ['M7', 'M7', 'M7'],
  );
});

test('experiment reuse scopes require exact bounded sources and registered checks', () => {
  for (const change of [
    (x) => (x.family = 'invented'),
    (x) => (x.sourceSha256 = 'bad'),
    (x) => (x.runtimeBoundary = 'unknown'),
    (x) => (x.checks = ['missing']),
    (x) => (x.dependencies = ['../escape']),
  ]) {
    const m = structuredClone(manifest);
    change(m.experimentInputScopes[0]);
    assert.throws(() => validateManifest(m), /experiment/);
  }
  const m = structuredClone(manifest);
  m.experimentInputScopes[0].sourceSha256 = 'a'.repeat(64);
  assert.doesNotThrow(() => validateManifest(m)); // changed source broadens selection, not structural admission
});
test('manifest bytes must keep the canonical two-space layout the scope writer emits', () => {
  const text = readFileSync(new URL('../scripts/manifest.json', import.meta.url), 'utf8');
  assert.doesNotThrow(() => validateManifestText(text));
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + '\n');
  const m = JSON.parse(text);
  // Content-preserving key reordering is still canonical: the check is about layout only.
  const reordered = Object.fromEntries(Object.entries(m).reverse());
  assert.doesNotThrow(() => validateManifestText(JSON.stringify(reordered, null, 2) + '\n'));
  // Plausible wrong traces: prettier's collapsed array, other indents, compact, CRLF, BOM, no newline.
  assert.match(text, /\[\n\s+"[^"\n]*"\n\s+\]/, 'a one-element array exists to collapse');
  for (const wrong of [
    text.replace(/\[\n\s+("[^"\n]*")\n\s+\]/, '[$1]'),
    JSON.stringify(m, null, 4) + '\n',
    JSON.stringify(m) + '\n',
    text.replace(/\n/g, '\r\n'),
    text.trimEnd(),
  ]) {
    assert.notEqual(wrong, text);
    assert.throws(() => validateManifestText(wrong), { message: CANONICAL_LAYOUT_MESSAGE });
  }
  assert.throws(() => validateManifestText('\uFEFF' + text), SyntaxError);
  assert.throws(() => validateManifestText(Buffer.from(text)), TypeError);
  assert.match(CANONICAL_LAYOUT_MESSAGE, /--canonical-layout/);
});
test('the manifest stays out of prettier so hosted format checks see the writer layout', () => {
  const ignore = readFileSync(new URL('../.prettierignore', import.meta.url), 'utf8');
  assert.ok(
    ignore.split('\n').includes('scripts/manifest.json'),
    '.prettierignore must list scripts/manifest.json; validateManifest owns its layout',
  );
});
test('timing-sensitive browser checks are registered, exclusive, and cover every budget-asserting script', () => {
  const m = structuredClone(manifest);
  const sensitive = m.browserChecks.filter((c) => c.timingSensitive === true).map((c) => c.id);
  for (const id of [
    'verify-spring-performance',
    'verify-lamp-performance',
    'verify-adaptive-graphics',
    'qualify-workshop',
    'measure-gears',
    'measure-cameras',
    'verify-mechanical-audio',
    'verify-camera-browser',
  ])
    assert.ok(sensitive.includes(id), `${id} must be registered timing-sensitive`);
  // Source guard: a script that asserts a timing budget must be registered (assertion ⇒ declared).
  const guard =
    /\b(p95|quantile|renderP95Ms|cadenceP95Ms|tickP95Ms|realTimeRatio|frameCpuMs|audioCpuMs)\b/;
  for (const c of m.browserChecks)
    if (guard.test(readFileSync(new URL(`../${c.script}`, import.meta.url), 'utf8')))
      assert.equal(c.timingSensitive, true, `${c.id} asserts timing but is not registered`);
  m.browserChecks[0].timingSensitive = 'yes';
  assert.throws(() => validateManifest(m), /timingSensitive/);
  const parallel = structuredClone(manifest);
  parallel.browserChecks.find((c) => c.timingSensitive === true).execution = 'parallel';
  assert.throws(() => validateManifest(parallel), /exclusively|browser check/);
});
