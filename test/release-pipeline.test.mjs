import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { releaseEligible, assertVerificationJobs } from '../scripts/playtest/ci-verification.mjs';
test('release routing preserves independent PR checks and rejects missing required work', () => {
  assert.equal(
    releaseEligible('push', 'main'),
    false,
    'main pushes verify; releases are dispatched',
  );
  for (const event of ['pull_request', 'schedule'])
    assert.equal(releaseEligible(event, 'main'), false);
  assert.equal(releaseEligible('push', 'other'), false);
  assert.equal(releaseEligible('push', 'v2'), false);
  assert.equal(releaseEligible('workflow_dispatch', 'v2'), false);
  assert.equal(releaseEligible('workflow_dispatch', 'main'), true);
  assert.equal(releaseEligible('workflow_dispatch', 'other'), false);
  const release = {
    route: 'success',
    'release-package': 'success',
    automated: 'skipped',
    browser: 'skipped',
  };
  const ordinary = {
    route: 'success',
    'release-package': 'skipped',
    automated: 'success',
    browser: 'success',
  };
  assertVerificationJobs(true, release);
  assertVerificationJobs(false, ordinary);
  for (const status of ['failure', 'cancelled', 'skipped', undefined]) {
    assert.throws(() => assertVerificationJobs(true, { ...release, 'release-package': status }));
    assert.throws(() => assertVerificationJobs(false, { ...ordinary, browser: status }));
    assert.throws(() => assertVerificationJobs(false, { ...ordinary, automated: status }));
  }
  assert.throws(() => assertVerificationJobs(true, { ...release, route: 'failure' }));
  assert.throws(() => assertVerificationJobs('false', ordinary));
});
test('workflow routes once and aggregate is always evaluated before admission', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.match(
    workflow,
    /automated:\n    needs: route\n    if: needs.route.outputs.eligible != 'true'/,
  );
  assert.match(
    workflow,
    /browser:\n    needs: route\n    if: needs.route.outputs.eligible != 'true'/,
  );
  assert.match(
    workflow,
    /release-package:\n    needs: route\n    if: needs.route.outputs.eligible == 'true'/,
  );
  assert.equal((workflow.match(/npm run release:prepare/g) || []).length, 1);
  assert.match(workflow, /verification:\n    if: always\(\)/);
  assert.match(workflow, /staging-admission:\n    needs: \[release-package, verification\]/);
  assert.ok(
    workflow.includes(
      "if: needs.release-package.outputs.eligible == 'true' && vars.DEPLOY_STAGING_ENABLED == 'true'",
    ),
  );
  for (const path of ['.github/workflows/ci.yml', '.github/workflows/deploy-production.yml']) {
    assert.equal(
      (
        readFileSync(path, 'utf8').match(
          /CALIBRATION_BUNDLE_TOKEN: \$\{\{ secrets.CALIBRATION_BUNDLE_TOKEN \}\}/g,
        ) || []
      ).length,
      2,
    );
  }
  const admission = readFileSync('scripts/playtest/ci-release.mjs', 'utf8');
  assert.ok(
    admission.indexOf('await admitGitHubCalibration(config.verification, directory)') <
      admission.indexOf("fetch(new URL('/acquire'"),
  );
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const prepareUrl = new URL('../scripts/playtest/prepare-release.mjs', import.meta.url).href;
test('frozen preparation verifies once, includes format and rejects byte drift', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-prepare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const node = process.execPath;
  writeFileSync(
    join(bin, 'npm'),
    `#!${node}\nimport{appendFileSync,mkdirSync,writeFileSync}from'node:fs';
import { sourceIdentity } from ${JSON.stringify(new URL('../scripts/source-identity.mjs', import.meta.url).href)};
appendFileSync(process.env.CALL_LOG,JSON.stringify(process.argv.slice(2))+'\\n');
if(process.argv.includes('verify:final')){
 mkdirSync('artifacts',{recursive:true});mkdirSync('dist',{recursive:true});
 writeFileSync('dist/index.html','<meta name="build-id" content="test-build">');
 writeFileSync('artifacts/verification-final.json',JSON.stringify({source:sourceIdentity(),build:'test-build',runtime:process.version,outcome:{automation:{status:process.env.FAIL_AUTOMATION?'FAIL':'PASS',failures:[]},humanAcceptance:{status:'PENDING',bars:[{id:'F1',human:true,state:'RED',assessment:'pending'}]}},checks:[{id:'fixture',ok:true,configuration:{},elapsedMs:1}],results:[{id:'ci',ok:true},{id:'browser',ok:true},{id:'gate',ok:false,result:{failed:0,unmet:0,dueBarCount:1,bars:[{id:'F1',human:true,state:'RED',assessment:'pending'}]}}]}));
 if(process.env.FAIL_AUTOMATION)process.exit(1);process.exit(2);
}\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'npx'),
    `#!${node}\nimport{mkdirSync,writeFileSync}from'node:fs';
const out=process.argv[process.argv.indexOf('--outdir')+1];mkdirSync(out,{recursive:true});writeFileSync(out+'/worker.js','export default {}');
if(process.env.DRIFT==='asset')writeFileSync('dist/index.html','wrong');
if(process.env.DRIFT==='source')writeFileSync('input.txt','wrong');
`,
    { mode: 0o755 },
  );
  for (const mode of ['pass', 'asset', 'source', 'failed']) {
    const repo = join(root, mode);
    mkdirSync(repo);
    execFileSync('git', ['init', '--quiet'], { cwd: repo });
    writeFileSync(join(repo, 'input.txt'), 'source');
    writeFileSync(join(repo, '.gitignore'), '.release-private/\nartifacts/\ndist/\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '--quiet',
        '-m',
        'fixture',
      ],
      { cwd: repo },
    );
    // Uncommitted content must be the actual frozen input.
    writeFileSync(join(repo, 'input.txt'), 'dirty source');
    const log = join(root, mode + '.log');
    const invoke = () =>
      execFileSync(
        node,
        [
          '--input-type=module',
          '-e',
          `import {prepareRelease} from ${JSON.stringify(prepareUrl)};await prepareRelease('.release-private/test');`,
        ],
        {
          cwd: repo,
          env: {
            ...process.env,
            PATH: bin + ':' + process.env.PATH,
            CALL_LOG: log,
            DRIFT: mode,
            FAIL_AUTOMATION: mode === 'failed' ? '1' : '',
          },
          stdio: 'pipe',
        },
      );
    if (mode === 'pass') {
      invoke();
      const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(calls, [['ci'], ['run', 'format:check'], ['run', 'verify:final']]);
      const release = JSON.parse(
        readFileSync(join(repo, '.release-private/test/release.json'), 'utf8'),
      );
      assert.equal(release.verification.automation.status, 'PASS');
      assert.equal(release.verification.humanAcceptance.status, 'PENDING');
      // The frozen snapshot is kept out of Spotlight; the marker is not a packaged input.
      assert.ok(existsSync(join(repo, '.release-private/test/.metadata_never_index')));
      assert.equal('.metadata_never_index' in (release.verification.source ?? {}), false);
      assert.equal(
        Object.keys(
          JSON.parse(readFileSync(join(repo, '.release-private/test/source.json'), 'utf8')).source,
        ).includes('.metadata_never_index'),
        false,
      );
      assert.equal(
        readFileSync(join(repo, '.release-private/test/source/input.txt'), 'utf8'),
        'dirty source',
      );
    } else
      assert.throws(
        invoke,
        mode === 'asset'
          ? /Verified assets changed/
          : mode === 'source'
            ? /Frozen source changed/
            : /Command failed/,
      );
  }
});

import { randomUUID, createHash, createHmac } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { attestReport } from '../scripts/candidate-after.mjs';
const canonicalLeaf = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );
const signLeaf = (payload, key) =>
  createHmac('sha256', key).update(canonicalLeaf(payload)).digest('hex');
import { writeResumeDescriptor, dependencyDigest } from '../scripts/candidate-resume.mjs';
import { candidateIdentity } from '../scripts/candidate.mjs';
import { processIdentity } from '../scripts/verification-environment.mjs';

// A release may cite a byte-identical, attested merge candidate's workshop receipts: the
// envelope then names every cited receipt and copies its evidence; anything else refuses.
test('frozen preparation cites an attested byte-identical merge parent and names every reused receipt', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-reuse-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const node = process.execPath;
  const leafId = 'browser:verify-x';
  // The fake tier honours the ledger contract exactly as far as the envelope can see: with a
  // ledger it resumes the offered ids (depth 1, origin = the parent attempt) and executes the
  // rest; without one it executes everything. It logs the env it was given.
  writeFileSync(
    join(bin, 'npm'),
    `#!${node}\nimport{appendFileSync,mkdirSync,writeFileSync,readFileSync}from'node:fs';
import { sourceIdentity } from ${JSON.stringify(new URL('../scripts/source-identity.mjs', import.meta.url).href)};
appendFileSync(process.env.CALL_LOG,JSON.stringify({args:process.argv.slice(2),ledger:process.env.SIMULACRUM_LEAF_LEDGER??null,attempt:process.env.SIMULACRUM_VERIFICATION_ATTEMPT??null})+'\\n');
if(process.argv.includes('ci')){mkdirSync('node_modules/dep',{recursive:true});writeFileSync('node_modules/dep/index.js','module.exports=1');}
if(process.argv.includes('verify:final')){
 mkdirSync('artifacts',{recursive:true});mkdirSync('dist',{recursive:true});
 writeFileSync('dist/index.html','<meta name="build-id" content="test-build">');
 const ledger=process.env.SIMULACRUM_LEAF_LEDGER?JSON.parse(readFileSync(process.env.SIMULACRUM_LEAF_LEDGER,'utf8')):null;
 const offered=new Set(ledger?.reuse??[]);
 const receipt=(id)=>offered.has(id)?{id,ok:true,configuration:{},elapsedMs:0,resumed:true,origin:{attempt:process.env.PARENT_ATTEMPT,report:process.env.PARENT_REPORT,depth:1}}:{id,ok:true,configuration:{},elapsedMs:1};
 const bar={id:'F1',human:true,state:'RED',assessment:'pending'};
 const purged=process.env.PURGED==='1';
 writeFileSync('artifacts/verification-final.json',JSON.stringify({source:sourceIdentity(),build:'test-build',runtime:process.version,outcome:{automation:{status:'PASS',failures:[]},humanAcceptance:{status:'PENDING',bars:[bar]}},checks:[purged?{id:${JSON.stringify(leafId)},ok:true,configuration:{},elapsedMs:1}:receipt(${JSON.stringify(leafId)}),{id:'browser:verify-timing',ok:true,configuration:{},elapsedMs:1},{id:'ci',ok:true,configuration:{},elapsedMs:1}],results:[{id:'ci',ok:true},{id:'browser',ok:true},{id:'gate',ok:false,result:{failed:0,unmet:0,dueBarCount:1,bars:[bar]}}]}));
 process.exit(2);
}\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'npx'),
    `#!${node}\nimport{mkdirSync,writeFileSync}from'node:fs';
const out=process.argv[process.argv.indexOf('--outdir')+1];mkdirSync(out,{recursive:true});writeFileSync(out+'/worker.js','export default {}');\n`,
    { mode: 0o755 },
  );
  const repo = join(realpathSync(root), 'repo');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  writeFileSync(join(repo, 'input.txt'), 'source');
  writeFileSync(
    join(repo, 'scripts/manifest.json'),
    JSON.stringify({
      browserChecks: [
        { id: 'verify-x', tier: 'browser', environment: 'workshop' },
        { id: 'verify-timing', tier: 'browser', environment: 'workshop', timingSensitive: true },
      ],
    }),
  );
  writeFileSync(join(repo, '.gitignore'), '.release-private/\nartifacts/\ndist/\nnode_modules/\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: repo },
  );
  // The parent candidate: signed descriptor, attested report, retained evidence for its leaf.
  const installedRoot = join(root, 'installed');
  mkdirSync(join(installedRoot, 'node_modules/dep'), { recursive: true });
  writeFileSync(join(installedRoot, 'node_modules/dep/index.js'), 'module.exports=1');
  for (const path of ['.vite-temp', '.cache/prettier'])
    mkdirSync(join(installedRoot, 'node_modules', path), { recursive: true });
  const installed = dependencyDigest(installedRoot);
  const parentDirectory = join(root, 'parent');
  const attempt = randomUUID();
  // The parent's identity is the environment the release child is given (see invoke).
  const cleanEnv = { ...process.env };
  for (const name of ['SIMULACRUM_LEAF_LEDGER', 'SIMULACRUM_VERIFICATION_ATTEMPT', 'NODE_OPTIONS'])
    delete cleanEnv[name];
  const key = Buffer.from('11'.repeat(32), 'hex');
  const evidenceDirectory = join(parentDirectory, 'evidence', 'verify-x');
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(join(evidenceDirectory, 'run.log'), 'journey ok');
  // The suite writes the run log beside the evidence directory, not inside it.
  writeFileSync(join(parentDirectory, 'evidence', 'verify-x.log'), 'stdout');
  const checksum = (path, body) => ({
    path,
    sha256: createHash('sha256').update(body).digest('hex'),
    bytes: Buffer.byteLength(body),
  });
  const evidence = [
    { path: evidenceDirectory, directory: true },
    checksum(join(evidenceDirectory, 'run.log'), 'journey ok'),
    checksum(join(parentDirectory, 'evidence', 'verify-x.log'), 'stdout'),
  ];
  const writeParent = (overrides = {}, descriptorOverrides = {}) => {
    rmSync(join(parentDirectory, 'attempts'), { recursive: true, force: true });
    rmSync(join(parentDirectory, 'resume-key'), { force: true });
    mkdirSync(join(parentDirectory, 'attempts', attempt, 'leaves'), { recursive: true });
    writeFileSync(join(parentDirectory, 'resume-key'), key, { mode: 0o600 });
    // The leaf a real ledger writes: payload with the evidence checksums, signed under the key.
    const payload = { id: leafId, value: { code: 0, evidenceChecksums: evidence } };
    writeFileSync(
      join(
        parentDirectory,
        'attempts',
        attempt,
        'leaves',
        createHash('sha256').update(leafId).digest('hex') + '.json',
      ),
      JSON.stringify({ payload, signature: signLeaf(payload, overrides.leafKey ?? key) }),
    );
    writeResumeDescriptor(
      parentDirectory,
      {
        candidate: candidateIdentity(repo),
        options: {},
        tier: 'merge',
        installed,
        installedAt: new Date().toISOString(),
        identity: processIdentity(cleanEnv),
        ...descriptorOverrides,
      },
      key,
    );
    const report = {
      status: 'passed',
      tier: 'merge',
      attempt,
      attemptReport: join(parentDirectory, 'attempts', attempt, 'report.json'),
      directory: parentDirectory,
      originStillMatches: true,
      destinationStillMatches: true,
      verification: {
        attempt,
        status: 'passed',
        elapsedMs: 5,
        results: [
          { id: 'ci', ok: true },
          { id: 'browser', ok: true },
        ],
        checks: [
          { id: leafId, ok: true, configuration: {}, elapsedMs: 1 },
          { id: 'browser:verify-timing', ok: true, configuration: {}, elapsedMs: 1 },
        ],
        outcome: {
          automation: { status: 'PASS' },
          exitCode: 0,
          qualification: { status: 'NOT_EVALUATED' },
        },
      },
      ...overrides,
    };
    report.attestation = overrides.attestation ?? attestReport(report, key);
    writeFileSync(report.attemptReport, JSON.stringify(report));
    return report.attemptReport;
  };
  let lastLog = null;
  const invoke = (after, env = {}) => {
    const log = join(root, `${randomUUID()}.log`);
    lastLog = log;
    rmSync(join(repo, '.release-private'), { recursive: true, force: true });
    const childEnv = {
      ...process.env,
      PATH: bin + ':' + process.env.PATH,
      CALL_LOG: log,
      PARENT_ATTEMPT: attempt,
      PARENT_REPORT: join(parentDirectory, 'attempts', attempt, 'report.json'),
    };
    delete childEnv.SIMULACRUM_LEAF_LEDGER;
    delete childEnv.SIMULACRUM_VERIFICATION_ATTEMPT;
    delete childEnv.NODE_OPTIONS;
    Object.assign(childEnv, env);
    execFileSync(
      node,
      [
        '--input-type=module',
        '-e',
        `import {prepareRelease} from ${JSON.stringify(prepareUrl)};await prepareRelease('.release-private/test', ${JSON.stringify(after ? { after } : {})});`,
      ],
      { cwd: repo, env: childEnv, stdio: 'pipe' },
    );
    return readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  };
  const releaseJson = () =>
    JSON.parse(readFileSync(join(repo, '.release-private/test/release.json'), 'utf8'));

  // Plain run: the tier env carries no ledger even when the shell does.
  const plain = invoke(null, { SIMULACRUM_LEAF_LEDGER: '/nonexistent/ledger.json' });
  assert.deepEqual(plain.find((c) => c.args.includes('verify:final')).ledger, null);
  assert.equal(releaseJson().verification.reuse, undefined);
  assert.equal(releaseJson().verification.status, 'passed');

  // Reuse run.
  const parentReport = writeParent();
  const calls = invoke(parentReport);
  const tier = calls.find((c) => c.args.includes('verify:final'));
  assert.ok(
    tier.ledger?.startsWith(join(repo, '.release-private/test/')),
    'ledger under the release',
  );
  assert.match(tier.attempt, /^[\da-f-]{36}$/);
  const ledger = JSON.parse(readFileSync(tier.ledger, 'utf8'));
  assert.equal(ledger.previousKey, key.toString('hex'));
  assert.equal(ledger.previous, join(parentDirectory, 'attempts', attempt, 'leaves'));
  assert.deepEqual(ledger.reuse, [leafId], 'timing-sensitive row is never offered');
  const release = releaseJson();
  assert.equal(release.verification.status, 'passed with reused receipts');
  const reuse = release.verification.reuse;
  assert.equal(reuse.parentAttempt, attempt);
  assert.equal(reuse.parentTier, 'merge');
  assert.deepEqual(reuse.offered, [leafId]);
  assert.deepEqual(
    reuse.reused.map((r) => r.id),
    [leafId],
  );
  assert.equal(reuse.reused[0].origin.depth, 1);
  assert.deepEqual(reuse.reused[0].evidenceChecksums.map((e) => e.sha256).filter(Boolean), [
    evidence[1].sha256,
    evidence[2].sha256,
  ]);
  assert.equal(
    reuse.reused[0].copiedTo,
    join('artifacts/browser-suite/reused', attempt, 'verify-x'),
  );
  assert.equal(reuse.reused[0].copiedChecksums.length, 2);
  assert.ok(reuse.executed.includes('browser:verify-timing') && reuse.executed.includes('ci'));
  assert.deepEqual(reuse.counts, { offered: 1, reused: 1, executed: 2 });
  const reusedRoot = join(
    repo,
    '.release-private/test/source/artifacts/browser-suite/reused',
    attempt,
  );
  assert.equal(readFileSync(join(reusedRoot, 'verify-x', 'run.log'), 'utf8'), 'journey ok');
  assert.equal(
    readFileSync(join(reusedRoot, 'verify-x.log'), 'utf8'),
    'stdout',
    'run log sibling copied',
  );
  assert.ok(release.verificationHash, 'envelope hash binds the reuse block');

  // Evidence the ledger did not resume (purged) executes: the package is a plain pass that still
  // names what was offered, and every consumer accepts it.
  writeParent();
  invoke(parentReport, { PURGED: '1' });
  const executedAll = releaseJson();
  assert.equal(executedAll.verification.status, 'passed');
  assert.deepEqual(executedAll.verification.reuse.reused, []);
  assert.deepEqual(executedAll.verification.reuse.offered, [leafId]);
  assert.ok(executedAll.verification.reuse.executed.includes(leafId));

  // A parent that itself reused the leaf offers nothing (depth-0 only) and is refused up front.
  const chained = writeParent();
  {
    const value = JSON.parse(readFileSync(chained, 'utf8'));
    delete value.attestation;
    value.status = 'passed with reused receipts';
    value.verification.checks[0].resumed = true;
    value.verification.checks[0].origin = { attempt: randomUUID(), report: '/x', depth: 1 };
    value.attestation = attestReport(value, key);
    writeFileSync(chained, JSON.stringify(value));
  }
  assert.throws(() => invoke(chained), /offers no reusable/);
  // Tampered retained evidence fails the release; a leaf signed under another key is not cited.
  writeParent();
  writeFileSync(join(evidenceDirectory, 'run.log'), 'journey altered');
  assert.throws(() => invoke(parentReport), /altered/);
  writeFileSync(join(evidenceDirectory, 'run.log'), 'journey ok');
  writeParent({ leafKey: Buffer.from('22'.repeat(32), 'hex') });
  assert.throws(() => invoke(parentReport), /signed/);

  // Refusals, each naming its field; nothing falls back to a plain run.
  const refused = (report, pattern, env) => {
    assert.throws(() => invoke(report, env), pattern);
    assert.equal(existsSync(join(repo, '.release-private/test/release.json')), false);
  };
  refused(writeParent({ tier: 'local' }, { tier: 'local' }), /merge/);
  refused(writeParent({ attestation: 'ab'.repeat(32) }), /attest/);
  refused(writeParent({ status: 'failed' }), /passed/);
  refused(writeParent({ verification: undefined }), /receipts|report/);
  const hosted = writeParent();
  {
    const value = JSON.parse(readFileSync(hosted, 'utf8'));
    delete value.attestation;
    value.verification.measurement = true;
    value.attestation = attestReport(value, key);
    writeFileSync(hosted, JSON.stringify(value));
  }
  refused(hosted, /measurement/);
  const hostedRow = writeParent();
  {
    const value = JSON.parse(readFileSync(hostedRow, 'utf8'));
    delete value.attestation;
    value.verification.results[0].result = { hostProfile: 'github-ubuntu-2cpu', measurement: true };
    value.attestation = attestReport(value, key);
    writeFileSync(hostedRow, JSON.stringify(value));
  }
  refused(hostedRow, /hosted-profile|measurement/);
  refused(
    writeParent({}, { candidate: { ...candidateIdentity(repo), head: '0'.repeat(40) } }),
    /HEAD/,
  );
  const before = writeParent();
  writeFileSync(join(repo, 'input.txt'), 'edited after the merge');
  refused(before, /source bytes/);
  writeFileSync(join(repo, 'input.txt'), 'source');
  refused(writeParent({}, { installed: 'f'.repeat(64) }), /dependenc/);
  refused(writeParent(), /environment/, { NODE_OPTIONS: '--max-old-space-size=4096' });
  assert.equal(existsSync(lastLog), false, 'environment refusal happens before npm ci');
  refused(writeParent({ originStillMatches: false }), /origin/);
});
