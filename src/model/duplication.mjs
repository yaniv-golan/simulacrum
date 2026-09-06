import { CATALOG } from './catalog.mjs';
import { validateBlueprint } from './blueprint.mjs';

function reject(reasonCode,path=''){throw Object.assign(new TypeError(reasonCode),{reasonCode,path});}
function validate(blueprint){const result=validateBlueprint(blueprint);if(!result.ok)reject(result.reasonCode,result.path);}
function rotate(vector,rotation){
 const norm=Math.hypot(...rotation),[x,y,z,w]=rotation.map(value=>value/norm),[a,b,c]=vector;
 const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
 return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
// Enclose each primitive's local bounding box, including its authored frame.
// Cylinders use their enclosing boxes: placement may be conservative, never
// smaller than the canonical geometry. No collision-library state is consulted.
function bounds(part){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const primitive of CATALOG[part.type].primitives)for(let corner=0;corner<8;corner++){
  const local=primitive.halfExtents.map((extent,axis)=>extent*((corner&(1<<axis))?1:-1));
  const point=rotate(rotate(local,primitive.rotation).map((value,axis)=>value+primitive.position[axis]),part.rotation);
  for(let axis=0;axis<3;axis++){
   const value=point[axis]+part.position[axis];
   min[axis]=Math.min(min[axis],value);max[axis]=Math.max(max[axis],value);
  }
 }
 return {min,max};
}
function overlaps(a,b){return a.min.every((value,axis)=>value<=b.max[axis]+1e-10&&a.max[axis]+1e-10>=b.min[axis]);}

/** Return an independent, fully authored part for the ordinary insert command.
 * Direction is a world-space vector supplied by the caller (for example the
 * camera's horizontal facing). Search at most 100 one-metre increments.
 */
export function duplicatePart(blueprint,id,newId,direction){
 validate(blueprint);
 const original=blueprint.parts.find(part=>part.id===id);
 if(!original)reject('UNKNOWN_PART','id');
 if(blueprint.parts.some(part=>part.id===newId))reject('DUPLICATE_ID','newId');
 if(!Array.isArray(direction)||direction.length!==3||!direction.every(Number.isFinite))reject('INVALID_VECTOR','direction');
 const scale=Math.max(...direction.map(Math.abs));
 if(scale===0)reject('INVALID_VECTOR','direction');
 const scaled=direction.map(value=>value/scale),length=Math.hypot(...scaled),unit=scaled.map(value=>value/length);
 const copy=structuredClone(original);copy.id=newId;copy.name=`${original.name.slice(0,123)} Copy`;
 validate({...blueprint,parts:[...blueprint.parts,copy]});
 const occupied=blueprint.parts.map(bounds);
 for(let distance=1;distance<=100;distance++){
  copy.position=original.position.map((value,axis)=>value+unit[axis]*distance);
  // Use the authoritative schema's coordinate limits, not a second limit list.
  if(!validateBlueprint({...blueprint,parts:[copy],connections:[]}).ok)continue;
  const candidate=bounds(copy);
  if(!occupied.some(other=>overlaps(candidate,other)))return copy;
 }
 reject('INVALID_COMMAND','position');
}
