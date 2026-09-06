import { surfaceRegions, resolveSurfaceEndpoint, rotateVector, placementEnvelopes, solidsOverlap, validateSurfaceGeometry } from './surfaces.mjs';
import { CATALOG, MATERIALS } from './catalog.mjs';
import { validateBlueprint } from './blueprint.mjs';
import { BUILD_ENVIRONMENT } from './environment.mjs';
import { immutableCopy } from './observation.mjs';

export const ASSEMBLY_REASON_CODES = Object.freeze(['INCOMPATIBLE_CONNECTION_LOOP','INVALID_GRAVITY','INVALID_GROUND','INVALID_ENDPOINT','SELF_CONNECTION','PORT_OCCUPIED','MISALIGNED','UNSUPPORTED_SHAFT_TOPOLOGY']);
function reject(reasonCode,path) { const error=new Error(reasonCode);error.reasonCode=reasonCode;error.path=path;throw error; }
function validate(blueprint) {const result=validateBlueprint(blueprint);if(!result.ok)reject(result.reasonCode,result.path);}
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const subtract=(a,b)=>a.map((x,i)=>x-b[i]);
const inverse=q=>[-q[0],-q[1],-q[2],q[3]];
function multiply(a,b) {
 const [x,y,z,w]=a,[X,Y,Z,W]=b;
 return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];
}
const rotate=(q,v)=>multiply(multiply(q,[...v,0]),inverse(q)).slice(0,3);
const normalize=q=>{const norm=Math.hypot(...q);return q.map(v=>v/norm);};
function endpoint(blueprint,binding,path) {
 if(!binding||typeof binding!=='object'||!['part,port','part,surface'].includes(Object.keys(binding).sort().join(',')))reject('INVALID_ENDPOINT',path);
 const index=blueprint.parts.findIndex(p=>p.id===binding.part);
 if(index<0)reject('INVALID_ENDPOINT',`${path}.part`);
 const part=blueprint.parts[index],port=binding.surface?resolveSurfaceEndpoint(part,binding):CATALOG[part.type].ports.find(p=>p.id===binding.port);
 if(!port)reject('INVALID_ENDPOINT',`${path}.port`);
 return {index,part,port};
}
function worldPort({part,port}) {
 const rotation=normalize(part.rotation);
 return {position:add(part.position,rotate(rotation,port.position)),rotation:normalize(multiply(rotation,port.rotation))};
}
const matingRotation=port=>port.kind==='fixed'?[0,1,0,0]:[0,0,0,1];
/** Surface normals oppose; shaft frames coincide. Connected groups move rigidly. */
export function snapConnection(blueprint,a,b) {
 validate(blueprint);
 const A=endpoint(blueprint,a,'a'),B=endpoint(blueprint,b,'b');
 if(A.index===B.index)reject('SELF_CONNECTION','b.part');
 if(!['fixed','shaft'].includes(A.port.kind))return structuredClone(blueprint);
 const target=worldPort(A),rotation=normalize(multiply(multiply(target.rotation,matingRotation(A.port)),inverse(B.port.rotation)));
 const position=subtract(target.position,rotate(rotation,B.port.position));
 const group=new Set([B.part.id]);let changed=true;
 while(changed){changed=false;for(const edge of blueprint.connections){if(!['fixed','shaft'].includes(edge.kind))continue;if(group.has(edge.a.part)||group.has(edge.b.part)){for(const id of [edge.a.part,edge.b.part])if(!group.has(id)){group.add(id);changed=true;}}}}
 if(group.has(A.part.id)){
  const gap=Math.hypot(...subtract(position,B.part.position)),dot=Math.abs(rotation.reduce((sum,v,i)=>sum+v*normalize(B.part.rotation)[i],0));
  if(gap>1e-6||1-Math.min(1,dot)>1e-10)reject('INCOMPATIBLE_CONNECTION_LOOP','b');
  return structuredClone(blueprint);
 }
 const delta=normalize(multiply(rotation,inverse(normalize(B.part.rotation))));
 const result=structuredClone(blueprint);
 for(const part of result.parts)if(group.has(part.id)){part.position=add(position,rotate(delta,subtract(part.position,B.part.position)));part.rotation=normalize(multiply(delta,normalize(part.rotation)));}
 return result;
}
/** Numeric configuration crosses the physics door; identifiers stay in mapping. */
export function compileAssembly(blueprint,{gravity=BUILD_ENVIRONMENT.gravity,ground=BUILD_ENVIRONMENT.ground}={}) {
 validate(blueprint);
 validateSurfaceGeometry(blueprint);
 try {gravity=immutableCopy(gravity);}catch{reject('INVALID_GRAVITY','gravity');}
 const vector=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
 if(!vector(gravity))reject('INVALID_GRAVITY','gravity');
 try {ground=immutableCopy(ground);}catch{reject('INVALID_GROUND','ground');}
 if(ground!==null&&(!ground||Array.isArray(ground)||Object.keys(ground).sort().join(',')!=='friction,halfExtents,position,restitution'||!vector(ground.position)||!vector(ground.halfExtents)||!ground.halfExtents.every(v=>v>0)||!Number.isFinite(ground.friction)||ground.friction<0||!Number.isFinite(ground.restitution)||ground.restitution<0||ground.restitution>1))reject('INVALID_GROUND','ground');
 const mapping=[];
 const bodies=blueprint.parts.map(part=>{
  const primitive=CATALOG[part.type].primitives[0];
  const material=MATERIALS[part.authoredMaterial[primitive.id]??primitive.materialKey];
  mapping.push({part:part.id,shape:primitive.id,materialHandle:material.handle});
  // Cylinders use the local X axis; halfExtents is [half length, radius, radius].
  const volume=primitive.kind==='cylinder'?2*Math.PI*primitive.halfExtents[0]*primitive.halfExtents[1]**2:8*primitive.halfExtents.reduce((a,b)=>a*b,1);
  return {shape:primitive.kind,position:[...part.position],rotation:normalize(part.rotation),velocity:[0,0,0],mass:volume*material.density,halfExtents:[...primitive.halfExtents],fixed:false,friction:material.friction,restitution:material.restitution};
 });
 const connections=[],joints=[];
 const power={cells:[],motors:[],wires:[],signalWires:[],receivers:[],controllers:[],sensors:[]};
 for(const [node,part] of blueprint.parts.entries()) {
  const p=part.parameters;
  switch(part.type){
   case 'powerCell':power.cells.push({node,voltage:p.voltage,capacityJ:p.capacityJ,initialJ:p.capacityJ,resistance:p.internalResistance,currentLimit:p.currentLimit});break;
   case 'poweredMotor':power.motors.push({node,body:node,rotor:-1,joint:-1,axis:[1,0,0],torqueConstant:p.torqueConstant,resistance:p.resistance,currentLimit:p.currentLimit,defaultDuty:p.defaultDuty});break;
   case 'commandReceiver':power.receivers.push({node,duty:p.duty});break;
   case 'logicController':power.controllers.push({node,duty:p.duty});break;
   case 'rotationSensor':power.sensors.push({node,body:node,axis:[0,1,2].map(i=>i===p.axis?1:0)});break;
  }
 }
 for(const [i,connection] of blueprint.connections.entries()) {
  const path=`connections[${i}]`,A=endpoint(blueprint,connection.a,`${path}.a`),B=endpoint(blueprint,connection.b,`${path}.b`);
  if(A.index===B.index)reject('SELF_CONNECTION',`${path}.b.part`);
  if(connection.kind==='power'){power.wires.push([A.index,B.index]);connections.push({id:connection.id,reasonCode:'OK'});continue;}
  if(connection.kind==='signal'){
   power.signalWires.push(A.port.direction==='output'?[A.index,B.index]:[B.index,A.index]);connections.push({id:connection.id,reasonCode:'OK'});continue;
  }
  const a=worldPort(A),b=worldPort(B),distance=Math.hypot(...subtract(a.position,b.position));
  const expected=normalize(multiply(a.rotation,matingRotation(A.port)));
  const dot=Math.abs(expected.reduce((sum,v,j)=>sum+v*b.rotation[j],0));
  if(distance>1e-6||1-Math.min(1,dot)>1e-10){connections.push({id:connection.id,reasonCode:'MISALIGNED'});continue;}
  connections.push({id:connection.id,reasonCode:'OK'});
  const motorA=power.motors.find(m=>m.node===A.index),motorB=power.motors.find(m=>m.node===B.index);
  if(connection.kind==='shaft'&&(motorA||motorB)){
   if(motorA&&motorB)reject('UNSUPPORTED_SHAFT_TOPOLOGY',path);
   const motor=motorA??motorB,M=motorA?A:B,R=motorA?B:A;
   motor.rotor=R.index;motor.joint=joints.length;
   joints.push({kind:'revolute',a:M.index,b:R.index,anchorA:[...M.port.position],anchorB:[...R.port.position],axisA:rotate(M.port.rotation,[1,0,0]),axisB:rotate(R.port.rotation,[1,0,0])});
  }else if(connection.kind==='shaft'&&(A.port.joint==='revolute'||B.port.joint==='revolute')){
   joints.push({kind:'revolute',a:A.index,b:B.index,anchorA:[...A.port.position],anchorB:[...B.port.position],axisA:rotate(A.port.rotation,[1,0,0]),axisB:rotate(B.port.rotation,[1,0,0])});
  }else{
   joints.push({kind:'fixed',a:A.index,b:B.index,anchorA:[...A.port.position],anchorB:[...B.port.position],rotationA:[...A.port.rotation],rotationB:normalize(multiply(B.port.rotation,matingRotation(B.port)))});
  }
 }
 // Environment bodies follow authored bodies so every part and network index stays stable.
 if(ground!==null)bodies.push({shape:'box',position:[...ground.position],rotation:[0,0,0,1],velocity:[0,0,0],mass:1,halfExtents:[...ground.halfExtents],fixed:true,friction:ground.friction,restitution:ground.restitution});
 return {configuration:{gravity:[...gravity],bodies,joints,power},mapping,connections};
}

