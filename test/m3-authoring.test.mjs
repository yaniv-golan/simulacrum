import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createSession } from '../src/simulation/session.mjs';

function fixture() {
 let blueprint=createEmptyBlueprint('machine','Ordinary powered assembly');
 blueprint.parts=[createPart('powerCell','cell',[2,3,0]),createPart('poweredMotor','motor',[0,3,0]),createPart('gripWheel','wheel',[1,3,0]),createPart('commandReceiver','receiver',[3,3,0])];
 blueprint=snapConnection(blueprint,{part:'motor',port:'shaft'},{part:'wheel',port:'axle'});
 return blueprint;
}
const links=[
 {id:'power',a:{part:'cell',port:'power'},b:{part:'motor',port:'power'},kind:'power'},
 {id:'shaft',a:{part:'motor',port:'shaft'},b:{part:'wheel',port:'axle'},kind:'shaft'},
 {id:'signal',a:{part:'receiver',port:'signal'},b:{part:'motor',port:'signal'},kind:'signal'},
];
const latest=session=>session.observe().frames[0];

test('ordinary workshop commands connect power, shaft and receiver then drive the rotor',async()=>{
 const workshop=await createWorkshop(fixture());
 try {
  for(const {id,a,b} of links)assert.equal((await workshop.act({type:'connect',id,a,b})).ok,true);
  assert.equal((await workshop.act({type:'control',id:'receiver',duty:1})).ok,true);
  assert.equal((await workshop.act({type:'run'})).ok,true);
  workshop.step(30);
  const driven=latest(workshop);
  assert.equal(driven.metadata.mode,'run');
  assert.ok(Math.abs(driven.physics[2].angularVelocity[0])>0.01);
  assert.ok(driven.power.motors[0].torque>0);
  assert.ok(driven.power.cells[0].energyJ<workshop.save().parts[0].parameters.capacityJ);
  assert.equal((await workshop.act({type:'control',id:'receiver',duty:0})).ok,true);
  workshop.step(1);
  assert.equal(latest(workshop).power.motors[0].torque,0);
  assert.equal(latest(workshop).power.motors[0].reasonCode,'OFF');
 } finally {workshop.dispose();}
});

function connected() {const blueprint=fixture();blueprint.connections=structuredClone(links);blueprint.parts[3].parameters.duty=1;return blueprint;}
function renamed(original) {
 const blueprint=structuredClone(original),names=new Map();
 blueprint.id='different-machine';blueprint.name='Different visible name';
 blueprint.parts.forEach((part,i)=>{const id=`renamed-${99-i}`;names.set(part.id,id);part.id=id;part.name=`Part ${99-i}`;});
 blueprint.connections.forEach((connection,i)=>{connection.id=`connection-${99-i}`;connection.a.part=names.get(connection.a.part);connection.b.part=names.get(connection.b.part);});
 return blueprint;
}
async function trace(blueprint,ticks=60) {
 const session=await createSession(compileAssembly(blueprint).configuration);
 try {const frames=[deterministicProjection(latest(session))];for(let i=0;i<ticks;i++){session.step(1);frames.push(deterministicProjection(latest(session)));}return frames;}
 finally {session.dispose();}
}
test('renamed authored identities preserve the complete deterministic projection every tick',async()=>{
 const original=connected(),other=renamed(original);
 assert.deepEqual(compileAssembly(original).configuration,compileAssembly(other).configuration);
 const first=await trace(original),second=await trace(other);
 assert.equal(first.length,61);
 for(let tick=0;tick<first.length;tick++)assert.deepEqual(first[tick],second[tick],`renaming changed tick ${tick}`);
 // Deliberately alter an actual player-visible physical selection. The same
 // oracle must reject this trace; equality cannot be an inert trace fixture.
 const changed=renamed(original);changed.parts[2].authoredMaterial.body='steel';
 const wrong=await trace(changed);
 assert.throws(()=>assert.deepEqual(first,wrong));
 assert.notDeepEqual(first.at(-1).physics[2].angularVelocity,wrong.at(-1).physics[2].angularVelocity);
});
