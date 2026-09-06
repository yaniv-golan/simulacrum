import { execFileSync, spawnSync } from 'node:child_process';
import { buildModuleGraph, affectedTests } from './module-graph.mjs';
const graph=buildModuleGraph();
let changed;
try {changed=[...new Set([...execFileSync('git',['diff','--name-only','HEAD','-z'],{encoding:'utf8'}).split('\0'),...execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0')].filter(Boolean))];}catch{changed=undefined;}
const selected=process.argv.includes('--all')?affectedTests(graph,undefined):affectedTests(graph,changed);
console.log(`unit tests: ${selected.length} selected from module graph${graph.errors.length?' (conservative full fallback)':''}`);
if(selected.length){const result=spawnSync(process.execPath,['--test',...selected],{stdio:'inherit'});process.exitCode=result.status??1;}
