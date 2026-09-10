import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeComparison, admitNativeInputs } from '../scripts/native-qualification.mjs';
test('native qualification rejects absent controls, passing mutants and infrastructure failures', () => {
  assert.throws(() => admitNativeInputs({}), /Missing native control/);
  const good = {
    baseline: { ok: true },
    candidate: { ok: true },
    staleFactor: { ok: false, failureKind: 'native-step' },
    staleRhs: { ok: false, failureKind: 'state-mismatch' },
  };
  assert.doesNotThrow(() => assertNativeComparison(good));
  for (const role of ['baseline', 'candidate'])
    assert.throws(() => assertNativeComparison({ ...good, [role]: { ok: false } }));
  for (const role of ['staleFactor', 'staleRhs'])
    for (const wrong of [{ ok: true }, { ok: false, failureKind: 'timeout' }, { ok: false }])
      assert.throws(() => assertNativeComparison({ ...good, [role]: wrong }));
});

test('native trace completion rejects successful exit with missing or partial cases', async () => {
  const { assertNativeTrace } = await import('../scripts/native-qualification.mjs');
  const trace = ['guided', 'active', 'launcher'].flatMap((name) =>
    [false, true].map((turn) => ({
      name,
      turn,
      ticks: name === 'launcher' ? 360 : 480,
      hashes: Array(name === 'launcher' ? 360 : 480).fill('a'.repeat(64)),
    })),
  );
  assert.doesNotThrow(() => assertNativeTrace(trace));
  for (const wrong of [
    undefined,
    [],
    trace.slice(1),
    [...trace.slice(0, 5), trace[0]],
    trace.map((x, i) => (i ? x : { ...x, hashes: [] })),
  ])
    assert.throws(() => assertNativeTrace(wrong));
});

test('native build workspace refuses another owner and retains failed inputs', async () => {
  const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } = await import(
    'node:fs'
  );
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const source = readFileSync(
    new URL('../vendor/rapier-contact/build.sh', import.meta.url),
    'utf8',
  );
  const root = mkdtempSync(join(tmpdir(), 'native-workspace-control-'));
  try {
    const scratch = join(root, 'scratch'),
      recipe = join(root, 'build.sh'),
      archive = join(root, 'input.tgz');
    // Only relocate the fixed physical root for test isolation; execute the real recipe.
    assert.ok(source.includes('contact_build_dir=/tmp/simulacrum-rapier-contact-build-v2'));
    const isolated = source.replace(
      'contact_build_dir=/tmp/simulacrum-rapier-contact-build-v2',
      `contact_build_dir=${scratch}`,
    );
    writeFileSync(recipe, isolated);
    writeFileSync(archive, 'retained invalid archive');
    writeFileSync(
      join(root, 'provenance.json'),
      JSON.stringify({ sourceArchiveSha256: '0'.repeat(64) }),
    );
    const run = (name) =>
      spawnSync('bash', [recipe], {
        encoding: 'utf8',
        env: { ...process.env, RAPIER_BUILD_DIR: join(root, name), RAPIER_SOURCE_ARCHIVE: archive },
      });
    mkdirSync(scratch);
    writeFileSync(join(scratch, 'sentinel'), 'other build');
    const occupied = run('occupied-output');
    assert.notEqual(occupied.status, 0);
    assert.match(occupied.stderr, /root occupied/);
    assert.equal(readFileSync(join(scratch, 'sentinel'), 'utf8'), 'other build');
    rmSync(scratch, { recursive: true });
    const failed = run('failed-output');
    assert.notEqual(failed.status, 0);
    assert.equal(
      readFileSync(join(root, 'failed-output/source.tgz'), 'utf8'),
      'retained invalid archive',
    );
    assert.equal(existsSync(scratch), false);
    // Deliberately disable archival: the retention assertion must catch the defect.
    writeFileSync(recipe, isolated.replace('trap retain_build EXIT', "trap ':' EXIT"));
    const wrong = run('wrong-output');
    assert.notEqual(wrong.status, 0);
    assert.throws(() => assert.equal(existsSync(join(root, 'wrong-output/source.tgz')), true));
    assert.equal(existsSync(join(scratch, 'source.tgz')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
