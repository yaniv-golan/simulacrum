import test from 'node:test';import assert from 'node:assert/strict';import {createPhysicsWorld} from '../src/simulation/physics/world.mjs';
const body=(position=[0,0,0])=>({shape:'box',position,rotation:[0,0,0,1],velocity:[0,0,0],mass:1,halfExtents:[.1,.1,.1],fixed:false,friction:0,restitution:0});
test('torque impulse receipt agrees with independent kinetic energy and opposite momentum',async()=>{
 const world=await createPhysicsWorld({gravity:[0,0,0],bodies:[body(),body([2,0,0])],joints:[]});try{
 const r=world.applyTorquePair(0,1,[1,0,0],.6),J=.6/120,I=1*.02/3;
 assert.ok(r,'physical door returns measured work receipt');assert.ok(Math.abs(r.workJ-J*J/I)<1e-8);assert.ok(Math.abs(r.kineticDeltaJ-r.workJ)<1e-8);
 const s=world.read();assert.ok(Math.abs(s[0].angularVelocity[0]+s[1].angularVelocity[0])<1e-8);
 const before=world.mechanicalEnergy();world.step();assert.ok(Math.abs(world.mechanicalEnergy().kineticJ-before.kineticJ)<1e-8);
 }finally{world.dispose();}
});
test('rotated anisotropic impulse work uses the full inertia and excludes later back-driving',async()=>{
 for(const sign of [-1,1]){
 const q=[0,Math.sin(.37),0,Math.cos(.37)],world=await createPhysicsWorld({gravity:[0,0,0],bodies:[{...body(),halfExtents:[.1,.2,.3],rotation:q},body([3,0,0])],joints:[]});try{
 const axis=[1,2,3].map(v=>v/Math.sqrt(14));world.applyTorquePair(0,1,axis,-sign*3);
 const before=world.read(),r=world.applyTorquePair(0,1,axis,sign*.4),after=world.read();assert.ok(r.workJ<0,'reverse motion returns mechanical energy to drive losses');assert.ok(Math.abs(r.kineticDeltaJ-r.workJ)<1e-7);
 assert.deepEqual(after.map(b=>b.position),before.map(b=>b.position));assert.deepEqual(after.map(b=>b.rotation),before.map(b=>b.rotation));assert.deepEqual(after.map(b=>b.velocity),before.map(b=>b.velocity));
 const saved={...r};world.applyTorquePair(0,1,axis,sign*9);assert.deepEqual(r,saved,'later impulse cannot rewrite motor receipt');
 }finally{world.dispose();}}
});
