import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareIdentity,
  describeDifference,
  readRelease,
  citeRelease,
  resolveCitation,
  packageRefusal,
  pendingOn,
  parseCiteArgs,
  citationVerification,
  exitCodeFor,
  PENDING_EXIT_CODE,
  CITATION_BASIS,
} from '../scripts/candidate-cite.mjs';
import { sha, sourceRecord, finalReport, packageRecord } from './fixtures/release-record.mjs';
import { verificationHash } from '../scripts/playtest/package-verification.mjs';

const head = 'a'.repeat(40);
const files = {
  'src/a.mjs': { sha256: '1'.repeat(64), mode: 0o644 },
  'scripts/b.mjs': { sha256: '2'.repeat(64), mode: 0o755 },
};
const installed = 'i'.repeat(64);
const candidate = { head, index: '100644 … src/a.mjs', files };
const source = sourceRecord({ head, files, installed });
const passedFinal = finalReport({ head });
const pkg = packageRecord({ source, final: passedFinal });
// An in-memory release directory: source.json always, the final and the package as stated.
const releaseOf = ({ source, final = null, pkg = null, directory = '/rel/r3' } = {}) => {
  const tree = { [`${directory}/source.json`]: JSON.stringify(source) };
  if (final) tree[`${directory}/source/artifacts/verification-final.json`] = JSON.stringify(final);
  if (pkg) tree[`${directory}/release.json`] = JSON.stringify(pkg);
  return readRelease(directory, {
    read: (path) => {
      if (!(path in tree)) throw Error(`ENOENT ${path}`);
      return tree[path];
    },
    exists: (path) => path in tree,
  });
};
const complete = () => releaseOf({ source, final: passedFinal, pkg });

test('compareIdentity names every differing path, the head and the installed digest; index and deleted entries never count', () => {
  assert.deepEqual(compareIdentity({ head, files, installed }, { head, files, installed }), {
    same: true,
    differing: { head: false, files: [], installed: false },
  });
  // A staged-but-identical tree (different index) is the same bytes.
  assert.equal(
    compareIdentity({ head, index: 'x', files, installed }, { head, index: 'y', files, installed })
      .same,
    true,
  );
  // A deleted tracked file on either side equals its absence on the other.
  assert.equal(
    compareIdentity(
      { head, files: { ...files, 'gone.md': { deleted: true } }, installed },
      { head, files, installed },
    ).same,
    true,
  );
  // One byte in one file: that path, by name.
  const edited = compareIdentity(
    { head, files: { ...files, 'src/a.mjs': { sha256: '3'.repeat(64), mode: 0o644 } }, installed },
    { head, files, installed },
  );
  assert.deepEqual(edited, {
    same: false,
    differing: { head: false, files: ['src/a.mjs'], installed: false },
  });
  assert.equal(describeDifference(edited), '1 path(s): src/a.mjs');
  // A mode change alone differs; an extra path on either side differs.
  assert.deepEqual(
    compareIdentity(
      {
        head,
        files: { ...files, 'scripts/b.mjs': { sha256: '2'.repeat(64), mode: 0o644 } },
        installed,
      },
      { head, files, installed },
    ).differing.files,
    ['scripts/b.mjs'],
  );
  assert.deepEqual(
    compareIdentity(
      { head, files, installed },
      { head, files: { ...files, 'new.mjs': files['src/a.mjs'] }, installed },
    ).differing.files,
    ['new.mjs'],
  );
  // Plausible wrong: the parent commit with the same dependencies and one file differing.
  const parent = compareIdentity(
    {
      head: 'b'.repeat(40),
      files: { ...files, 'src/a.mjs': { sha256: '9'.repeat(64), mode: 0o644 } },
      installed,
    },
    { head, files, installed },
  );
  assert.deepEqual(parent.differing, { head: true, files: ['src/a.mjs'], installed: false });
  assert.equal(describeDifference(parent), 'head; 1 path(s): src/a.mjs');
  // Plausible wrong: identical files under another head (an amended commit) still differ.
  assert.deepEqual(
    compareIdentity({ head: 'b'.repeat(40), files, installed }, { head, files, installed })
      .differing,
    { head: true, files: [], installed: false },
  );
  // Same package-lock, different node_modules: the digest differs and nothing else.
  const deps = compareIdentity(
    { head, files, installed: 'j'.repeat(64) },
    { head, files, installed },
  );
  assert.deepEqual(deps.differing, { head: false, files: [], installed: true });
  assert.equal(describeDifference(deps), 'installed dependency digest');
  // A record with no digest at all is a difference, never a match.
  assert.equal(
    compareIdentity({ head, files }, { head, files, installed }).differing.installed,
    true,
  );
});

