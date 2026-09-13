import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { captureCandidate, candidateMatchesOrigin, candidateIdentity } from './candidate.mjs';
import { runProcess } from './run-check.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Test-only adapter applied identically to every frozen qualification role.
 * Historical packages cannot collect the added diagnostics. Keep their physical
 * APIs and every physical application unchanged; completed diagnostics are
 * explicitly unavailable in this comparison. Product reaction tests remain required.
 */
export function adaptNativePhysicalProbe(source, currentVersion, version) {
  const replaceOnce = (from, to) => {
    if (source.split(from).length !== 2) throw Error('Native physical probe adapter needs review');
    source = source.replace(from, to);
  };
  replaceOnce(
    "import { createJointReactions } from './joint-reactions.mjs';",
    `import { createJointReactions as createPhysicalProbeReactions } from './joint-reactions.mjs';
// QUALIFICATION ONLY: identical diagnostic suppression in all four native roles.
const createJointReactions = (joints) => {
  const receipt = createPhysicalProbeReactions(joints);
  return Object.freeze({ ...receipt, add() {}, complete() { receipt.complete(() => null); } });
};`,
  );
  replaceOnce(
    'readNativeResponse(factor, indices.length, reactionIndices.length)',
    'readNativeResponse(factor, indices.length)',
  );
  replaceOnce(
    `const PHYSICS_BACKEND = '${currentVersion}';`,
    `const PHYSICS_BACKEND = '${version}';`,
  );
  return source;
}
/** Adapt only checked historical recipe commands after source-difference review.
 * The caller verifies reviewedDifferenceSha256 before invoking this function.
 * Candidate commands always remain intact. No compiled bytes are rewritten.
 */
export function adaptHistoricalNativeRecipe(source, role, patch, row) {
  if (sha(patch) !== row.patchSha256)
    throw Error('Historical recipe requires reviewed patch bytes');
  const text = patch.toString(),
    hasResidual = text.includes('+++ b/src/dynamics/solver/staged_island_solver/residual_bound.rs'),
    diagnosticMarkers = [
      'pub fn jointAppliedLinearImpulse(',
      'pub fn projectWithJointImpulses(',
      'pub fn responseWithJointImpulses(',
    ],
    diagnosticCount = diagnosticMarkers.filter((marker) => text.includes(marker)).length,
    omissions = [],
    diagnosticCommand = 'node "$contact_build_dir/native-check/test-joint-reactions.mjs"',
    residualCompile =
      'rustc --edition=2021 --test "$contact_source_root/src/dynamics/solver/staged_island_solver/residual_bound.rs" -o "$contact_build_dir/residual-tests"',
    residualRun = '"$contact_build_dir/residual-tests"';
  for (const command of [diagnosticCommand, residualCompile, residualRun])
    if (source.split('\n').filter((line) => line === command).length !== 1)
      throw Error('Historical native recipe needs review');
  if (role === 'candidate') {
    if (!hasResidual || diagnosticCount !== diagnosticMarkers.length)
      throw Error('Incomplete candidate source; required checks cannot be omitted');
    return { source, omissions };
  }
  if (
    !['baseline', 'staleFactor', 'staleRhs'].includes(role) ||
    !/^0\.20\.0-simulacrum\.spring\.[6789]\.f64$/.test(row.version) ||
    diagnosticCount !== 0
  )
    throw Error('Unrecognized historical source; recipe needs review');
  const omitOnce = (command) => {
    source = source
      .split('\n')
      .filter((line) => line !== command)
      .join('\n');
  };
  omitOnce(diagnosticCommand);
  omissions.push({
    check: 'joint-reaction-api',
    reason:
      'Reviewed historical source lacks the new diagnostic APIs; candidate retains this probe.',
    patchSha256: row.patchSha256,
  });
  if (!hasResidual) {
    omitOnce(residualCompile);
    omitOnce(residualRun);
    omissions.push({
      check: 'residual-bound-module',
      reason:
        'Reviewed historical source predates this module; its original residual equations remain in the rebuilt package.',
      patchSha256: row.patchSha256,
    });
  }
  return { source, omissions };
}

