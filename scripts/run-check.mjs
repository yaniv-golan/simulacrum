import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function runModuleCheck(modulePath,exportName,args=[],{timeoutMs=60_000,cwd=process.cwd()}={}) {
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('deadline must be positive');
 return new Promise((resolve,reject)=>{
  const source=`const m=await import(${JSON.stringify(pathToFileURL(modulePath).href)}); const fn=m[${JSON.stringify(exportName)}]; if(typeof fn!=='function') throw new Error('missing check export'); await fn(...${JSON.stringify(args)});`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{cwd,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let output='',timedOut=false;
  const collect=chunk=>{output=(output+chunk.toString()).slice(-32768);};child.stdout.on('data',collect);child.stderr.on('data',collect);
  const timer=setTimeout(()=>{timedOut=true;try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch(error){if(error.code!=='ESRCH')reject(error);}},timeoutMs);
  child.once('error',error=>{clearTimeout(timer);reject(error);});
  child.once('close',(code,signal)=>{clearTimeout(timer);if(timedOut)reject(new Error(`timed out after ${timeoutMs} ms`));else if(code!==0)reject(new Error(`check exited ${code??signal}: ${output}`));else resolve({output});});
 });
}
