import { immutableCopy } from '../model/observation.mjs';
// M3 host-side test doubles only. This dispatcher restricts passed capabilities;
// trusted callbacks still execute in the host and are NOT a sandbox or fuel gate.
const fail=code=>{throw new Error(code);};
const node=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function data(value,code){try{return immutableCopy(value);}catch{fail(code);}}
export function createControllerDispatcher(powerConfig,programs) {
 const code='INVALID_CONTROLLER_CONFIGURATION';
 if(!powerConfig||!['controllers','receivers','sensors','signalWires'].every(key=>Array.isArray(powerConfig[key])&&powerConfig[key].length<=8192))fail(code);
 const config=data({controllers:powerConfig.controllers,receivers:powerConfig.receivers,sensors:powerConfig.sensors,signalWires:powerConfig.signalWires},code);
 const declared=new Map();
 for(const kind of ['controllers','receivers','sensors'])for(const item of config[kind]){
  if(!item||!node(item.node)||declared.has(item.node))fail(code);declared.set(item.node,kind);
 }
 const wires=new Set();
 for(const wire of config.signalWires){if(!Array.isArray(wire)||wire.length!==2||!wire.every(node)||wire[0]===wire[1]||wires.has(`${wire[0]}:${wire[1]}`))fail(code);wires.add(`${wire[0]}:${wire[1]}`);}
 if(!Array.isArray(programs)||programs.length>config.controllers.length)fail('INVALID_CONTROLLER_PROGRAM');
 const used=new Set();
 const compiled=programs.map(program=>{
  if(!exact(program,['node','run'])||declared.get(program.node)!=='controllers'||used.has(program.node)||typeof program.run!=='function')fail('INVALID_CONTROLLER_PROGRAM');
  used.add(program.node);
  return {run:program.run,inputs:config.sensors.filter(sensor=>wires.has(`${sensor.node}:${program.node}`)).map(sensor=>sensor.node),outputs:new Set(config.receivers.filter(receiver=>wires.has(`${program.node}:${receiver.node}`)).map(receiver=>receiver.node))};
 });
 return Object.freeze({run(snapshot){
  const previous=data(snapshot,'INVALID_CONTROLLER_SNAPSHOT');
  if(!exact(previous,['tick','readings'])||!Number.isSafeInteger(previous.tick)||previous.tick<0||!Array.isArray(previous.readings)||previous.readings.length>config.sensors.length)fail('INVALID_CONTROLLER_SNAPSHOT');
  const readings=new Map();
  for(const reading of previous.readings){if(!exact(reading,['node','speed'])||declared.get(reading.node)!=='sensors'||!Number.isFinite(reading.speed)||readings.has(reading.node))fail('INVALID_CONTROLLER_SNAPSHOT');readings.set(reading.node,reading.speed);}
  const views=compiled.map(program=>{
   if(program.inputs.some(input=>!readings.has(input)))fail('INVALID_CONTROLLER_SNAPSHOT');
   return data({tick:previous.tick,inputs:program.inputs.map(input=>({node:input,speed:readings.get(input)}))},'INVALID_CONTROLLER_SNAPSHOT');
  });
  const result=[],written=new Set();
  for(const [index,program] of compiled.entries()){
   const output=data(Reflect.apply(program.run,undefined,[views[index]]),'INVALID_CONTROLLER_OUTPUT');
   if(!Array.isArray(output)||output.length>program.outputs.size)fail('INVALID_CONTROLLER_OUTPUT');
   for(const command of output){if(!exact(command,['node','duty'])||!program.outputs.has(command.node)||written.has(command.node)||!Number.isFinite(command.duty)||Math.abs(command.duty)>1)fail('INVALID_CONTROLLER_OUTPUT');written.add(command.node);result.push({node:command.node,duty:command.duty});}
  }
  return immutableCopy(result);
 }});
}
