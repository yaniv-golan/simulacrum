import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const fixture = mkdtempSync('/tmp/adversarial-cleanup-');
globalThis.cleanupMustFail = false;
globalThis.childMustFail = false;
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
    if (url === 'mock:vite')
      source = `export async function build(){};export async function preview(){return {httpServer:{address:()=>({port:1234}),close:cb=>cb()}}};export async function createServer(){return{httpServer:{listening:true,address:()=>({port:1235})},async close(){if(globalThis.cleanupMustFail)throw Error('injected probe cleanup failure')}}}`;
    if (url === `file://${repo}/scripts/source-identity.mjs`)
      source = `export function sourceIdentity(){return{head:'fixture',workingTreeDigest:'fixture'}}`;
    if (url === `file://${repo}/scripts/app-fingerprint.mjs`)
      source = `export function appFingerprint(){return'fixture'}`;
    if (url === `file://${repo}/scripts/run-check.mjs`)
      source = `export async function runProcess(){if(globalThis.childMustFail)throw Error('injected child failure');return{elapsedMs:1,output:'child passed'}};export async function runModuleCheck(){}`;
    if (source) return { format: 'module', source, shortCircuit: true };
    return next(url, context);
  },
});
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
process.chdir(repo);
rmSync(fixture, { recursive: true, force: true });