export function admitNativeInputs(config) {
  const result = {};
  for (const role of ['baseline', 'candidate', 'staleFactor', 'staleRhs']) {
    const row = config[role];
    if (
      !row ||
      !/^0\.20\.0-simulacrum\.spring\.(?:[6789]|10)\.f64$/.test(row.version) ||
      !row.package ||
      !row.patch
    )
      throw Error(`Missing native control: ${role}`);
    for (const field of ['package', 'patch'])
      if (sha(readFileSync(row[field])) !== row[`${field}Sha256`])
        throw Error(`Native ${role} ${field} hash mismatch`);
    result[role] = row;
  }
  if (new Set(Object.values(result).map((r) => r.packageSha256)).size !== 4)
    throw Error('Native controls must be distinct packages');
  if (new Set(Object.values(result).map((r) => r.patchSha256)).size !== 4)
    throw Error('Native controls must retain distinct source patches');
  return result;
}
export function assertNativeComparison(results) {
  if (!results.baseline?.ok || !results.candidate?.ok)
    throw Error('Baseline and candidate equivalence must pass');
  for (const role of ['staleFactor', 'staleRhs'])
    if (
      results[role]?.ok ||
      !['state-mismatch', 'native-step'].includes(results[role]?.failureKind)
    )
      throw Error(`Control did not fail in native behavior: ${role}`);
}
export function assertNativeTrace(trace) {
  if (!Array.isArray(trace) || trace.length !== 6) throw Error('Incomplete native trace');
  for (const name of ['guided', 'active', 'launcher'])
    for (const turn of [false, true]) {
      const rows = trace.filter((x) => x.name === name && x.turn === turn),
        ticks = name === 'launcher' ? 360 : 480;
      if (
        rows.length !== 1 ||
        rows[0].ticks !== ticks ||
        !Array.isArray(rows[0].hashes) ||
        rows[0].hashes.length !== ticks ||
        !rows[0].hashes.every((x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x))
      )
        throw Error('Incomplete native trace');
    }
}
export async function qualifyNative(config) {
  const root = process.cwd(),
    directory = mkdtempSync(join(tmpdir(), 'simulacrum-native-'));
  // Freeze external inputs before any asynchronous install/build work.
  const inputs = admitNativeInputs(config),
    frozenInputs = {};
  for (const [role, row] of Object.entries(inputs)) {
    const dir = join(directory, `${role}-inputs`);
    mkdirSync(dir);
    frozenInputs[role] = { ...row };
    for (const field of ['package', 'patch']) {
      const bytes = readFileSync(row[field]);
      if (sha(bytes) !== row[`${field}Sha256`])
        throw Error('Native input changed during admission');
      const target = join(dir, field === 'package' ? 'runtime.tgz' : 'contact.patch');
      writeFileSync(target, bytes);
      frozenInputs[role][field] = target;
    }
  }
  const report = {
    status: 'running',
    directory,
    inputs: frozenInputs,
    comparisons: {},
    reproducibility: 'NOT_RUN',
  };
  const write = () =>
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  write();
  try {
    const source = await captureCandidate(root, join(directory, 'source'));
    report.source = source;
    write();
    const provenance = JSON.parse(
      readFileSync(join(source.destination, 'vendor/rapier-contact/provenance.json')),
    );
    if (
      inputs.candidate.packageSha256 !== provenance.packageSha256 ||
      inputs.candidate.patchSha256 !== provenance.patchSha256
    )
      throw Error('Candidate inputs are not the current recipe');
    const candidatePatch = readFileSync(frozenInputs.candidate.patch);
    for (const role of ['baseline', 'staleFactor', 'staleRhs']) {
      const difference = Buffer.concat([
        candidatePatch,
        Buffer.from('\0'),
        readFileSync(frozenInputs[role].patch),
      ]);
      if (
        inputs[role].reviewedDifferenceSha256 !== sha(difference) ||
        typeof inputs[role].reviewRationale !== 'string' ||
        inputs[role].reviewRationale.trim().length < 30
      )
        throw Error(`Reviewed native source difference required: ${role}`);
      writeFileSync(
        join(directory, `${role}-difference.json`),
        JSON.stringify({
          candidatePatch: candidatePatch.toString(),
          controlPatch: readFileSync(frozenInputs[role].patch, 'utf8'),
          sha256: sha(difference),
          rationale: inputs[role].reviewRationale,
        }),
      );
    }
    let expected;
    for (const [role, row] of Object.entries(frozenInputs)) {
      const copy = await captureCandidate(source.destination, join(directory, role));
      const recipe = join(copy.destination, 'vendor/rapier-contact');
      writeFileSync(join(recipe, 'contact.patch'), readFileSync(row.patch));
      const meta = { ...provenance, patchSha256: row.patchSha256, version: row.version };
      writeFileSync(join(recipe, 'provenance.json'), JSON.stringify(meta));
      const script = join(recipe, 'build.sh');
      const historicalRecipe = adaptHistoricalNativeRecipe(
        readFileSync(script, 'utf8').replaceAll(provenance.version, row.version),
        role,
        readFileSync(row.patch),
        row,
      );
      writeFileSync(script, historicalRecipe.source);
      report[`${role}RecipeOmissions`] = historicalRecipe.omissions;
      write();
      await runProcess('npm', ['ci', '--prefer-offline'], {
        cwd: copy.destination,
        timeoutMs: 300000,
      });
      const builds = [];
      for (let i = 0; i < (role === 'candidate' ? 2 : 1); i++) {
        const build = join(directory, `${role}-build-${i}`);
        await runProcess('bash', ['vendor/rapier-contact/build.sh'], {
          cwd: copy.destination,
          timeoutMs: 1800000,
          env: { ...process.env, RAPIER_BUILD_DIR: build },
          inheritOutput: true,
        });
        const archives = readdirSync(build).filter((x) => x.endsWith('.tgz') && x !== 'source.tgz');
        if (archives.length !== 1) throw Error('Expected one rebuilt package');
        const archive = join(build, archives[0]),
          built = {
            package: sha(readFileSync(archive)),
            wasm: sha(readFileSync(join(build, 'wasm/rapier_wasm3d_bg.wasm'))),
            archive,
          };
        if (built.package !== row.packageSha256)
          throw Error(`Built package does not match reviewed input: ${role}`);
        if (role === 'candidate' && built.wasm !== provenance.wasmSha256)
          throw Error('Candidate WASM differs');
        builds.push(built);
        report[`${role}Builds`] = builds;
        write();
      }
      // Execute the just-built package, never a repository-installed substitute.
      await runProcess(
        'npm',
        ['install', '--ignore-scripts', '--no-save', '--package-lock=false', builds[0].archive],
        { cwd: copy.destination, timeoutMs: 300000 },
      );
      const world = join(copy.destination, 'src/simulation/physics/world.mjs'),
        original = readFileSync(world, 'utf8'),
        adapted = adaptNativePhysicalProbe(original, provenance.version, row.version);
      writeFileSync(world, adapted);
      report[`${role}Adapter`] = {
        kind: 'physical-equivalence-with-diagnostics-unavailable',
        originalSha256: sha(original),
        adaptedSha256: sha(adapted),
      };
      const executedSource = candidateIdentity(copy.destination);
      report[`${role}Source`] = executedSource;
      write();
      const output = join(directory, `${role}.json`);
      let ok = true;
      try {
        await runProcess(
          process.execPath,
          ['scripts/native-state-probe.mjs', output, ...(expected ? [expected] : [])],
          { cwd: copy.destination, timeoutMs: 300000 },
        );
      } catch (error) {
        ok = false;
        report.comparisons[role] = { ok, error: error.message };
      }
      if (!(await candidateMatchesOrigin(copy.destination, executedSource)))
        throw Error('Native variant changed during probe');
      let result;
      try {
        result = JSON.parse(readFileSync(output));
      } catch {}
      report.comparisons[role] = {
        ...report.comparisons[role],
        ok,
        failureKind: result?.failureKind,
      };
      write();
      if (['baseline', 'candidate'].includes(role)) assertNativeTrace(result);
      if (role === 'candidate' && JSON.stringify(result) !== readFileSync(expected, 'utf8')) {
        if (JSON.stringify(result) !== JSON.stringify(JSON.parse(readFileSync(expected, 'utf8'))))
          throw Error('Incomplete or unequal candidate comparison');
      }
      if (role === 'baseline') {
        if (!ok || !Array.isArray(result) || result.length !== 6)
          throw Error('Incomplete native baseline');
        expected = output;
      }
    }
    assertNativeComparison(report.comparisons);
    if (!(await candidateMatchesOrigin(source.destination, source)))
      throw Error('Frozen native source changed');
    report.reproducibility = 'PASS';
    report.status = 'passed';
    return report;
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
  } finally {
    write();
    console.log(`Native qualification report: ${join(directory, 'report.json')}`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw Error('Usage: native:qualify -- <private-inputs.json>');
  await qualifyNative(JSON.parse(readFileSync(process.argv[2])));
}
