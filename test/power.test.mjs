import test from 'node:test';
import assert from 'node:assert/strict';
import { motorStep } from '../src/simulation/physics/law/motor.mjs';
import { createPowerNetwork } from '../src/simulation/power.mjs';
const dt=1/120,close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
const config=()=>({cells:[{node:0,voltage:24,capacityJ:100,initialJ:100,resistance:.1,currentLimit:20}],motors:[{node:1,body:1,rotor:2,joint:0,defaultDuty:1,axis:[1,0,0],torqueConstant:.1,resistance:1,currentLimit:10}],wires:[[0,1]],signalWires:[[3,1]],receivers:[{node:3,duty:1}],controllers:[],sensors:[]});
function execute(network,{speed=0,inertia=.01,commands=[]}={}) {
 const allocation=network.step(dt,[{node:1,speed}],commands,[{node:1,inertia}]);
 const after=speed+allocation.torques[0].value*dt/inertia;
 return {torques:allocation.torques,telemetry:network.completeStep(dt,[{node:1,speed:after}])};
}
test('endpoint bound funds constant current throughout isolated acceleration',()=>{
 for(const speed of [0,2,-2])for(const voltage of [12,-12])for(const limit of [.1,20]){
  const r=motorStep(voltage,speed,.2,1,limit,.3,dt);
  close(r.electricalEnergy,r.heatEnergy+r.mechanicalEnergy);
  close(r.mechanicalEnergy,.5*.3*(r.nextSpeed**2-speed**2));
  assert.ok((voltage-.2*r.nextSpeed-r.current)*r.current>=-1e-12);
  assert.ok(r.heatEnergy>=r.current**2*dt-1e-12);assert.ok(Math.abs(r.current)<=limit);
 }
 const off=motorStep(0,3,.2,1,20,.3,dt);assert.equal(off.current,0);assert.equal(off.nextSpeed,3);
});
test('network requires physical power; receiver overrides forgiving motor default',()=>{
 const network=createPowerNetwork(config()),r=execute(network);
 assert.ok(r.torques[0].value>0);assert.ok(network.read().cells[0].energyJ<100);
 const disconnected=config();disconnected.wires=[];const off=execute(createPowerNetwork(disconnected));
 assert.equal(off.torques[0].value,0);assert.equal(off.telemetry.motors[0].reasonCode,'NO_POWER');
 const unsignalled=config();unsignalled.signalWires=[];assert.ok(execute(createPowerNetwork(unsignalled)).torques[0].value>0);
 assert.equal(execute(createPowerNetwork(config()),{commands:[{node:3,duty:0}]}).torques[0].value,0);
});
test('energy depletion cannot overdraw and only completed state checkpoints',()=>{
 const cfg=config();cfg.cells[0].initialJ=.00001;const network=createPowerNetwork(cfg),snapshot=network.snapshot();
 const allocation=network.step(dt,[{node:1,speed:0}],[],[{node:1,inertia:.01}]);
 assert.deepEqual(network.read(),snapshot);assert.throws(()=>network.snapshot(),/POWER_STEP_PENDING/);
 assert.throws(()=>network.step(dt,[{node:1,speed:0}],[],[{node:1,inertia:.01}]),/POWER_STEP_PENDING/);
 const state=network.completeStep(dt,[{node:1,speed:allocation.torques[0].value*dt/.01}]);
 assert.ok(state.cells[0].energyJ>=0);close(snapshot.cells[0].energyJ-state.cells[0].energyJ,state.motors[0].electricalEnergy);
 network.restore(snapshot);assert.deepEqual(network.snapshot(),snapshot);
 assert.throws(()=>network.step(dt,[{node:1,speed:0}],[{node:99,duty:1}]));
});
test('unsupported multi-source power and malformed numeric config are explicit',()=>{
 const multiple=config();multiple.cells.push({...multiple.cells[0],node:4});multiple.wires.push([4,1]);assert.throws(()=>createPowerNetwork(multiple),/UNSUPPORTED_POWER_TOPOLOGY/);
 const invalid=config();invalid.cells[0].initialJ=101;assert.throws(()=>createPowerNetwork(invalid));
 const bad=config();bad.motors[0].resistance=-1;assert.throws(()=>createPowerNetwork(bad));
});
test('actual attached-load work determines driver loss instead of bare-body inertia',()=>{
 const network=createPowerNetwork(config());const allocation=network.step(dt,[{node:1,speed:0}],[],[{node:1,inertia:.01}]);
 const measuredAfter=.006,telemetry=network.completeStep(dt,[{node:1,speed:measuredAfter}]),m=telemetry.motors[0];
 close(telemetry.cells[0].heatJ,m.current**2*.1*dt);close(m.heatJ,m.current**2*dt);
 close(m.mechanicalEnergy,allocation.torques[0].value*measuredAfter*dt/2);
 close(m.electricalEnergy,telemetry.cells[0].heatJ+m.heatJ+m.driverHeatJ+m.mechanicalEnergy+m.energyResidualJ);
 assert.ok(m.driverHeatJ>0);close(m.shaftWorkJ,m.mechanicalEnergy);
});
test('unfunded actual work fails atomically rather than becoming negative driver heat',()=>{
 const network=createPowerNetwork(config()),before=network.snapshot();network.step(dt,[{node:1,speed:0}],[],[{node:1,inertia:.01}]);
 assert.throws(()=>network.completeStep(dt,[{node:1,speed:10000}]),/ENERGY_INVARIANT/);
 assert.deepEqual(network.read(),before);assert.throws(()=>network.snapshot(),/POWER_STEP_PENDING/);
 network.restore(before);assert.deepEqual(network.snapshot(),before);
});
test('positive average driver heat cannot hide negative endpoint voltage headroom',()=>{
 const network=createPowerNetwork(config()),before=network.snapshot();
 network.step(dt,[{node:1,speed:0}],[],[{node:1,inertia:.01}]);
 // 10 A, 24 V, Rtotal1.1: final back-EMF at150rad/s requires26V.
 // Average work is only0.625J, leaving positive average driverheat0.4583J.
 assert.throws(()=>network.completeStep(dt,[{node:1,speed:150}]),/ENERGY_INVARIANT/);
 assert.deepEqual(network.read(),before);
});
