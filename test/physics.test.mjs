import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
const body={shape:'box',position:[0,10,0],velocity:[1,0,0],mass:2,halfExtents:[0.1,0.1,0.1],fixed:false,rotation:[0,0,0,1],friction:0.5,restitution:0};
const config={gravity:[0,-9.81,0],bodies:[body],joints:[]};
test('free fall follows analytical solution within integration discretization bound',async()=>{
 const world=await createPhysicsWorld(config);try{for(let i=0;i<120;i++)world.step();const state=world.read()[0];assert.ok(Math.abs(state.velocity[1]+9.81)<1e-4);assert.ok(Math.abs(state.position[0]-1)<1e-5);assert.ok(Math.abs(state.position[1]-(10-9.81/2))<=9.81/120);assert.ok(Math.abs(state.mass-2)<1e-5);}finally{world.dispose();}
});
test('snapshot restore resumes exact body state and serialized continuation',async()=>{
 const world=await createPhysicsWorld({...config,bodies:[body,{...body,position:[5,20,0],velocity:[-1,0,0],mass:3}]});try{for(let i=0;i<20;i++)world.step();const checkpoint=world.snapshot();for(let i=0;i<30;i++)world.step();const expected=world.read();const bytes=world.snapshot();world.restore(checkpoint);for(let i=0;i<30;i++)world.step();assert.deepEqual(world.read(),expected);assert.deepEqual(world.snapshot(),bytes);}finally{world.dispose();}
});
test('all boundary values are copied and failed restore does not mutate live state',async()=>{
 const input=structuredClone(config),world=await createPhysicsWorld(input);try{input.gravity[1]=0;input.bodies[0].position[1]=100;const read=world.read();read[0].position[1]=100;const bytes=world.snapshot();bytes.fill(0);assert.equal(world.read()[0].position[1],10);const before=world.snapshot();assert.throws(()=>world.restore(bytes));assert.deepEqual(world.snapshot(),before);world.applyImpulse(0,[2,0,0]);assert.ok(Math.abs(world.read()[0].velocity[0]-2)<1e-5);world.step();assert.ok(world.read()[0].velocity[1]<0);assert.throws(()=>world.applyImpulse(-1,[0,0,0]));assert.throws(()=>world.applyImpulse(0,[NaN,0,0]));}finally{world.dispose();}
});
test('physics input rejects identity and malformed values',async()=>{
 await assert.rejects(createPhysicsWorld({...config,name:'demo'}));await assert.rejects(createPhysicsWorld({...config,bodies:[{...body,role:'leg'}]}));await assert.rejects(createPhysicsWorld({...config,bodies:[{...body,mass:-1}]}));await assert.rejects(createPhysicsWorld({...config,gravity:[0,Infinity,0]}));
});
test('restore rejects another numeric plant including forged matching metadata',async()=>{
 const world=await createPhysicsWorld(config);
 try{const original=world.snapshot();for(const alternate of [
  {...config,gravity:[0,-1,0]}, {...config,bodies:[{...body,mass:3}]}, {...config,bodies:[{...body,halfExtents:[.2,.1,.1]}]}, {...config,bodies:[{...body,shape:'cylinder'}]},
 ]){
  const other=await createPhysicsWorld(alternate);
  try{const bytes=other.snapshot();assert.throws(()=>world.restore(bytes));assert.deepEqual(world.snapshot(),original);
   const originalLength=new DataView(original.buffer).getUint32(4),otherLength=new DataView(bytes.buffer).getUint32(4);
   const metadata=original.slice(12,12+originalLength),payload=bytes.slice(12+otherLength);
   const forged=new Uint8Array(12+metadata.length+payload.length);forged.set(original.slice(0,12));forged.set(metadata,12);forged.set(payload,12+metadata.length);
   let hash=2166136261;for(const byte of forged.subarray(12))hash=Math.imul(hash^byte,16777619);new DataView(forged.buffer).setUint32(8,hash>>>0);
   assert.throws(()=>world.restore(forged));assert.deepEqual(world.snapshot(),original);
  }finally{other.dispose();}
 }}finally{world.dispose();}
});

