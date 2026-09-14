import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const root = mkdtempSync('/tmp/merge-runner-');
const behavior = process.argv[2];
const replacements = {
  'verification-run.mjs': `export function createVerificationContext(){return {identity:{source:{head:'h',workingTreeDigest:'d'}},check:async(id,c,fn)=>fn(),receipts:()=>[]}}`,
  'ci.mjs': `export async function runCI(){return {ok:${behavior !== 'ci-fail'}}}`,
  'browser-selection.mjs': `export function affectedBrowserChecks(){return {checks:[]}}`,
  'browser-registry.mjs': `export function browserChecks(){return []}`,
  // The launch admission never reads the live host from a unit fixture.
  'check-sequence.mjs': `export async function admitQuietHost(){return {admitted:true,load1:1,waitedMs:0,samples:[1],trend:null,pressure:null}};export function pressureHolds(){return null};export const PRESSURE_POLICY={mode:'observe',idleBound:80,foreignBound:40}`,
  'host-pressure.mjs': `export async function samplePressure(){return {method:'fixture',idlePercent:99,foreign:[]}}`,
  'merge-selection.mjs': `export function mergeChanges(){return {refs:{base:'h'},files:['README.md']}};export function mergeSelection(){return {checks:[{id:'smoke'}]}}`,
  'verify-browser-suite.mjs': `export async function verifyBrowserSuite(ids,{selection}){if(JSON.stringify(selection.source)!==JSON.stringify({head:'h',workingTreeDigest:'d'}))throw Error('browser selection does not match current source');${behavior === 'browser-fail' ? "throw Error('deliberate browser failure')" : 'return []'}}`,
};
registerHooks({
  load(url, ctx, next) {
    const key = url.replace(`file://${repo}/scripts/`, '');
    return replacements[key]
      ? { format: 'module', source: replacements[key], shortCircuit: true }
      : next(url, ctx);
  },
});
process.chdir(root);
process.argv = [process.execPath, `${repo}/scripts/verify-merge.mjs`, '--base', 'HEAD'];
try {
  await import('../../scripts/verify-merge.mjs');
  console.log(
    'REPORT ' + readFileSync('artifacts/verification-merge.json', 'utf8').replace(/\n/g, ''),
  );
} finally {
  process.chdir(repo);
  rmSync(root, { recursive: true, force: true });
}
