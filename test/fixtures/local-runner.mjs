// Runs the real verify-local.mjs against a throwaway git repository with the selection owners
// stubbed: the fresh policy selects foo+bar when src/foo.mjs changed and nothing for docs; the
// context carries a diagnosed retry's selection as the attempt ledger would.
// argument: plain | retry-delta | retry-uncovered | retry-required
import { registerHooks } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const root = mkdtempSync('/tmp/local-runner-');
const scenario = process.argv[2];
const selections = {
  plain: null,
  'retry-delta': { changedFiles: ['docs/x.md'], required: [], covered: ['bar'] },
  'retry-uncovered': { changedFiles: ['docs/x.md'], required: [], covered: [] },
  'retry-required': { changedFiles: null, required: ['baz'], covered: [] },
};
const replacements = {
  'verification-run.mjs': `export function initializeVerificationEnvironment(){} export function createVerificationContext(){return {identity:{source:{head:'h',workingTreeDigest:'d'}},check:async(id,c,fn)=>fn(),receipts:()=>[],selection:${JSON.stringify(selections[scenario])}}}`,
  'ci.mjs': `export async function runCI(){return {ok:true}}`,
  'browser-selection.mjs': `export function affectedBrowserChecks(files){const runtime=files.includes('src/foo.mjs');return {source:{head:'h',workingTreeDigest:'d'},files,scope:runtime?'local-contract':'documentation',checks:runtime?[{id:'foo'},{id:'bar'}]:[],reasons:runtime?[{id:'foo',reason:'import'},{id:'bar',reason:'import'}]:[]}} export const unauditedLine=()=>'';`,
  // baz is a timing budget: a retry that requires it makes the tier reach a timing phase.
  'browser-registry.mjs': `export function browserChecks(){return [{id:'foo'},{id:'bar'},{id:'baz',timingSensitive:true}]}`,
  'verify-browser-suite.mjs': `export async function verifyBrowserSuite(ids){console.log('SUITE '+JSON.stringify(ids));return []}`,
  // The launch admission never reads the live host from a unit fixture.
  'check-sequence.mjs': `export async function admitQuietHost({policy}){return {admitted:true,load1:1,waitedMs:0,samples:[1],trend:null,pressure:null,policy}};export function pressureHolds(){return null};export const PRESSURE_POLICY={mode:'observe',idleBound:80,foreignBound:40}`,
  'host-pressure.mjs': `export async function samplePressure(){return {method:'fixture',idlePercent:99,foreign:[]}}`,
};
registerHooks({
  load(url, ctx, next) {
    const key = url.replace(`file://${repo}/scripts/`, '');
    return replacements[key]
      ? { format: 'module', source: replacements[key], shortCircuit: true }
      : next(url, ctx);
  },
});
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
mkdirSync(join(root, 'src'), { recursive: true });
writeFileSync(join(root, 'src/foo.mjs'), 'export const foo = 1;\n');
git('init', '-q');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'src/foo.mjs');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base');
writeFileSync(join(root, 'src/foo.mjs'), 'export const foo = 2;\n');
process.chdir(root);
process.argv = [process.execPath, `${repo}/scripts/verify-local.mjs`, '--base', 'HEAD'];
try {
  await import('../../scripts/verify-local.mjs');
  console.log(
    'REPORT ' + readFileSync('artifacts/verification-local.json', 'utf8').replace(/\n/g, ''),
  );
} finally {
  process.chdir(repo);
  rmSync(root, { recursive: true, force: true });
}
