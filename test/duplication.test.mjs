import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart, validateBlueprint } from '../src/model/blueprint.mjs';
import { duplicatePart } from '../src/model/duplication.mjs';

function fixture(type='beam',position=[0,2,0]){
 const blueprint=createEmptyBlueprint('workshop','Workshop');
 blueprint.parts=[createPart(type,'original',position)];return blueprint;
}
test('duplicate preserves authored choices without mutating the original or copying connections',()=>{
 const blueprint=fixture('poweredMotor'),original=blueprint.parts[0];
 original.name='Custom motor';original.parameters.defaultDuty=-.7;original.parameters.currentLimit=8;
 original.authoredMaterial.body='rubber';original.rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];
 blueprint.parts.push(createPart('powerCell','cell',[4,2,0]));
 blueprint.connections.push({id:'wire',kind:'power',a:{part:'original',port:'power'},b:{part:'cell',port:'power'}});
 const before=structuredClone(blueprint),copy=duplicatePart(blueprint,'original','copy',[0,0,-8]);
 assert.deepEqual(copy,{...original,id:'copy',name:'Custom motor-2',position:[0,2,-1]});
 assert.deepEqual(blueprint,before);
 assert.equal(validateBlueprint({...blueprint,parts:[...blueprint.parts,copy]}).ok,true);
 copy.parameters.currentLimit=9;copy.authoredMaterial.body='steel';copy.rotation[0]=.2;
 assert.deepEqual(blueprint,before);
});
test('duplicate searches one metre increments and skips occupied positions',()=>{
 const blueprint=fixture();
 blueprint.parts.push(createPart('beam','obstacle',[1,2,0]));
 assert.deepEqual(duplicatePart(blueprint,'original','copy',[5,0,0]).position,[2,2,0]);
 assert.deepEqual(duplicatePart(fixture(),'original','copy',[3,0,4]).position,[.6,2,.8]);
});
test('rotated geometry of both selected and obstructing parts controls clearance',()=>{
 const blueprint=fixture();blueprint.parts[0].rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];
 blueprint.parts.push(createPart('beam','obstacle',[0,2,1.3]));
 blueprint.parts[1].rotation=[0,Math.SQRT1_2,0,Math.SQRT1_2];
 assert.deepEqual(duplicatePart(blueprint,'original','copy',[0,0,1]).position,[0,2,2]);
 blueprint.parts.forEach(part=>{part.rotation=[0,0,0,1];});
 assert.deepEqual(duplicatePart(blueprint,'original','copy',[0,0,1]).position,[0,2,1]);
});
test('invalid direction, unknown source, and duplicate or invalid identity fail explicitly',()=>{
 const blueprint=fixture();
 for(const direction of [[0,0,0],[NaN,0,1],[Infinity,0,0],[1,0],null])
  assert.throws(()=>duplicatePart(blueprint,'original','copy',direction),{reasonCode:'INVALID_VECTOR'});
 assert.throws(()=>duplicatePart(blueprint,'missing','copy',[1,0,0]),{reasonCode:'UNKNOWN_PART'});
 assert.throws(()=>duplicatePart(blueprint,'original','original',[1,0,0]),{reasonCode:'DUPLICATE_ID'});
 assert.throws(()=>duplicatePart(blueprint,'original','bad id',[1,0,0]),{reasonCode:'INVALID_BLUEPRINT'});
});
test('occupied search limit and blueprint position bounds never produce an overlapping or invalid copy',()=>{
 const blueprint=fixture();
 for(let i=1;i<=100;i++)blueprint.parts.push(createPart('beam',`obstacle-${i}`,[i,2,0]));
 assert.throws(()=>duplicatePart(blueprint,'original','copy',[1,0,0]),{reasonCode:'INVALID_COMMAND'});
 const edge=fixture('beam',[10000,2,0]);
 assert.throws(()=>duplicatePart(edge,'original','copy',[1,0,0]),{reasonCode:'INVALID_COMMAND'});
 assert.deepEqual(duplicatePart(edge,'original','copy',[-1,0,0]).position,[9999,2,0]);
});
test('long names still produce a valid authored copy and tiny finite directions normalize',()=>{
 const blueprint=fixture();blueprint.parts[0].name='x'.repeat(128);
 const copy=duplicatePart(blueprint,'original','copy',[1e-300,0,0]);
 assert.ok(copy.name.endsWith('-2'));assert.equal(copy.name.length,128);
 assert.deepEqual(copy.position,[1,2,0]);
 assert.equal(validateBlueprint({...blueprint,parts:[...blueprint.parts,copy]}).ok,true);
});
