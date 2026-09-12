import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partHelpPartition } from '../scripts/part-help-cases.mjs';

test('part help partitions retain six interaction scenarios and the complete catalog inspector check', () => {
  const source = readFileSync(new URL('../scripts/part-help-cases.mjs', import.meta.url), 'utf8');
  const names = [...source.matchAll(/await attempt\(\s*'([^']+)'/g)].map((match) => match[1]);
  assert.equal(names.length, 7);
  assert.equal(new Set(names).size, 7);
  const groups = [0, 1].map((partition) =>
    names.filter((name) => partHelpPartition(name) === partition),
  );
  assert.equal(groups[0].length, 6);
  assert.deepEqual(groups[1], ['supported-inspectors']);
  assert.deepEqual(new Set(groups.flat()), new Set(names));
  assert.throws(() => partHelpPartition(null));
  const manifest = JSON.parse(readFileSync(new URL('../scripts/manifest.json', import.meta.url)));
  for (const [partition, id] of [
    'verify-part-help-browser',
    'verify-part-help-inspectors',
  ].entries()) {
    const check = manifest.browserChecks.find((check) => check.id === id);
    assert.equal(check?.timeoutMs, partition === 0 ? 90000 : 60000);
    assert.equal(check?.execution, 'parallel');
    const wrapper = readFileSync(new URL(`../scripts/${id}.mjs`, import.meta.url), 'utf8');
    assert.ok(wrapper.includes(`runPartHelpCases(${partition}, evidence, browser)`));
    for (const scope of manifest.browserLocalScopes.filter((scope) =>
      scope.checks.includes('verify-part-help-browser'),
    ))
      assert.ok(scope.checks.includes(id), `${scope.entrypoint} omits ${id}`);
  }
});
