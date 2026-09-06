import { build, preview } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkBreadth } from './check-breadth.mjs';
import { sourceIdentity } from './source-identity.mjs';
const mode=process.argv[2];
if(!['f2','flow'].includes(mode))throw Error('expected f2 or flow');
const source=sourceIdentity();checkBreadth();await build({logLevel:'error'});
const server=await preview({preview:{host:'127.0.0.1',port:0},logLevel:'error'});
try{
 const address=server.httpServer.address();
 const {stdout}=await promisify(execFile)(process.execPath,[mode==='f2'?'scripts/qualify-workshop.mjs':'scripts/verify-workshop.mjs',`http://127.0.0.1:${address.port}/`],{timeout:90000,maxBuffer:4*1024*1024});
 if(sourceIdentity().workingTreeDigest!==source.workingTreeDigest)throw Error('source changed during workshop verification');
 console.log(stdout.trim());
 if(mode==='flow'){const surface=await promisify(execFile)(process.execPath,['scripts/verify-surface-browser.mjs',`http://127.0.0.1:${address.port}/`],{timeout:30000,maxBuffer:4*1024*1024});console.log(surface.stdout.trim());const remote=await promisify(execFile)(process.execPath,['scripts/verify-remote-playtest.mjs'],{timeout:45000,maxBuffer:4*1024*1024});console.log(remote.stdout.trim());const recording=await promisify(execFile)(process.execPath,['scripts/verify-recording-browser.mjs',`http://127.0.0.1:${address.port}/`],{timeout:30000,maxBuffer:4*1024*1024});console.log(recording.stdout.trim());const direct=await promisify(execFile)(process.execPath,['scripts/verify-direct-edit-browser.mjs',`http://127.0.0.1:${address.port}/`],{timeout:30000,maxBuffer:4*1024*1024});console.log(direct.stdout.trim());const selection=await promisify(execFile)(process.execPath,['scripts/verify-selection-browser.mjs',`http://127.0.0.1:${address.port}/`],{timeout:30000,maxBuffer:4*1024*1024});console.log(selection.stdout.trim());const extra=await promisify(execFile)(process.execPath,['scripts/verify-starter-browser.mjs',`http://127.0.0.1:${address.port}/`],{timeout:90000,maxBuffer:4*1024*1024});console.log(extra.stdout.trim());}
 if(sourceIdentity().workingTreeDigest!==source.workingTreeDigest)throw Error('source changed during starter verification');
}finally{await new Promise(resolve=>server.httpServer.close(resolve));}
