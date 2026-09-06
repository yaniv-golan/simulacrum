import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
const start = performance.now();
for (const args of [['scripts/gate-structural.mjs'], ['scripts/test-affected.mjs','--all']]) {
  execFileSync(process.execPath, args, {stdio:'inherit',timeout:Math.max(1,Math.floor(180_000-(performance.now()-start))),killSignal:'SIGKILL'});
}
const elapsedMs = performance.now()-start;
if (elapsedMs>=180_000) throw new Error(`iteration-budget: ${elapsedMs}ms`);
mkdirSync('artifacts',{recursive:true});
writeFileSync('artifacts/ci.json',JSON.stringify({runtime:process.version,elapsedMs},null,2)+'\n');
console.log(`every-commit checks passed in ${elapsedMs.toFixed(1)}ms`);
