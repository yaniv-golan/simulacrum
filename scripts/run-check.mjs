import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const activeChildren=new Set();
const TERMINATION_GRACE_MS=250;
function signalGroup(child,signal) {
 try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}
 catch(error){if(error.code!=='ESRCH')throw error;}
}
function propagateTermination() {
 // Shared runners cooperate before their owner escalates to SIGKILL. A blocked
 // event loop cannot run this handler; the outer process inventory remains the
 // backstop for that case and for third-party programs that detach themselves.
 for(const child of activeChildren)try{signalGroup(child,'SIGTERM');}catch{}
}
function retainChild(child) {
 if(activeChildren.size===0&&process.platform!=='win32')process.on('SIGTERM',propagateTermination);
 activeChildren.add(child);
}
function releaseChild(child) {
 activeChildren.delete(child);
 if(activeChildren.size===0&&process.platform!=='win32')process.off('SIGTERM',propagateTermination);
}

/** One bounded process-tree owner for checks, including their browser children. */
export function runProcess(command,args=[],{timeoutMs=60_000,cwd=process.cwd(),maxOutputBytes=4*1024*1024,inheritOutput=false}={}) {
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('deadline must be positive');
 if(!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<=0)throw new Error('output limit must be positive');
 return new Promise((resolve,reject)=>{
  const started=performance.now(),child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  retainChild(child);
  let stdout='',stderr='',timedOut=false,closed=false,forced=false,closeCode,closeSignal;
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk.toString()).slice(-maxOutputBytes);if(inheritOutput)process.stdout.write(chunk);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-maxOutputBytes);if(inheritOutput)process.stderr.write(chunk);});
  function finish() {
   if(!closed||(timedOut&&!forced))return;
   const result={stdout,stderr,output:stdout+stderr,elapsedMs:performance.now()-started,code:closeCode,signal:closeSignal};
   if(timedOut||closeCode!==0){const summary=`${timedOut?`timed out after ${timeoutMs} ms`:`check exited ${closeCode??closeSignal}`}: ${command} ${args.join(' ')}`;reject(Object.assign(new Error(`${summary}\n${result.output}`),result,{summary}));}
   else resolve(result);
  }
  const timer=setTimeout(()=>{
   timedOut=true;
   if(process.platform==='win32'){
    spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'}).once('error',()=>child.kill('SIGKILL'));
    forced=true;finish();return;
   }
   // Enumerate while the root still exists, then terminate detached descendants
   // from leaves upward. This path also handles synchronously blocked runners.
   try {
    const rows=execFileSync('ps',['-A','-o','pid=,ppid='],{encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:1000}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
    const descendants=[child.pid];for(let i=0;i<descendants.length;i++)for(const [pid,ppid] of rows)if(ppid===descendants[i]&&!descendants.includes(pid))descendants.push(pid);
    for(const pid of descendants.slice(1).reverse())try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
   }catch(error){stderr+=`\nProcess tree enumeration unavailable: ${error.message}`;}
   try{signalGroup(child,'SIGTERM');}catch(error){stderr+=`\nTermination failed: ${error.message}`;}
   // Do not cancel this escalation when the immediate process exits: a child
   // that ignores SIGTERM can outlive that process within the same group.
   setTimeout(()=>{
    try{signalGroup(child,'SIGKILL');}catch(error){stderr+=`\nForced termination failed: ${error.message}`;}
    forced=true;
    // An escaped descendant must not keep inherited output pipes and the
    // caller's deadline open forever when process inventory was unavailable.
    child.stdout.destroy();child.stderr.destroy();finish();
   },TERMINATION_GRACE_MS);
  },timeoutMs);
  child.once('error',error=>{clearTimeout(timer);releaseChild(child);reject(error);});
  child.once('close',(code,signal)=>{
   clearTimeout(timer);releaseChild(child);closed=true;closeCode=code;closeSignal=signal;finish();
  });
 });
}
export function runModuleCheck(modulePath,exportName,args=[],options={}) {
 const source=`const m=await import(${JSON.stringify(pathToFileURL(modulePath).href)}); const fn=m[${JSON.stringify(exportName)}]; if(typeof fn!=='function') throw new Error('missing check export'); await fn(...${JSON.stringify(args)});`;
 return runProcess(process.execPath,['--input-type=module','-e',source],options);
}
