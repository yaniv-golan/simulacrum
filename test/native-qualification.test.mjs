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

test('native physical probe adapter disables only diagnostic collection for every role', async () => {
  const { adaptNativePhysicalProbe } = await import('../scripts/native-qualification.mjs');
  const source = [
    "import { createJointReactions } from './joint-reactions.mjs';",
    "const PHYSICS_BACKEND = '0.20.0-simulacrum.spring.10.f64';",
    'const projection = readNativeResponse(factor, indices.length, reactionIndices.length);',
    'const untouchedPhysicalApplication = island.apply(impulse);',
  ].join('\n');
  const adapted = adaptNativePhysicalProbe(
    source,
    '0.20.0-simulacrum.spring.10.f64',
    '0.20.0-simulacrum.spring.9.f64',
  );
  assert.ok(adapted.includes('const untouchedPhysicalApplication = island.apply(impulse);'));
  assert.ok(adapted.includes('readNativeResponse(factor, indices.length);'));
  assert.ok(adapted.includes("const PHYSICS_BACKEND = '0.20.0-simulacrum.spring.9.f64';"));
  assert.throws(
    () =>
      adaptNativePhysicalProbe(
        source + '\n' + source,
        '0.20.0-simulacrum.spring.10.f64',
        '0.20.0-simulacrum.spring.9.f64',
      ),
    /needs review/,
  );
  assert.throws(
    () =>
      adaptNativePhysicalProbe(
        source.replace('reactionIndices.length', '0'),
        '0.20.0-simulacrum.spring.10.f64',
        '0.20.0-simulacrum.spring.9.f64',
      ),
    /needs review/,
  );
  // A strict stand-in records the completed native callback, without knowing any physics.
  let completed,
    added = false;
  const factory = () => ({
    add() {
      added = true;
    },
    complete(native) {
      completed = native(0);
    },
    snapshot() {
      return { completed };
    },
  });
  const prefix = adapted.slice(adapted.indexOf('\n') + 1, adapted.indexOf('const PHYSICS_BACKEND'));
  const { spawnSync } = await import('node:child_process');
  const execution = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    let completed, added = false;
    const createPhysicalProbeReactions = ${factory.toString()};
    ${prefix};
    const receipt = createJointReactions([]);
    receipt.add([0], [1,2,3]);
    receipt.complete(() => { throw Error('historical native method must not be called'); });
    console.log(JSON.stringify({added,completed,snapshot:receipt.snapshot()}));
  `,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout), {
    added: false,
    completed: null,
    snapshot: { completed: null },
  });
});

test('native input admission includes spring10 while retaining hash and version rejection', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const root = mkdtempSync(join(tmpdir(), 'native-input-admission-'));
  try {
    const config = {};
    for (const role of ['baseline', 'candidate', 'staleFactor', 'staleRhs']) {
      const row = { version: `0.20.0-simulacrum.spring.${role === 'candidate' ? 10 : 9}.f64` };
      for (const field of ['package', 'patch']) {
        const bytes = `${role}/${field}`;
        row[field] = join(root, `${role}.${field}`);
        writeFileSync(row[field], bytes);
        row[`${field}Sha256`] = createHash('sha256').update(bytes).digest('hex');
      }
      config[role] = row;
    }
    assert.doesNotThrow(() => admitNativeInputs(config));
    assert.throws(
      () =>
        admitNativeInputs({
          ...config,
          candidate: { ...config.candidate, version: '0.20.0-simulacrum.spring.11.f64' },
        }),
      /Missing native control/,
    );
    assert.throws(
      () =>
        admitNativeInputs({
          ...config,
          candidate: { ...config.candidate, packageSha256: '0'.repeat(64) },
        }),
      /hash mismatch/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('historical native recipe omissions require reviewed bytes and preserve candidate checks', async () => {
  const { adaptHistoricalNativeRecipe } = await import('../scripts/native-qualification.mjs');
  const { createHash } = await import('node:crypto');
  const hash = (v) => createHash('sha256').update(v).digest('hex');
  const diagnostic = 'node "$contact_build_dir/native-check/test-joint-reactions.mjs"';
  const residualCompile =
    'rustc --edition=2021 --test "$contact_source_root/src/dynamics/solver/staged_island_solver/residual_bound.rs" -o "$contact_build_dir/residual-tests"';
  const script = [
    residualCompile,
    '"$contact_build_dir/residual-tests"',
    '"$contact_build_dir/friction-tests"',
    diagnostic,
    'cargo build --locked',
    'npm pack',
  ].join('\n');
  const historical = Buffer.from('reviewed historical patch without diagnostics'),
    current = Buffer.from(
      '+++ b/src/dynamics/solver/staged_island_solver/residual_bound.rs\n+pub fn jointAppliedLinearImpulse(\n+pub fn projectWithJointImpulses(\n+pub fn responseWithJointImpulses(',
    );
  const row = (version, patch) => ({ version, patchSha256: hash(patch) });
  assert.equal(typeof adaptHistoricalNativeRecipe, 'function');
  const candidate = adaptHistoricalNativeRecipe(
    script,
    'candidate',
    current,
    row('0.20.0-simulacrum.spring.10.f64', current),
  );
  assert.throws(
    () =>
      adaptHistoricalNativeRecipe(
        script.replace(diagnostic, ''),
        'candidate',
        current,
        row('0.20.0-simulacrum.spring.10.f64', current),
      ),
    /needs review/,
  );
  assert.equal(candidate.source, script);
  assert.deepEqual(candidate.omissions, []);
  const old = adaptHistoricalNativeRecipe(
    script,
    'staleFactor',
    historical,
    row('0.20.0-simulacrum.spring.8.f64', historical),
  );
  assert.equal(old.omissions.length, 2);
  assert.ok(!old.source.includes(diagnostic));
  assert.ok(!old.source.includes('residual-tests'));
  assert.ok(old.source.includes('"$contact_build_dir/friction-tests"'));
  assert.ok(old.source.includes('cargo build --locked\nnpm pack'));
  const spring9 = Buffer.from('+++ b/src/dynamics/solver/staged_island_solver/residual_bound.rs');
  const baseline = adaptHistoricalNativeRecipe(
    script,
    'baseline',
    spring9,
    row('0.20.0-simulacrum.spring.9.f64', spring9),
  );
  assert.equal(baseline.omissions.length, 1);
  assert.ok(baseline.source.includes(residualCompile));
  assert.throws(
    () =>
      adaptHistoricalNativeRecipe(
        script,
        'staleRhs',
        historical,
        row('0.20.0-simulacrum.spring.8.f64', current),
      ),
    /reviewed patch/,
  );
  assert.throws(
    () =>
      adaptHistoricalNativeRecipe(
        script + '\n' + diagnostic,
        'baseline',
        spring9,
        row('0.20.0-simulacrum.spring.9.f64', spring9),
      ),
    /needs review/,
  );
  assert.throws(
    () =>
      adaptHistoricalNativeRecipe(
        script,
        'staleFactor',
        historical,
        row('0.20.0-simulacrum.spring.10.f64', historical),
      ),
    /historical source/,
  );
  assert.throws(
    () =>
      adaptHistoricalNativeRecipe(
        script,
        'candidate',
        historical,
        row('0.20.0-simulacrum.spring.10.f64', historical),
      ),
    /candidate source/,
  );
});
