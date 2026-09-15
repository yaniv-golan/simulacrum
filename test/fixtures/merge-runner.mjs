import { registerHooks } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const root = mkdtempSync('/tmp/merge-runner-');
const behavior = process.argv[2];
const replacements = {
  // retry-required: the context carries a diagnosed retry's selection as the attempt ledger would.
  // retry-required / retry-delta: the context carries a diagnosed retry's selection as the
  // attempt ledger would.
  'verification-run.mjs': `export function createVerificationContext(){return {identity:{source:{head:'h',workingTreeDigest:'d'}},check:async(id,c,fn)=>fn(),receipts:()=>[],selection:${
    behavior === 'retry-required'
      ? "{changedFiles:null,required:['mirror'],covered:[]}"
      : behavior === 'retry-delta'
        ? "{changedFiles:['docs/x.md'],required:[],covered:['bar']}"
        : 'null'
  }}}`,
  'ci.mjs': `export async function runCI(){return {ok:${behavior !== 'ci-fail'}}}`,
  'browser-selection.mjs': `export function affectedBrowserChecks(){return {checks:[]}} export const unauditedLine=()=>'';`,
  // mirror is a timing budget: a retry that requires it makes the tier reach a timing phase.
  'browser-registry.mjs': `export function browserChecks(){return [{id:'smoke',mergeSmoke:true},{id:'foo'},{id:'bar'},{id:'mirror',timingSensitive:true}]}`,
  // The fresh scope (src/foo.mjs changed) selects foo and bar beside the smoke row; a docs-only
  // byte delta selects the smoke row alone.
  // reach-drift: the selection the launch admission read reaches nothing timed; the one the
  // selection phase computes does (mirror joins on the second call) — the phase must refuse.
  'merge-selection.mjs': `let calls=0;export function mergeChanges(o){return {refs:{base:'h'},files:o.changedFiles??['README.md','src/foo.mjs'],...(o.changedFiles?{filesProvenance:'candidate delta'}:{})}};export function mergeSelection({files}){const runtime=files.includes('src/foo.mjs');const drift=${behavior === 'reach-drift'}&&++calls>1;const ids=runtime?(drift?['smoke','foo','bar','mirror']:['smoke','foo','bar']):['smoke'];return {scope:runtime?'local-contract':'documentation',checks:ids.map(id=>({id,...(id==='mirror'?{timingSensitive:true}:{})})),selected:ids.map(id=>({id,reason:id==='smoke'?'registered merge smoke':'existing audited affected selection'})),omitted:['foo','bar','mirror'].filter(id=>!ids.includes(id)).map(id=>({id,reason:'outside audited selection and registered merge smoke',coverage:'NOT_EXECUTED'}))}}`,
  // The launch admission never reads the live host from a unit fixture.
  // The policy it was called with is echoed so a test can see which bounds the launch applied.
  'check-sequence.mjs': `export async function admitQuietHost({policy}){return {admitted:true,load1:1,waitedMs:0,samples:[1],trend:null,pressure:null,policy}};export function pressureHolds(){return null};export const PRESSURE_POLICY={mode:'observe',idleBound:80,foreignBound:40}`,
  'host-pressure.mjs': `export async function samplePressure(){return {method:'fixture',idlePercent:99,foreign:[]}}`,
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
