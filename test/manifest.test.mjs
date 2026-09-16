import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
test('performance-tier checks are registered timing-sensitive, which also excludes them from receipt reuse', () => {
  // The timingSensitive rows, boolean rule, exclusive-execution rule and budget-assertion source
  // guard are owned by the browser registry tests; this adds the performance-tier implication.
  const perf = structuredClone(manifest);
  const performance = perf.browserChecks.find((c) => c.tier === 'performance');
  assert.ok(performance, 'a performance-tier check exists');
  assert.equal(performance.timingSensitive, true);
  performance.timingSensitive = false;
  delete performance.measures; // `measures` is itself a timing-sensitive fact
  assert.throws(() => validateManifest(perf), /performance-tier/);
});

test('checks that launch a system browser channel are registered so the channel version binds their receipts', () => {
  const m = structuredClone(manifest);
  // Source guard over each script's closure of local imports (static and dynamic): a script
  // that launches channel 'chrome' itself or through a module it loads must be registered
  // (launch ⇒ declared), and a registered row must actually launch it (declared ⇒ launch).
  const closure = (entry) => {
    const seen = new Set();
    const visit = (path) => {
      if (seen.has(path)) return;
      // JSDoc type-only references may name generated files that do not exist in the tree.
      if (!existsSync(new URL(`../${path}`, import.meta.url))) return;
      seen.add(path);
      const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
      for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const target = new URL(match[1], `file:///${path}`).pathname.slice(1);
        if (/\.(mjs|js)$/.test(target)) visit(target);
      }
    };
    visit(entry);
    return [...seen];
  };
  const launchesChrome = (entry) =>
    closure(entry).some((path) =>
      /channel:\s*['"]chrome['"]/.test(
        readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
      ),
    );
  for (const c of m.browserChecks)
    assert.equal(
      c.browserChannel === 'chrome',
      launchesChrome(c.script),
      `${c.id}: browserChannel registration must match the channel launch in its module closure`,
    );
  // Positive controls: a direct launcher and a transitive one (cloud playtest loads the remote
  // playtest script dynamically).
  for (const id of ['verify-feedback-flow', 'verify-cloud-playtest'])
    assert.equal(m.browserChecks.find((c) => c.id === id)?.browserChannel, 'chrome', id);
  assert.ok(
    closure('scripts/verify-cloud-playtest.mjs').includes('scripts/verify-remote-playtest.mjs'),
  );
  m.browserChecks[0].browserChannel = 'firefox';
  assert.throws(() => validateManifest(m), /browserChannel/);
});

test('a metadata scope row with a partially excluded read is refused by the manifest validator, naming the read', () => {
  const m = structuredClone(manifest);
  const row = m.browserReviewMetadataScopes.find((s) => s.reads?.length);
  row.reads[0].excludedInputs = ['documentation'];
  assert.throws(() => validateManifest(m), /must exclude unit-test/);
  row.reads[0].excludedInputs = ['documentation', 'unit-test'];
  row.reads[0].purpose = 'test-selection';
  assert.throws(() => validateManifest(m), /needs purpose in/);
});
