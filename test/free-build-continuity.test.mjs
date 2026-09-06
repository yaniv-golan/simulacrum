import test from 'node:test';import assert from 'node:assert/strict';
import {appFingerprint} from '../scripts/build-fingerprint.mjs';
import {createWorkshop} from '../src/core/workshop.mjs';import {deterministicProjection} from '../src/model/tick.mjs';
test('free-built rotated assembly retains authored state and behavior through repeated save/load',async()=>{
 const workshop=await createWorkshop(undefined,{build:appFingerprint(),runtime:process.version});const act=async command=>assert.equal((await workshop.act(command)).ok,true,JSON.stringify(command));
 try{
  for(const [partType,id,position] of [['gripWheel','wheel',[1,.3,0]],['poweredMotor','motor',[0,.3,0]],['powerCell','cell',[-1,.3,0]]])await act({type:'place',partType,id,position});
  await act({type:'transform',id:'motor',position:[0,.3,0],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2]});
  await act({type:'parameter',id:'motor',key:'defaultDuty',value:.4});await act({type:'material',id:'cell',primitive:'body',material:'aluminium'});
  for(const [id,a,b] of [['drive',{part:'motor',port:'shaft'},{part:'wheel',port:'axle'}],['mount',{part:'cell',surface:{region:'left',u:0,v:0,twist:0}},{part:'motor',surface:{region:'left',u:0,v:0,twist:0}}],['power',{part:'cell',port:'power'},{part:'motor',port:'power'}]])await act({type:'connect',id,a,b});
  const authored=workshop.save();assert.ok(workshop.observe().frames[0].metadata.connections.every(c=>c.reasonCode==='OK'));
  for(let cycle=0;cycle<8;cycle++){
   await act({type:'disconnect',id:'mount'});await act({type:'undo'});assert.deepEqual(workshop.save(),authored);await act({type:'redo'});assert.equal(workshop.save().connections.length,2);await act({type:'undo'});
   const save=JSON.parse(JSON.stringify(workshop.save())),loaded=await createWorkshop(save);
   try{assert.deepEqual(loaded.save(),authored);await act({type:'run'});assert.equal((await loaded.act({type:'run'})).ok,true);try{workshop.step(120);}catch(error){const {mkdirSync,writeFileSync}=await import('node:fs');mkdirSync('artifacts/free-build-continuity',{recursive:true});writeFileSync('artifacts/free-build-continuity/failure.json',JSON.stringify(workshop.failureBundle(),null,2));writeFileSync('artifacts/free-build-continuity/machine.json',JSON.stringify(authored,null,2));throw error;}loaded.step(120);assert.deepEqual(deterministicProjection(workshop.observe().frames[0]),deterministicProjection(loaded.observe().frames[0]));}finally{loaded.dispose();}
   await act({type:'build'});assert.deepEqual(workshop.save(),authored);
  }
  const wrong=structuredClone(authored);wrong.parts.find(p=>p.id==='motor').parameters.defaultDuty=0;
  const altered=await createWorkshop(wrong);try{await act({type:'run'});await altered.act({type:'run'});workshop.step(120);altered.step(120);assert.notDeepEqual(deterministicProjection(workshop.observe().frames[0]),deterministicProjection(altered.observe().frames[0]),'wrong saved drive must change behavior');}finally{altered.dispose();}
 }finally{workshop.dispose();}
});
