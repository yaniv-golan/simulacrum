import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const fixture = mkdtempSync('/tmp/adversarial-cleanup-');
globalThis.fixtureArtifact = (options) => {
  const path = options.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT + '/witness.json';
  writeFileSync(path, JSON.stringify({ childFailed: globalThis.childMustFail }));
  if (globalThis.childMustFail) {
    // A browser session writes its status sidecar under a session-named directory.
    const session = options.env.SIMULACRUM_BROWSER_ARTIFACT_ROOT + '/browser-evidence/fixture';
    mkdirSync(session, { recursive: true });
    writeFileSync(session + '/failure-status.json', JSON.stringify(['Not placed · fixture']));
  }
  return path;
};
globalThis.cleanupMustFail = false;
globalThis.childMustFail = false;
globalThis.executionOrder = [];
globalThis.liveRuns = [];
globalThis.fixtureRead = () => JSON.parse(readFileSync('artifacts/browser-suite/selected.json'));
globalThis.fixtureManifest = JSON.parse(readFileSync(repo + '/scripts/manifest.json'));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'vite') return { url: 'mock:vite', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    let source;
    if (url === `file://${repo}/scripts/validate-manifest.mjs`)
      source = `export function readManifest(){return globalThis.fixtureManifest};export function validateManifest(m){return m}`;
    if (url === `file://${repo}/scripts/verification-timing.mjs`)
      source = readFileSync(new URL(url), 'utf8').replace(
        'publish();',
        `if (globalThis.timingMustFail && rows.some(r => r.name === 'server-start' && r.status === 'passed')) throw Error('injected timing publication failure'); publish();`,
      );
    if (url === 'mock:vite')
      source = `export async function build(){};export async function preview(){return {httpServer:{address:()=>({port:1234}),close:cb=>{globalThis.serverCloses=(globalThis.serverCloses??0)+1;cb(globalThis.serverCleanupMustFail?Error('injected server cleanup failure'):undefined)}}}};export async function createServer(){return{httpServer:{listening:true,address:()=>({port:1235})},async close(){if(globalThis.cleanupMustFail)throw Error('injected probe cleanup failure')}}}`;
    if (url === `file://${repo}/scripts/source-identity.mjs`)
      source = `export function sourceIdentity(){return{head:'fixture',workingTreeDigest:'fixture'}}`;
    if (url === `file://${repo}/scripts/module-graph.mjs`)
      source = `export function buildModuleGraph(){return{errors:[],nodes:new Map()}};export function listProjectFiles(){return[]}`;
    if (url === `file://${repo}/scripts/app-fingerprint.mjs`)
      source = `export function appFingerprint(){return'fixture'}`;
    if (url === `file://${repo}/scripts/run-check.mjs`)
      source = `export async function runProcess(binary,args,options){const artifact=globalThis.fixtureArtifact(options);globalThis.executionOrder.push(args[0]);globalThis.liveRuns.push(globalThis.fixtureRead().runs);if(args[0]===globalThis.failScript)throw Error('deliberate priority failure');if(globalThis.childMustFail)throw Object.assign(Error('injected child failure'),{failureKind:'watchdog',processDiagnostics:{snapshot:{at:'watchdog',topCpu:[],topRss:[],watch:[],tree:[]}}});return{elapsedMs:1,output:'child passed '+artifact}};export async function runModuleCheck(){}`;
    if (source) return { format: 'module', source, shortCircuit: true };
    return next(url, context);
  },
});
// A candidate exports its install time to the tier; pin one here so the fixture is
// deterministic whether it runs directly or inside a candidate.
process.env.SIMULACRUM_CANDIDATE_INSTALLED_AT = new Date(Date.now() - 60000).toISOString();
const { verifyBrowserSuite } = await import('../../scripts/verify-browser-suite.mjs');
const { createVerificationRun } = await import('../../scripts/verification-run.mjs');
process.chdir(fixture);
for (const [fail, childFail] of [
  [false, false],
  [true, false],
  [true, true],
]) {
  globalThis.childMustFail = childFail;
  globalThis.cleanupMustFail = fail;
  const run = createVerificationRun({ readIdentity: () => ({ source: 'fixture' }) });
  const context = {
    ...run,
    check(id, configuration, fn) {
      return run.check(
        id,
        configuration,
        id === 'build:browser'
          ? async () => ({
              source: { head: 'fixture', workingTreeDigest: 'fixture' },
              app: 'fixture',
            })
          : fn,
      );
    },
  };
  try {
    await verifyBrowserSuite(['verify-browser'], { context });
  } catch (e) {
    console.log(
      'caught',
      e.message,
      'nested:',
      e.errors?.map((x) => x.message),
    );
  }
  console.log(
    'RESULT ' +
      JSON.stringify({
        fail,
        childFail,
        report: JSON.parse(readFileSync('artifacts/browser-suite/selected.json')),
        receipts: run.receipts(),
      }),
  );
}
// Exercise the actual suite entrypoint: selector remains canonical, execution changes.
globalThis.childMustFail = false;
globalThis.cleanupMustFail = false;
const selected = globalThis.fixtureManifest.browserChecks.slice(0, 2);
// Graph discovery normally reads this checkout; fixture retains script identity as a direct association.
for (const [priorityFiles, selection] of [
  [[], null],
  [[selected[1].script], null],
  [
    [],
    {
      files: [selected[1].script],
      checks: selected,
      source: { head: 'fixture', workingTreeDigest: 'fixture' },
    },
  ],
]) {
  writeFileSync('artifacts/browser-suite/last-run.json', JSON.stringify({ runs: [] }));
  writeFileSync('artifacts/browser-suite/scheduling-history.json', JSON.stringify({ runs: [] }));
  globalThis.executionOrder = [];
  globalThis.liveRuns = [];
  globalThis.failScript = selected[1].script;
  const context = {
    async check(id, config, fn) {
      return id === 'build:browser'
        ? { source: { head: 'fixture', workingTreeDigest: 'fixture' }, app: 'fixture' }
        : fn();
    },
  };
  try {
    await verifyBrowserSuite(
      selected.map((c) => c.id),
      { context, priorityFiles, selection, workers: 1 },
    );
  } catch {}
  console.log(
    'PRIORITY ' +
      JSON.stringify({
        order: globalThis.executionOrder,
        liveRuns: globalThis.liveRuns,
        selected: selected.map((c) => c.script),
        report: JSON.parse(readFileSync('artifacts/browser-suite/selected.json')),
      }),
  );
}