test('citeRelease: identical bytes, a terminal passed final and a bound package satisfy merge readiness; anything short of that is pending or refused by name', () => {
  const passed = citeRelease({ candidate, installed, release: complete() });
  assert.equal(passed.status, 'passed');
  assert.equal(
    passed.summary,
    `merge readiness of ${head.slice(0, 7)} satisfied by release final /rel/r3, identical tree`,
  );
  assert.deepEqual(passed.mergeReadiness, {
    basis: CITATION_BASIS,
    pending: false,
    satisfiedBy: {
      kind: 'release-final',
      release: '/rel/r3',
      sourceJsonSha256: sha(JSON.stringify(source)),
      verificationFinalSha256: sha(JSON.stringify(passedFinal)),
      packageSha256: sha(JSON.stringify(pkg)),
      head,
      installed,
      environment: {
        runtime: process.version,
        platform: process.platform,
        arch: process.arch,
        environmentDigest: 'e'.repeat(64),
      },
    },
  });
  assert.equal(exitCodeFor(passed.status), 0);
  // Pending on the final: no report yet, or — the real case — the report the final writes from
  // its first phase (status running, automation FAIL until the phases end). Never refused.
  for (const release of [
    releaseOf({ source }),
    releaseOf({ source, final: finalReport({ head, status: 'running' }) }),
  ]) {
    assert.equal(pendingOn(release), 'final');
    const pending = citeRelease({ candidate, installed, release });
    assert.equal(pending.status, 'pending final');
    assert.equal(pending.mergeReadiness.pending, true);
    assert.equal(pending.mergeReadiness.pendingOn, 'final');
    assert.deepEqual(pending.mergeReadiness.satisfiedBy.environment, source.identity);
    assert.equal(
      pending.summary,
      `merge readiness of ${head.slice(0, 7)} pending release final /rel/r3`,
    );
    assert.equal(exitCodeFor(pending.status), PENDING_EXIT_CODE);
  }
  assert.equal(PENDING_EXIT_CODE, 3);
  // Pending on the package: a green final whose release has not been packaged (the release's
  // own post-tier checks — dependency and source drift — have not passed yet).
  const unpackaged = citeRelease({
    candidate,
    installed,
    release: releaseOf({ source, final: passedFinal }),
  });
  assert.equal(unpackaged.status, 'pending final');
  assert.equal(unpackaged.mergeReadiness.pendingOn, 'package');
  assert.equal(
    unpackaged.mergeReadiness.satisfiedBy.verificationFinalSha256,
    sha(JSON.stringify(passedFinal)),
  );
  // Refusals, each naming its cause; none carries a satisfiedBy that could be mistaken for evidence.
  const legacy = citeRelease({
    candidate,
    installed,
    release: releaseOf({ source: { head, source: source.source }, final: passedFinal, pkg }),
  });
  assert.equal(legacy.status, 'refused');
  assert.match(legacy.reason, /records no dependency digest or file inventory; nothing to compare/);
  assert.equal(legacy.mergeReadiness, undefined);
  const digestOnly = citeRelease({
    candidate,
    installed,
    release: releaseOf({
      source: { head, source: source.source, installed },
      final: passedFinal,
      pkg,
    }),
  });
  assert.match(digestOnly.reason, /nothing to compare/);
  const other = citeRelease({
    candidate: {
      ...candidate,
      files: { ...files, 'src/a.mjs': { sha256: '3'.repeat(64), mode: 0o644 } },
    },
    installed,
    release: complete(),
  });
  assert.equal(other.status, 'refused');
  assert.match(other.reason, /prepared from different bytes: 1 path\(s\): src\/a\.mjs$/);
  assert.deepEqual(other.differing.files, ['src/a.mjs']);
  assert.equal(exitCodeFor(other.status), 1);
  const deps = citeRelease({ candidate, installed: 'j'.repeat(64), release: complete() });
  assert.match(deps.reason, /different bytes: installed dependency digest$/);
  // A final whose own head is not the release's head is refused even when it passed.
  const stray = citeRelease({
    candidate,
    installed,
    release: releaseOf({
      source,
      final: { ...passedFinal, source: { head: 'b'.repeat(40) } },
      pkg,
    }),
  });
  assert.equal(stray.status, 'refused');
  assert.match(stray.reason, /reports head b{40} for a release prepared from a{40}/);
  // A red final refuses and says why; the citation block records the failure, never a pass.
  const red = citeRelease({
    candidate,
    installed,
    release: releaseOf({ source, final: finalReport({ head, status: 'failed' }) }),
  });
  assert.equal(red.status, 'refused');
  assert.equal(red.reason, 'release final did not pass: measure-gears p95 2.1 ms');
  assert.equal(red.mergeReadiness.failed, true);
  // A package that does not bind the cited source is refused after the final passed.
  const unbound = citeRelease({
    candidate,
    installed,
    release: releaseOf({ source, final: passedFinal, pkg: { ...pkg, head: 'b'.repeat(40) } }),
  });
  assert.equal(unbound.status, 'refused');
  assert.match(
    unbound.reason,
    /release package refused: Package verification source, build or runtime mismatch/,
  );
});

