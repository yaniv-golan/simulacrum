import { createEmptyBlueprint, createPart } from './blueprint.mjs';
import { snapConnection } from './assembly.mjs';

/** Ordinary catalog parts and connections; no runtime behavior is selected here. */
export function createStarterVehicle({powered=true}={}) {
 let blueprint=createEmptyBlueprint('starter-vehicle','First rolling machine');
 blueprint.parts=[['chassis','frame'],['poweredMotor','motor'],['powerCell','cell'],['gripWheel','drive'],['passiveBearing','front-bearing'],['gripWheel','front-wheel'],['passiveBearing','rear-bearing'],['gripWheel','rear-wheel']].map(([type,id])=>createPart(type,id,[0,.105,0]));
 // Authored motor rating supplies the torque needed by the loaded wheel contacts.
 blueprint.parts[1].parameters.torqueConstant=.4;
 const names=['Chassis','Motor','Cell','Drive wheel','Front bearing','Front wheel','Rear bearing','Rear wheel'];
 blueprint.parts.forEach((part,i)=>{part.name=names[i];});
 function connect(a,b,kind){if(kind!=='power')blueprint=snapConnection(blueprint,a,b);blueprint.connections.push({id:`connection-${blueprint.connections.length}`,kind,a,b});}
 const face=(part,region,u=0,v=0)=>({part,surface:{region,u,v,twist:0}});
 connect(face('frame','right'),face('motor','left'),'fixed');connect({part:'motor',port:'shaft'},{part:'drive',port:'axle'},'shaft');
 connect(face('frame','top'),face('cell','bottom'),'fixed');
 connect(face('frame','left',0,-.18),face('front-bearing','left'),'fixed');connect({part:'front-bearing',port:'shaft'},{part:'front-wheel',port:'axle'},'shaft');
 connect(face('frame','left',0,.18),face('rear-bearing','left'),'fixed');connect({part:'rear-bearing',port:'shaft'},{part:'rear-wheel',port:'axle'},'shaft');
 if(powered)connect({part:'cell',port:'power'},{part:'motor',port:'power'},'power');
 return blueprint;
}