test('fixed joint transmits momentum while preserving relative transform and fresh restore',async()=>{
 const configuration={gravity:[0,0,0],bodies:[{...body,position:[0,0,0],velocity:[0,0,0]},{...body,position:[1,0,0],velocity:[0,0,0]}],joints:[{kind:'fixed',a:0,b:1,anchorA:[0.5,0,0],anchorB:[-0.5,0,0],rotationA:[0,0,0,1],rotationB:[0,0,0,1]}]};
 const world=await createPhysicsWorld(configuration),fresh=await createPhysicsWorld(configuration);
 try{world.applyImpulse(0,[4,0,0]);for(let i=0;i<120;i++)world.step();const [a,b]=world.read();assert.ok(Math.abs(a.velocity[0]-1)<1e-4);assert.ok(Math.abs(b.velocity[0]-1)<1e-4);assert.ok(Math.abs(b.position[0]-a.position[0]-1)<1e-4);assert.ok(Math.abs((a.position[0]+b.position[0])/2-1.5)<1e-4);
 fresh.restore(world.snapshot());for(let i=0;i<30;i++){world.step();fresh.step();}assert.deepEqual(fresh.snapshot(),world.snapshot());
 }finally{world.dispose();fresh.dispose();}
});
test('authored quaternion determines body rotation and invalid joint bindings reject',async()=>{
 const rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2],world=await createPhysicsWorld({...config,bodies:[{...body,rotation}]});
 try{world.read()[0].rotation.forEach((value,i)=>assert.ok(Math.abs(value-rotation[i])<1e-6));}finally{world.dispose();}
 await assert.rejects(createPhysicsWorld({...config,bodies:[{...body,rotation:[0,0,0,0]}]}));
 await assert.rejects(createPhysicsWorld({...config,joints:[{kind:'fixed',a:0,b:0,anchorA:[0,0,0],anchorB:[0,0,0],rotationA:[0,0,0,1],rotationB:[0,0,0,1]}]}));
});

test('revolute torque obeys tau equals inertia times angular acceleration and opposite momentum',async()=>{
 const rotor={...body,position:[0,0,0],velocity:[0,0,0]},joint={kind:'revolute',a:0,b:1,anchorA:[0,0,0],anchorB:[0,0,0],axisA:[1,0,0],axisB:[1,0,0]};
 const configuration={gravity:[0,0,0],bodies:[rotor,rotor],joints:[joint]},world=await createPhysicsWorld(configuration);
 try{const inertia=2*(.1**2+.1**2)/3,torque=.01;assert.ok(Math.abs(world.getAxisInverseInertia(0,[1,0,0])-1/inertia)<1e-4);
 for(let i=0;i<120;i++){world.applyTorquePair(0,1,[1,0,0],torque);world.step();}
 const [a,b]=world.read(),state=world.jointState(0);assert.ok(Math.abs(b.angularVelocity[0]-torque/inertia)<1e-4);assert.ok(Math.abs(a.angularVelocity[0]+b.angularVelocity[0])<1e-6);assert.ok(Math.abs(state.speed-2*torque/inertia)<2e-4);assert.ok(state.angle>0.7&&state.angle<0.8);assert.ok(Math.abs(state.effectiveInverseInertia-2/inertia)<1e-4);
 const fresh=await createPhysicsWorld(configuration);try{fresh.restore(world.snapshot());world.step();fresh.step();assert.deepEqual(fresh.jointState(0),world.jointState(0));assert.deepEqual(fresh.snapshot(),world.snapshot());}finally{fresh.dispose();}
 }finally{world.dispose();}
});
test('torque inputs reject invalid indices axes and nonfinite allocation',async()=>{
 const world=await createPhysicsWorld({...config,bodies:[body,{...body,position:[2,10,0]}]});try{assert.equal(typeof world.applyTorquePair,'function');const before=world.snapshot();assert.throws(()=>world.applyTorquePair(0,99,[1,0,0],1));assert.throws(()=>world.applyTorquePair(0,1,[0,0,0],1));assert.throws(()=>world.applyTorquePair(0,1,[1,0,0],Infinity));assert.deepEqual(world.snapshot(),before);}finally{world.dispose();}
});

test('cylinder local X inertia and torque match one half mass radius squared; fresh restore exact',async()=>{
 const cylinder={...body,shape:'cylinder',position:[0,0,0],velocity:[0,0,0],halfExtents:[.05,.2,.2]},stator={...body,fixed:true,position:[-1,0,0],velocity:[0,0,0]};
 const configuration={gravity:[0,0,0],bodies:[stator,cylinder],joints:[]},world=await createPhysicsWorld(configuration),fresh=await createPhysicsWorld(configuration);
 try{const inertia=.5*cylinder.mass*.2**2;assert.ok(Math.abs(world.getAxisInverseInertia(1,[1,0,0])-1/inertia)<1e-4);
  for(let tick=0;tick<60;tick++){world.applyTorquePair(0,1,[1,0,0],.02);world.step();}assert.ok(Math.abs(world.read()[1].angularVelocity[0]-.02/inertia*.5)<1e-4);
  fresh.restore(world.snapshot());for(let i=0;i<10;i++){fresh.step();world.step();}assert.deepEqual(fresh.snapshot(),world.snapshot());
 }finally{world.dispose();fresh.dispose();}
});
test('shape discriminator and cylinder equal radial dimensions are strict',async()=>{
 const missing={...body};delete missing.shape;
 await assert.rejects(createPhysicsWorld({...config,bodies:[missing]}));
 await assert.rejects(createPhysicsWorld({...config,bodies:[{...body,shape:'sphere'}]}));
 await assert.rejects(createPhysicsWorld({...config,bodies:[{...body,shape:'cylinder',halfExtents:[.05,.2,.3]}]}));
});
