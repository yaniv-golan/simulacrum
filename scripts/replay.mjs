import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { isDeepStrictEqual } from 'node:util';
import { appFingerprint } from './build-fingerprint.mjs';
export async function replayBundle(bundle,{expectedBuild,expectedRuntime}={}){
 if(bundle?.version!==1||!bundle.anchor||!Array.isArray(bundle.inputs)||!Number.isSafeInteger(bundle.failedTick)||bundle.failedTick<=bundle.anchor.tick||bundle.failedTick-bundle.anchor.tick>28800||typeof bundle.reasonCode!=='string'||!bundle.completed)throw Error('invalid failure bundle');
 if(expectedBuild!==undefined && bundle.identity?.build!==expectedBuild)throw Error('replay build identity mismatch');
 if(expectedRuntime!==undefined && bundle.identity?.runtime!==expectedRuntime)throw Error('replay runtime identity mismatch');
 if(!isDeepStrictEqual(bundle.identity,bundle.anchor.identity))throw Error('bundle and checkpoint identity mismatch');
 const session=await createSession(bundle.anchor.configuration,bundle.identity,bundle.anchor.metadata);
 try{
  session.restore(bundle.anchor);
  const pending=new Set(bundle.anchor.pending.map(input=>input.sequence));
  const seen=new Set();
  for(const input of bundle.inputs){
   if(!Number.isSafeInteger(input.tick)||input.tick<=bundle.anchor.tick||input.tick>bundle.failedTick||!Number.isSafeInteger(input.sequence)||seen.has(input.sequence))throw Error('invalid input sequence or tick');seen.add(input.sequence);
  }
  let caught=null;
  for(let tick=bundle.anchor.tick+1;tick<=bundle.failedTick;tick++){
   for(const input of bundle.inputs.filter(input=>input.tick===tick).sort((a,b)=>a.sequence-b.sequence)){
    if(pending.has(input.sequence))continue;
    const outcome=session.act(input.command);if(!outcome.ok)throw Error(`replay input rejected at tick ${tick}: ${outcome.reasonCode}`);
   }
   try{session.step(1);}catch(error){caught=error;break;}
  }
  if(!caught)throw Error(`replay did not fail by tick ${bundle.failedTick}`);
  const actual=session.failureBundle();
  if(!actual)throw Error(`replay failed without diagnostic bundle: ${caught.message}`);
  if(actual.failedTick!==bundle.failedTick)throw Error(`failure tick mismatch: expected ${bundle.failedTick}, got ${actual.failedTick}`);
  if(actual.reasonCode!==bundle.reasonCode)throw Error(`failure reason mismatch: expected ${bundle.reasonCode}, got ${actual.reasonCode}`);
  if(!isDeepStrictEqual(actual.inputs,bundle.inputs.filter(input=>!pending.has(input.sequence))))throw Error('replayed input trace mismatch');
  if(!isDeepStrictEqual(deterministicProjection(actual.completed),deterministicProjection(bundle.completed)))throw Error('completed deterministic projection mismatch');
  return {matched:true,sourceIdentityVerified:expectedBuild!==undefined && expectedRuntime!==undefined,failedTick:actual.failedTick,reasonCode:actual.reasonCode,identity:bundle.identity,runtime:process.version};
 }finally{session.dispose();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(!process.argv[2])throw Error('usage: node scripts/replay.mjs <failure-bundle.json>');console.log(JSON.stringify(await replayBundle(JSON.parse(readFileSync(process.argv[2],'utf8')),{expectedBuild:appFingerprint(),expectedRuntime:process.version})));}
 catch(error){console.error(`Replay failed: ${error.message}`);process.exitCode=1;}
}
