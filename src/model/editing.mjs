import { validateBlueprint } from './blueprint.mjs';
function reject(reasonCode,path){throw Object.assign(Error(reasonCode),{reasonCode,path});}
// Authoring transforms operate on the mechanical component, never on live physics.
export function transformGroup(blueprint,id,position,rotation) {
 const original=blueprint.parts.find(part=>part.id===id);
 if(!original)reject('UNKNOWN_PART','id');
 const next=structuredClone(blueprint),target=next.parts.find(part=>part.id===id);
 target.position=position;target.rotation=rotation;
 const validation=validateBlueprint(next);if(!validation.ok)reject(validation.reasonCode,validation.path);
 const normalize=q=>{const n=Math.hypot(...q);return q.map(v=>v/n);};
 const inverse=q=>[-q[0],-q[1],-q[2],q[3]];
 const multiply=(a,b)=>{const [x,y,z,w]=a,[X,Y,Z,W]=b;return [w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];};
 const delta=normalize(multiply(normalize(rotation),inverse(normalize(original.rotation))));
 const group=new Set(mechanicalGroup(blueprint,id));
 for(const part of next.parts)if(part.id!==id&&group.has(part.id)){
  const offset=part.position.map((v,i)=>v-original.position[i]);
  const moved=multiply(multiply(delta,[...offset,0]),inverse(delta));
  part.position=position.map((v,i)=>v+moved[i]);part.rotation=normalize(multiply(delta,normalize(part.rotation)));
 }
 return next;
}

// Shared by authoring transforms and their visible manipulation scope.
export function mechanicalGroup(blueprint,id) {
 if(!blueprint.parts.some(part=>part.id===id))return [];
 const group=new Set([id]);let changed=true;
 while(changed){changed=false;for(const edge of blueprint.connections)if(['fixed','shaft'].includes(edge.kind)&&(group.has(edge.a.part)||group.has(edge.b.part)))for(const member of [edge.a.part,edge.b.part])if(!group.has(member)){group.add(member);changed=true;}}
 return [...group];
}
