import { motorStep } from './physics/law/motor.mjs';
const clone=x=>structuredClone(x);
const fail=code=>{throw Object.assign(new Error(code),{reasonCode:code,path:'power'});};
const finite=(...values)=>values.every(Number.isFinite);
// Float32 solver roundoff allowance, in joules plus relative per-step scale.
export const ENERGY_ABSOLUTE_TOLERANCE=1e-9;
export const ENERGY_RELATIVE_TOLERANCE=32*2**-23;
export function createPowerNetwork(configuration) {
 const config=clone(configuration);
 const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.split(',').sort().join(',');
 const node=n=>Number.isSafeInteger(n)&&n>=0;
 const array=(key)=>Array.isArray(config[key])&&config[key].length<=8192;
 if(!exact(config,'cells,motors,wires,signalWires,receivers,controllers,sensors')||!['cells','motors','wires','signalWires','receivers','controllers','sensors'].every(array))fail('INVALID_POWER_CONFIGURATION');
 for(const cell of config.cells)if(!exact(cell,'node,voltage,capacityJ,initialJ,resistance,currentLimit')||!node(cell.node)||!finite(cell.voltage,cell.capacityJ,cell.initialJ,cell.resistance,cell.currentLimit)||cell.voltage<=0||cell.capacityJ<=0||cell.initialJ<0||cell.initialJ>cell.capacityJ||cell.resistance<=0||cell.currentLimit<=0)fail('INVALID_POWER_CONFIGURATION');
 for(const motor of config.motors)if(!exact(motor,'node,body,rotor,joint,axis,torqueConstant,resistance,currentLimit,defaultDuty')||!node(motor.node)||!node(motor.body)||!Number.isSafeInteger(motor.rotor)||motor.rotor< -1||!Number.isSafeInteger(motor.joint)||motor.joint< -1||!Array.isArray(motor.axis)||motor.axis.length!==3||!motor.axis.every(Number.isFinite)||Math.abs(Math.hypot(...motor.axis)-1)>1e-9||!finite(motor.defaultDuty,motor.torqueConstant,motor.resistance,motor.currentLimit)||Math.abs(motor.defaultDuty)>1||motor.torqueConstant<=0||motor.resistance<=0||motor.currentLimit<=0)fail('INVALID_POWER_CONFIGURATION');
 for(const source of [...config.receivers,...config.controllers])if(!exact(source,'node,duty')||!node(source.node)||!finite(source.duty)||Math.abs(source.duty)>1)fail('INVALID_POWER_CONFIGURATION');
 for(const edges of [config.wires,config.signalWires])for(const edge of edges)if(!Array.isArray(edge)||edge.length!==2||!edge.every(node)||edge[0]===edge[1])fail('INVALID_POWER_CONFIGURATION');
 for(const entries of [config.cells,config.motors,config.receivers,config.controllers,config.sensors])if(new Set(entries.map(e=>e.node)).size!==entries.length)fail('INVALID_POWER_CONFIGURATION');
 for(const sensor of config.sensors)if(!exact(sensor,'node,body,axis')||!node(sensor.node)||!node(sensor.body)||!Array.isArray(sensor.axis)||sensor.axis.length!==3||!sensor.axis.every(Number.isFinite)||Math.abs(Math.hypot(...sensor.axis)-1)>1e-9)fail('INVALID_POWER_CONFIGURATION');
 const sources=config.receivers;
 const parent=new Map();
 const root=n=>{if(!parent.has(n))parent.set(n,n);if(parent.get(n)!==n)parent.set(n,root(parent.get(n)));return parent.get(n);};
 for(const [a,b] of config.wires)parent.set(root(a),root(b));
 for(const cell of config.cells)root(cell.node);
 for(const motor of config.motors)root(motor.node);
 const cellsFor=m=>config.cells.filter(c=>root(c.node)===root(m.node));
 for(const motor of config.motors)if(cellsFor(motor).length>1||config.motors.filter(m=>root(m.node)===root(motor.node)).length>1)fail('UNSUPPORTED_POWER_TOPOLOGY');
 for(const cell of config.cells)if(config.cells.filter(c=>root(c.node)===root(cell.node)).length>1)fail('UNSUPPORTED_POWER_TOPOLOGY');
 const signalFor=m=>config.signalWires.filter(edge=>edge[1]===m.node).map(edge=>sources.find(source=>source.node===edge[0]));
 for(const motor of config.motors){const signals=signalFor(motor);if(signals.length>1||signals.some(s=>!s))fail('UNSUPPORTED_SIGNAL_TOPOLOGY');}
 let state={cells:config.cells.map(c=>({node:c.node,energyJ:c.initialJ,heatJ:0})),sources:sources.map(s=>({node:s.node,duty:s.duty})),motors:config.motors.map(m=>({node:m.node,heatJ:0,driverHeatJ:0,shaftWorkJ:0,mechanicalEnergy:0,energyResidualJ:0,current:0,torque:0,electricalEnergy:0,reasonCode:'OFF'}))};
 function validateState(candidate){
  if(!candidate||Object.keys(candidate).sort().join(',')!=='cells,motors,sources'||!Array.isArray(candidate.cells)||!Array.isArray(candidate.sources)||!Array.isArray(candidate.motors)||candidate.cells.length!==config.cells.length||candidate.sources.length!==sources.length||candidate.motors.length!==config.motors.length)fail('INVALID_POWER_CHECKPOINT');
  candidate.cells.forEach((c,i)=>{if(Object.keys(c).sort().join(',')!=='energyJ,heatJ,node'||c.node!==config.cells[i].node||!finite(c.energyJ,c.heatJ)||c.heatJ<0||c.energyJ<0||c.energyJ>config.cells[i].capacityJ)fail('INVALID_POWER_CHECKPOINT');});
  candidate.sources.forEach((s,i)=>{if(Object.keys(s).sort().join(',')!=='duty,node'||s.node!==sources[i].node||!finite(s.duty)||Math.abs(s.duty)>1)fail('INVALID_POWER_CHECKPOINT');});
  candidate.motors.forEach((m,i)=>{if(Object.keys(m).sort().join(',')!=='current,driverHeatJ,electricalEnergy,energyResidualJ,heatJ,mechanicalEnergy,node,reasonCode,shaftWorkJ,torque'||m.node!==config.motors[i].node||!finite(m.heatJ,m.driverHeatJ,m.shaftWorkJ,m.mechanicalEnergy,m.energyResidualJ,m.current,m.torque,m.electricalEnergy)||m.driverHeatJ<0||m.heatJ<0||m.electricalEnergy<0||!['OFF','OK','NO_POWER','NO_SHAFT','DEPLETED'].includes(m.reasonCode))fail('INVALID_POWER_CHECKPOINT');});
 }
 validateState(state);
 let pending=null;
 return Object.freeze({
  step(dt,speeds,commands=[],inertias=[]) {
   if(pending)fail('POWER_STEP_PENDING');
   if(dt!==1/120)fail('INVALID_POWER_STEP');
   const next=clone(state);
   const seen=new Set();
   for(const command of commands){const source=next.sources.find(s=>s.node===command.node);if(!source||seen.has(command.node)||Object.keys(command).sort().join(',')!=='duty,node'||!finite(command.duty)||Math.abs(command.duty)>1)fail('INVALID_SIGNAL_COMMAND');seen.add(command.node);source.duty=command.duty;}
   const torques=[],allocations=[];
   for(const [i,motor] of config.motors.entries()){
    const record=next.motors[i],cell=cellsFor(motor)[0],energy=cell&&next.cells.find(c=>c.node===cell.node),source=signalFor(motor)[0];
    const duty=source?next.sources.find(s=>s.node===source.node).duty:motor.defaultDuty;
    const sample=speeds.find(s=>s.node===motor.node),inertiaSample=inertias.find(s=>s.node===motor.node);
    const inertia=inertiaSample?.inertia;
    if(!sample||!finite(sample.speed)||!finite(duty)||Math.abs(duty)>1)fail('INVALID_MOTOR_SAMPLE');
    let result={current:0,torque:0,heatEnergy:0,electricalEnergy:0},reasonCode='OK';
    if(motor.rotor<0||motor.joint<0)reasonCode='NO_SHAFT';
    else if(!cell)reasonCode='NO_POWER';
    else if(energy.energyJ<=0)reasonCode='DEPLETED';
    else if(duty===0)reasonCode='OFF';
    else {
     if(!finite(inertia)||inertia<=0)fail('INVALID_MOTOR_INERTIA');
     const voltage=cell.voltage*duty,resistance=motor.resistance+cell.resistance*duty*duty;
     const limit=Math.min(motor.currentLimit,cell.currentLimit/Math.abs(duty),energy.energyJ/(Math.abs(voltage)*dt));
     result=motorStep(voltage,sample.speed,motor.torqueConstant,resistance,limit,inertia,dt);
     energy.energyJ=Math.max(0,energy.energyJ-result.electricalEnergy);
     const cellHeat=cell.resistance*(result.current*duty)**2*dt;
     energy.heatJ+=cellHeat;
    }
    Object.assign(record,{current:result.current,torque:result.torque,electricalEnergy:result.electricalEnergy,mechanicalEnergy:0,reasonCode});
    allocations.push({speed:sample.speed,current:result.current,torque:result.torque,electricalEnergy:result.electricalEnergy,cellHeat:cell?cell.resistance*(result.current*duty)**2*dt:0,copperHeat:motor.resistance*result.current**2*dt});
    torques.push({body:motor.body,rotor:motor.rotor,joint:motor.joint,axis:[...motor.axis],value:result.torque});
   }
   validateState(next);pending={dt,next,allocations};return {torques};
  },
  completeStep(dt,receipts) {
   if(!pending||dt!==pending.dt)fail('INVALID_POWER_STEP');
   if(!Array.isArray(receipts)||receipts.length!==config.motors.length||new Set(receipts.map(s=>s.node)).size!==config.motors.length)fail('INVALID_MOTOR_SAMPLE');
   const next=clone(pending.next);
   for(const [i,motor] of config.motors.entries()) {
    const sample=receipts.find(s=>s.node===motor.node);
    if(!sample||!exact(sample,'node,speedBefore,speedAfter,workJ,kineticDeltaJ,kineticBeforeJ,kineticAfterJ')||!finite(sample.speedBefore,sample.speedAfter,sample.workJ,sample.kineticDeltaJ,sample.kineticBeforeJ,sample.kineticAfterJ)||sample.kineticBeforeJ<0||sample.kineticAfterJ<0)fail('INVALID_MOTOR_SAMPLE');
    const allocation=pending.allocations[i],record=next.motors[i];
    // The physics door measures the discrete kick before contacts/gravity.
    // The independent full-inertia KE receipt must agree with impulse work.
    const work=sample.workJ,expectedWork=allocation.torque*(sample.speedBefore+sample.speedAfter)*dt/2;
    const workTolerance=ENERGY_ABSOLUTE_TOLERANCE+ENERGY_RELATIVE_TOLERANCE*Math.max(Math.abs(work),Math.abs(expectedWork),allocation.electricalEnergy);
    const receiptTolerance=ENERGY_ABSOLUTE_TOLERANCE+ENERGY_RELATIVE_TOLERANCE*Math.max(Math.abs(work),Math.abs(sample.kineticDeltaJ),sample.kineticBeforeJ,sample.kineticAfterJ,allocation.electricalEnergy);
    if(Math.abs(sample.kineticDeltaJ-(sample.kineticAfterJ-sample.kineticBeforeJ))>receiptTolerance||Math.abs(work-expectedWork)>workTolerance||Math.abs(work-sample.kineticDeltaJ)>receiptTolerance||Math.abs(sample.speedBefore-allocation.speed)>ENERGY_RELATIVE_TOLERANCE*Math.max(1,Math.abs(allocation.speed)))fail('ENERGY_INVARIANT');
    const residual=allocation.electricalEnergy-allocation.cellHeat-allocation.copperHeat-work;
    const tolerance=ENERGY_ABSOLUTE_TOLERANCE+ENERGY_RELATIVE_TOLERANCE*Math.max(Math.abs(allocation.electricalEnergy),Math.abs(work),allocation.cellHeat+allocation.copperHeat);
    // The driver cannot supply extra voltage at either measured endpoint, even
    // when its averaged heat is positive. Express headroom in joules to use the
    // same explicit Float32 error budget at the kick endpoint. Later contact
    // redistribution belongs to the integration ledger, not the driver.
    const endpointWork=allocation.torque*sample.speedAfter*dt;
    const headroom=allocation.electricalEnergy-allocation.cellHeat-allocation.copperHeat-endpointWork;
    const endpointTolerance=ENERGY_ABSOLUTE_TOLERANCE+ENERGY_RELATIVE_TOLERANCE*Math.max(Math.abs(allocation.electricalEnergy),Math.abs(endpointWork),allocation.cellHeat+allocation.copperHeat);
    if(!finite(work,residual,headroom)||residual< -tolerance||headroom< -endpointTolerance)fail('ENERGY_INVARIANT');
    record.heatJ+=allocation.copperHeat;
    record.mechanicalEnergy=work;record.shaftWorkJ+=work;
    if(residual>=0)record.driverHeatJ+=residual;
    else record.energyResidualJ+=residual; // Explicit signed numerical remainder.
   }
   validateState(next);state=next;pending=null;return clone(state);
  },
  read:()=>clone(state),
  snapshot(){if(pending)fail('POWER_STEP_PENDING');return clone(state);},
  restore(snapshot){const next=clone(snapshot);validateState(next);state=next;pending=null;},
 });
}
