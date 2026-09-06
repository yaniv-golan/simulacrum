import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
export const configuration={power:{cells:[],motors:[],wires:[],signalWires:[],receivers:[],controllers:[],sensors:[]},gravity:[0,-9.81,0],joints:[],bodies:[
 {position:[0,3,0],velocity:[0,0,0],mass:1,shape:'box',halfExtents:[.2,.2,.2],fixed:false,rotation:[0,0,0,1],friction:0.5,restitution:0},
 {position:[0,-.2,0],velocity:[0,0,0],mass:1,shape:'box',halfExtents:[10,.2,10],fixed:true,rotation:[0,0,0,1],friction:0.5,restitution:0},
]};
export const inputTrace=[{tick:10,command:{type:'impulse',body:0,value:[.25,0,0]}},{tick:60,command:{type:'impulse',body:0,value:[0,.5,0]}}];
export function digest(value){return createHash('sha256').update(ArrayBuffer.isView(value)?value:JSON.stringify(value)).digest('hex');}
export async function runFixture(driver){
 if(!['step','elapsed'].includes(driver))throw Error('driver must be step or elapsed');
 const session=await createSession(configuration),hashes=[];
 try{
  for(let tick=1;tick<=120;tick++){
   for(const input of inputTrace.filter(input=>input.tick===tick)){const accepted=session.act(input.command);if(!accepted.ok)throw Error(`input rejected at tick ${tick}: ${accepted.reasonCode}`);}
   if(driver==='step')session.step(1);
   else {session.advanceTime(DT*1000*.25);session.advanceTime(DT*1000*.75);}
   const frame=session.observe().frames.at(-1);
   if(frame.tick!==tick)throw Error(`clock tick mismatch: expected ${tick}, got ${frame.tick}`);
   hashes.push({tick,hash:digest(deterministicProjection(frame))});
  }
  return {pid:process.pid,driver,runtime:process.version,hashes,configurationId:digest(configuration),inputTraceId:digest(inputTrace)};
 }finally{session.dispose();}
}
if(process.argv[2] && process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 try{process.stdout.write(`${JSON.stringify(await runFixture(process.argv[2]))}\n`);}catch(error){console.error(error.stack);process.exitCode=1;}
}