test('packageRefusal verifies the package envelope, then its binding to the cited source', () => {
  assert.equal(packageRefusal(complete()), null);
  assert.equal(packageRefusal(releaseOf({ source, final: passedFinal })), null);
  const tampered = { ...pkg, verification: { ...pkg.verification, sourceHash: 'f'.repeat(64) } };
  assert.match(
    packageRefusal(releaseOf({ source, final: passedFinal, pkg: tampered })),
    /^release package refused: Package verification integrity/,
  );
  const rehashed = packageRecord({
    source: sourceRecord({ head, files: { ...files, 'x.mjs': files['src/a.mjs'] }, installed }),
    final: passedFinal,
  });
  assert.equal(
    packageRefusal(releaseOf({ source, final: passedFinal, pkg: rehashed })),
    'release package does not match the cited source (head, source hash or installed digest)',
  );
  const otherInstall = packageRecord({ source, final: passedFinal, installed: 'k'.repeat(64) });
  assert.match(
    packageRefusal(releaseOf({ source, final: passedFinal, pkg: otherInstall })),
    /does not match the cited source/,
  );
  // A legacy package without `installed` in its envelope still binds by source hash.
  const legacy = packageRecord({ source, final: passedFinal });
  delete legacy.verification.installed;
  legacy.verificationHash = verificationHash(legacy.verification);
  assert.equal(packageRefusal(releaseOf({ source, final: passedFinal, pkg: legacy })), null);
});

test('resolveCitation resolves a pending citation against the same release only, re-verifying bytes and the package', () => {
  const pending = citeRelease({
    candidate,
    installed,
    release: releaseOf({ source, final: finalReport({ head, status: 'running' }) }),
  });
  const done = resolveCitation({
    citation: pending,
    candidate,
    installed,
    release: complete(),
    landed: true,
  });
  assert.equal(done.status, 'passed');
  assert.equal(done.mergeReadiness.pending, false);
  assert.equal(done.mergeReadiness.landed, true);
  assert.equal(
    done.mergeReadiness.satisfiedBy.verificationFinalSha256,
    sha(JSON.stringify(passedFinal)),
  );
  assert.match(done.mergeReadiness.resolvedAt, /^\d{4}-\d{2}-\d{2}T/);
  // The final ended red: the merge report becomes failed, carrying the failure.
  const red = resolveCitation({
    citation: pending,
    candidate,
    installed,
    release: releaseOf({
      source,
      final: finalReport({ head, status: 'failed', failure: 'bar B7 unmet' }),
    }),
  });
  assert.equal(red.status, 'failed');
  assert.equal(red.reason, 'release final did not pass: bar B7 unmet');
  assert.equal(
    red.summary,
    `merge readiness of ${head.slice(0, 7)} failed: release final did not pass: bar B7 unmet`,
  );
  assert.equal(exitCodeFor(red.status), 1);
  // Still running, or green but unpackaged: stays pending, nothing rewritten as failed.
  assert.equal(
    resolveCitation({
      citation: pending,
      candidate,
      installed,
      release: releaseOf({ source, final: finalReport({ head, status: 'running' }) }),
    }).status,
    'pending final',
  );
  const unpackaged = resolveCitation({
    citation: pending,
    candidate,
    installed,
    release: releaseOf({ source, final: passedFinal }),
  });
  assert.equal(unpackaged.status, 'pending final');
  assert.equal(unpackaged.mergeReadiness.pendingOn, 'package');
  // A re-prepared release (source.json bytes moved) is not the cited one.
  const reprepared = resolveCitation({
    citation: pending,
    candidate,
    installed,
    release: releaseOf({
      source: { ...source, installedAt: '2026-09-15T06:00:00.000Z' },
      final: passedFinal,
      pkg,
    }),
  });
  assert.equal(reprepared.status, 'refused');
  assert.match(reprepared.reason, /re-prepared since the citation/);
  // The candidate's bytes cannot have moved either.
  assert.match(
    resolveCitation({
      citation: pending,
      candidate,
      installed: 'j'.repeat(64),
      release: complete(),
    }).reason,
    /installed dependency digest/,
  );
  // A package whose envelope disagrees with the cited source is refused.
  const forged = resolveCitation({
    citation: pending,
    candidate,
    installed,
    release: releaseOf({
      source,
      final: passedFinal,
      pkg: { ...pkg, verification: { ...pkg.verification, sourceHash: 'f'.repeat(64) } },
    }),
  });
  assert.equal(forged.status, 'refused');
  assert.match(forged.reason, /release package refused/);
  // Only a pending release citation can be resolved; `landed` is always recorded (null outside a repository).
  assert.throws(
    () =>
      resolveCitation({
        citation: { status: 'passed', mergeReadiness: pending.mergeReadiness },
        candidate,
        installed,
        release: complete(),
      }),
    /cite-final needs a merge report whose merge readiness is pending a release final/,
  );
  assert.throws(
    () =>
      resolveCitation({
        citation: { status: 'pending final' },
        candidate,
        installed,
        release: complete(),
      }),
    /pending a release final/,
  );
  assert.equal(
    resolveCitation({ citation: pending, candidate, installed, release: complete() }).mergeReadiness
      .landed,
    null,
  );
});

