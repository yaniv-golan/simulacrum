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

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
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
if(process.argv.includes('ci'))mkdirSync('node_modules',{recursive:true});
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

import { identityFiles } from '../scripts/candidate.mjs';
import { dependencyDigest } from '../scripts/candidate-resume.mjs';

// A release records the identity a later merge citation compares: per-path shas and modes, the
// installed-dependency digest the final actually ran on, and the prepare process identity.
test('frozen preparation records the candidate identity and the dependency digest its final ran on', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'release-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const node = process.execPath;
  writeFileSync(
    join(bin, 'npm'),
    `#!${node}\nimport{appendFileSync,mkdirSync,writeFileSync}from'node:fs';
import { sourceIdentity } from ${JSON.stringify(new URL('../scripts/source-identity.mjs', import.meta.url).href)};
appendFileSync(process.env.CALL_LOG,JSON.stringify({args:process.argv.slice(2),vite:process.env.SIMULACRUM_VITE_CACHE_DIR??null,miniflare:process.env.MINIFLARE_CACHE_DIR??null})+'\\n');
if(process.argv.includes('ci')){mkdirSync('node_modules/dep',{recursive:true});writeFileSync('node_modules/dep/index.js','module.exports=1');}
if(process.argv.includes('verify:final')){
 if(process.env.MUTATE_DEPS)writeFileSync('node_modules/dep/extra.js','mutated by the tier');
 mkdirSync('artifacts',{recursive:true});mkdirSync('dist',{recursive:true});
 writeFileSync('dist/index.html','<meta name="build-id" content="test-build">');
 writeFileSync('artifacts/verification-final.json',JSON.stringify({source:sourceIdentity(),build:'test-build',runtime:process.version,outcome:{automation:{status:'PASS',failures:[]},humanAcceptance:{status:'PENDING',bars:[{id:'F1',human:true,state:'RED',assessment:'pending'}]}},checks:[{id:'fixture',ok:true,configuration:{},elapsedMs:1}],results:[{id:'ci',ok:true},{id:'browser',ok:true},{id:'gate',ok:false,result:{failed:0,unmet:0,dueBarCount:1,bars:[{id:'F1',human:true,state:'RED',assessment:'pending'}]}}]}));
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
  const repo = join(root, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  writeFileSync(join(repo, 'input.txt'), 'source');
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
  writeFileSync(join(repo, 'input.txt'), 'dirty source');
  writeFileSync(join(repo, 'new.txt'), 'untracked input');
  const invoke = (env = {}) => {
    const log = join(root, `${Object.keys(env).join('-') || 'plain'}.log`);
    rmSync(join(repo, '.release-private'), { recursive: true, force: true });
    execFileSync(
      node,
      [
        '--input-type=module',
        '-e',
        `import {prepareRelease} from ${JSON.stringify(prepareUrl)};await prepareRelease('.release-private/test');`,
      ],
      {
        cwd: repo,
        env: { ...process.env, PATH: bin + ':' + process.env.PATH, CALL_LOG: log, ...env },
        stdio: 'pipe',
      },
    );
    return readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  };
  const calls = invoke();
  const sourceJson = JSON.parse(
    readFileSync(join(repo, '.release-private/test/source.json'), 'utf8'),
  );
  assert.deepEqual(
    sourceJson.files,
    identityFiles(repo),
    'files map is the candidate identity shape',
  );
  assert.equal(sourceJson.files['new.txt'].sha256, sourceJson.source['new.txt']);
  assert.equal(typeof sourceJson.files['input.txt'].mode, 'number');
  assert.equal('index' in sourceJson, false);
  // The digest is the one a candidate computes: same scratch directories, same tree.
  const expected = join(root, 'expected');
  mkdirSync(join(expected, 'node_modules/dep'), { recursive: true });
  writeFileSync(join(expected, 'node_modules/dep/index.js'), 'module.exports=1');
  for (const path of ['.vite-temp', '.cache/prettier'])
    mkdirSync(join(expected, 'node_modules', path), { recursive: true });
  assert.equal(sourceJson.installed, dependencyDigest(expected));
  assert.match(sourceJson.installedAt, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(
    sourceJson.identity,
    { runtime: process.version, platform: process.platform, arch: process.arch },
    'prepare runtime identity is recorded',
  );
  const tier = calls.find((c) => c.args.includes('verify:final'));
  const out = join(realpathSync(repo), '.release-private/test');
  assert.equal(tier.vite, join(out, 'cache', 'vite'), 'vite cache redirected under the release');
  assert.equal(tier.miniflare, join(out, 'cache', 'miniflare'), 'miniflare cache redirected');
  const release = JSON.parse(
    readFileSync(join(repo, '.release-private/test/release.json'), 'utf8'),
  );
  assert.equal(release.verification.installed, sourceJson.installed, 'envelope binds the digest');
  assert.ok(release.verificationHash, 'the digest is inside the hashed envelope');
  // Dependencies mutated by the tier are a refusal: the recorded digest must be what ran.
  assert.throws(() => invoke({ MUTATE_DEPS: '1' }), /installed dependencies changed/);
  assert.equal(existsSync(join(repo, '.release-private/test/release.json')), false);
});
