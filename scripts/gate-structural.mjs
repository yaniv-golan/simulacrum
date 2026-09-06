// Every structural check runs in a killable process; a blocked child cannot
// prevent the parent deadline firing. Future checks remain explicitly deferred.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runModuleCheck } from './run-check.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url),'utf8'));
const implementations={layers:{module:'scripts/module-graph.mjs',export:'checkLayers'}};
export async function runStructuralChecks(target=manifest.milestone) {
 const cutoff=manifest.milestones.indexOf(target);if(cutoff<0)throw new Error(`unknown milestone: ${target}`);
 const due=manifest.checks.filter(check=>{if(!manifest.milestones.includes(check.dueAt))throw new Error(`invalid dueAt for ${check.id}`);return manifest.milestones.indexOf(check.dueAt)<=cutoff;});
 let failed=0;
 for(const check of due){
  const implementation=check.module?check:implementations[check.id];
  if(!implementation){failed++;console.error(`STUB  gate:${check.id} -- not written; due ${check.dueAt}`);continue;}
  try{await runModuleCheck(resolve(root,implementation.module),implementation.export??'check',check.args??[root,{physicsPackages:manifest.physicsPackages??[]}],{cwd:root,timeoutMs:check.timeoutMs??5000});console.log(`ok    gate:${check.id}`);}
  catch(error){failed++;console.error(`FAIL  gate:${check.id}: ${error.message}`);}
 }
 for(const check of manifest.checks.filter(check=>!due.includes(check)))console.log(`--    gate:${check.id} deferred to ${check.dueAt}`);
 return {failed,ran:due.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const start=performance.now();const target=process.argv[2]??manifest.milestone;const {failed,ran}=await runStructuralChecks(target);
 console.log(`structural gate ${failed?'REFUSED':'green'} at ${target}: ${ran} checks, ${(performance.now()-start).toFixed(1)} ms`);process.exitCode=failed?1:0;
}