/** Same pure authoring proposal feeds preview and atomic commit. No simulation writes. */
export function proposeSurfaceMount(blueprint,{part,sourceRegion,targetPart,targetRegion,u=0,v=0,twist=0,id,replaceConnection,attach=true,insertPart}={}){
 validate(blueprint);
 let next=structuredClone(blueprint);next.version=3;
 if(insertPart){if(insertPart.id!==part)reject('INVALID_ENDPOINT','insertPart');next.parts.push(structuredClone(insertPart));validate(next);}
 if(replaceConnection){const connection=next.connections.find(c=>c.id===replaceConnection);if(!connection||connection.kind!=='fixed'||![connection.a.part,connection.b.part].includes(part))reject('INVALID_ENDPOINT','replaceConnection');next.connections=next.connections.filter(c=>c.id!==replaceConnection);}
 const source=next.parts.find(p=>p.id===part),target=next.parts.find(p=>p.id===targetPart);
 if(!source||!target)reject('UNKNOWN_PART','part');
 const sourceFace=surfaceRegions(source).find(r=>r.id===sourceRegion),targetFace=surfaceRegions(target).find(r=>r.id===targetRegion);
 if(!sourceFace||!targetFace)reject('UNKNOWN_SURFACE','region');
 if(![u,v,twist].every(Number.isFinite))reject('SURFACE_OUT_OF_BOUNDS','surface');
 const width=Math.abs(Math.cos(twist))*sourceFace.padHalfSize[0]+Math.abs(Math.sin(twist))*sourceFace.padHalfSize[1];
 const height=Math.abs(Math.sin(twist))*sourceFace.padHalfSize[0]+Math.abs(Math.cos(twist))*sourceFace.padHalfSize[1];
 if(Math.abs(u)+width>targetFace.halfSize[0]+1e-9||Math.abs(v)+height>targetFace.halfSize[1]+1e-9)reject('SURFACE_OUT_OF_BOUNDS','surface');
 const moving=new Set([part]);let changed=true;
 while(changed){changed=false;for(const c of next.connections)if(['fixed','shaft'].includes(c.kind)&&(moving.has(c.a.part)||moving.has(c.b.part)))for(const member of [c.a.part,c.b.part])if(!moving.has(member)){moving.add(member);changed=true;}}
 if(moving.has(targetPart))reject('MOUNT_HELD_BY_ANOTHER_CONNECTION','targetPart');
 const a={part:targetPart,surface:{region:targetRegion,u,v,twist}},b={part,surface:{region:sourceRegion,u:0,v:0,twist:0}};
 next=snapConnection(next,a,b);
 for(const moved of next.parts.filter(p=>moving.has(p.id)))for(const fixed of next.parts.filter(p=>!moving.has(p.id)))if(placementEnvelopes(moved).some(a=>placementEnvelopes(fixed).some(b=>solidsOverlap(a,b))))reject('SURFACE_OVERLAP',fixed.id);
 if(attach)next.connections.push({id,kind:'fixed',a,b});
 validate(next);return {blueprint:next,movingPartIds:[...moving]};
}