test('parseCiteArgs strips --satisfied-by/--pending for a merge tier only; citationVerification records a run-less tier', () => {
  assert.deepEqual(
    parseCiteArgs([
      'merge',
      '--base',
      'b',
      '--satisfied-by',
      '/rel',
      '--incoming',
      'i',
      '--destination',
      'main',
    ]),
    {
      rest: ['merge', '--base', 'b', '--incoming', 'i', '--destination', 'main'],
      satisfiedBy: '/rel',
      pending: false,
    },
  );
  assert.equal(parseCiteArgs(['merge', '--satisfied-by', '/rel', '--pending']).pending, true);
  assert.deepEqual(parseCiteArgs(['local', '--base', 'b']), {
    rest: ['local', '--base', 'b'],
    satisfiedBy: null,
    pending: false,
  });
  for (const [argv, message] of [
    [['local', '--satisfied-by', '/rel'], /cites a release final as merge evidence only/],
    [['final', '--satisfied-by', '/rel'], /merge evidence only/],
    [['resume', 'r.json', '--satisfied-by', '/rel'], /merge evidence only/],
    [['merge', '--pending'], /--pending needs --satisfied-by/],
    [['merge', '--satisfied-by'], /needs one release directory/],
    [['merge', '--satisfied-by', '--pending'], /needs one release directory/],
    [['merge', '--satisfied-by', '/a', '--satisfied-by', '/b'], /needs one release directory/],
    [['merge', '--satisfied-by', '/rel', '--after', 'p.json'], /cannot be combined with --after/],
  ])
    assert.throws(() => parseCiteArgs(argv), message, argv.join(' '));
  const options = { base: 'b', incoming: 'i', destination: 'd' };
  const passed = citationVerification({
    tier: 'merge',
    citation: citeRelease({ candidate, installed, release: complete() }),
    options,
    source: { head },
  });
  assert.equal(passed.citation, true);
  assert.equal(passed.reusable, false);
  assert.deepEqual(passed.checks, []);
  assert.deepEqual(
    passed.results.map((r) => [r.id, r.status, r.ok]),
    [['citation', 'passed', true]],
  );
  assert.equal(passed.outcome.automation.status, 'PASS');
  assert.equal(passed.outcome.qualification.status, 'NOT_EVALUATED');
  const pending = citationVerification({
    tier: 'merge',
    citation: citeRelease({ candidate, installed, release: releaseOf({ source }) }),
    options,
    source: { head },
  });
  assert.equal(pending.status, 'pending final');
  assert.deepEqual(
    pending.results.map((r) => [r.id, r.status, r.ok]),
    [['citation', 'pending', false]],
  );
  assert.equal(pending.outcome.automation.status, 'PENDING');
  const refused = citationVerification({
    tier: 'merge',
    citation: { status: 'refused', reason: 'x' },
    options,
    source: { head },
  });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.outcome.automation.status, 'FAIL');
  assert.equal(refused.outcome.automation.detail, 'x');
});

test('readRelease pins the bytes it read and reports a directory without source.json', () => {
  const release = complete();
  assert.equal(release.sourceSha256, sha(JSON.stringify(source)));
  assert.equal(release.finalSha256, sha(JSON.stringify(passedFinal)));
  assert.equal(release.packageSha256, sha(JSON.stringify(pkg)));
  assert.equal(releaseOf({ source }).package, null);
  assert.throws(
    () => readRelease('/rel/none', { read: () => '', exists: () => false }),
    /has no source\.json/,
  );
});
