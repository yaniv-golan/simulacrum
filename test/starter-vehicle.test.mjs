import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createStarterVehicle } from '../src/model/starter-vehicle.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { sourceIdentity } from '../scripts/source-identity.mjs';
import { appFingerprint } from '../scripts/build-fingerprint.mjs';
const horizontal=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const protocol=Object.freeze({version:1,ticks:3600,minimumTravel:2,minimumFinalTenSecondsTravel:.3,maximumPowerlessTravel:.1,minimumHousingClearance:.005});
function lowerFace(body,halfExtents){const [x,y,z,w]=body.rotation;return body.position[1]-Math.abs(2*(x*y+w*z))*halfExtents[0]-Math.abs(1-2*(x*x+z*z))*halfExtents[1]-Math.abs(2*(y*z-w*x))*halfExtents[2];}

test('ordinary starter travels continuously for thirty seconds with powerless control',async()=>{
 const evidence=[];
 for(const powered of [true,false]){
  const blueprint=createStarterVehicle({powered}),compiled=compileAssembly(blueprint);
  assert.ok(compiled.connections.every(c=>c.reasonCode==='OK'));
  const session=await createSession(compiled.configuration),start=session.observe().frames[0].physics[0].position;
  let middle,checkpoint,minimumClearance=Infinity;const samples=[],hashes=[];
  try{
   for(let tick=1;tick<=protocol.ticks;tick++){
    session.step(1);const frame=session.observe().frames[0];assert.equal(frame.status,'ready');
    minimumClearance=Math.min(minimumClearance,lowerFace(frame.physics[1],compiled.configuration.bodies[1].halfExtents));
    hashes.push(digest(deterministicProjection(frame)));
    if(tick===1200)checkpoint=session.checkpoint();
    if(tick===2400)middle=frame.physics[0].position;
    if(tick%120===0)samples.push({tick,position:frame.physics[0].position,motor:frame.power.motors[0],cell:frame.power.cells[0]});
   }
   const end=session.observe().frames[0],travel=horizontal(end.physics[0].position,start),finalTravel=horizontal(end.physics[0].position,middle);
   const result={powered,blueprint,configuration:compiled.configuration,protocol,inputTrace:[],start,travel,finalTravel,minimumClearance,samples,hashes};evidence.push(result);
   assert.ok(minimumClearance>protocol.minimumHousingClearance,`housing clearance ${minimumClearance}`);
   if(powered){assert.ok(travel>protocol.minimumTravel,`travel ${travel}`);assert.ok(finalTravel>protocol.minimumFinalTenSecondsTravel,`final travel ${finalTravel}`);assert.ok(end.power.cells[0].energyJ<blueprint.parts[2].parameters.capacityJ);}
   else {assert.ok(travel<protocol.maximumPowerlessTravel,`unpowered drift ${travel}`);assert.equal(end.power.motors[0].shaftWorkJ,0);}
   session.restore(checkpoint);
   for(let tick=1201;tick<=protocol.ticks;tick++){session.step(1);assert.equal(digest(deterministicProjection(session.observe().frames[0])),hashes[tick-1],`replay tick ${tick}`);}
  }finally{session.dispose();}
 }
 mkdirSync('artifacts/starter-vehicle',{recursive:true});writeFileSync('artifacts/starter-vehicle/qualification.json',JSON.stringify({source:sourceIdentity(),build:appFingerprint(),runtime:process.version,platform:process.platform,architecture:process.arch,evidence},null,2)+'\n');
});
test('starter compiled physics ignores identifiers and wrong traces are rejected',()=>{
 const bp=createStarterVehicle(),renamed=structuredClone(bp),ids=new Map(renamed.parts.map((p,i)=>[p.id,`renamed-${i}`]));
 renamed.id='different';renamed.name='Different';for(const p of renamed.parts){p.id=ids.get(p.id);p.name='Changed';}
 for(const c of renamed.connections){c.id=`other-${c.id}`;c.a.part=ids.get(c.a.part);c.b.part=ids.get(c.b.part);}
 assert.deepEqual(compileAssembly(bp).configuration,compileAssembly(renamed).configuration);
 const original={tick:3600,position:[0,0,2.1]};assert.throws(()=>assert.deepEqual({...original,tick:3599},original));
 const wrong=structuredClone(bp);wrong.parts[1].parameters.torqueConstant=.1;assert.notDeepEqual(compileAssembly(wrong).configuration,compileAssembly(bp).configuration);
});