// Both fulfilled and rejected invocation receipts must retain their original evidence.
for (const [childFailed, cleanupFailed] of [
  [false, false],
  [true, false],
  [false, true],
]) {
  globalThis.childMustFail = childFailed;
  globalThis.cleanupMustFail = cleanupFailed;
  globalThis.failScript = undefined;
  globalThis.executionOrder = [];
  const run = createVerificationRun({ readIdentity: () => ({ source: 'reuse-fixture' }) });
  const context = {
    ...run,
    check(id, configuration, execute) {
      return run.check(
        id,
        configuration,
        id === 'build:browser'
          ? async () => ({
              source: { head: 'fixture', workingTreeDigest: 'fixture' },
              app: 'fixture',
            })
          : execute,
      );
    },
  };
  const reports = [];
  let originalBytes, originalLog;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await verifyBrowserSuite(['verify-browser'], { context });
    } catch {}
    const report = globalThis.fixtureRead();
    reports.push(report);
    if (attempt === 0) {
      originalBytes = readFileSync(report.runs[0].evidenceDirectory + '/witness.json', 'utf8');
      originalLog = readFileSync(report.runs[0].log, 'utf8');
    }
  }
  console.log(
    'REUSE_EVIDENCE ' +
      JSON.stringify({
        childFailed,
        cleanupFailed,
        executions: globalThis.executionOrder.length,
        reports,
        originalBytes,
        retainedBytes: readFileSync(reports[0].runs[0].evidenceDirectory + '/witness.json', 'utf8'),
        originalLog,
        retainedLog: readFileSync(reports[0].runs[0].log, 'utf8'),
        retainedReport: JSON.parse(readFileSync(reports[0].reportPath, 'utf8')),
      }),
  );
}

for (const timingFailure of [false, true]) {
  globalThis.childMustFail = false;
  globalThis.cleanupMustFail = false;
  globalThis.serverCloses = 0;
  globalThis.timingMustFail = timingFailure;
  globalThis.serverCleanupMustFail = timingFailure;
  const context = {
    async check(id, config, fn) {
      return id === 'build:browser'
        ? { source: { head: 'fixture', workingTreeDigest: 'fixture' }, app: 'fixture' }
        : fn();
    },
  };
  try {
    await verifyBrowserSuite(['verify-browser'], { context });
  } catch {}
  console.log(
    'TIMING_CLEANUP ' +
      JSON.stringify({
        timingFailure,
        closes: globalThis.serverCloses,
        report: globalThis.fixtureRead(),
      }),
  );
}
globalThis.timingMustFail = false;
globalThis.serverCleanupMustFail = false;
globalThis.failScript = undefined;
delete process.env.SIMULACRUM_LEAF_LEDGER;
mkdirSync('dist', { recursive: true });
writeFileSync(
  'dist/.verification-source.json',
  JSON.stringify({ source: { head: 'fixture', workingTreeDigest: 'fixture' }, app: 'fixture' }),
);
for (const options of [{ workers: 4 }, { workers: 4, context: {} }]) {
  try {
    await verifyBrowserSuite(['verify-browser'], { ...options, reuseBuild: true });
  } catch {}
  console.log('WORKERS ' + JSON.stringify(globalThis.fixtureRead()));
}
process.chdir(repo);
rmSync(fixture, { recursive: true, force: true });
