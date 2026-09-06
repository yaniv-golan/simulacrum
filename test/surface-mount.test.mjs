import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmptyBlueprint,createPart,loadSave,validateBlueprint} from '../src/model/blueprint.mjs';
import {proposeSurfaceMount,compileAssembly} from '../src/model/assembly.mjs';
import {surfaceRegions} from '../src/model/surfaces.mjs';
const fixture=()=>({...createEmptyBlueprint('test','Test'),parts:[createPart('chassis','base',[0,1,0]),createPart('poweredMotor','motor',[1,1,0])]});
test('surface mounts seat on top, underside and side as ordinary fixed joints',()=>{
 for(const [targetRegion,rotation] of [['top',[0,0,0,1]],['bottom',[0,0,0,1]],['top',[0,0,Math.SQRT1_2,Math.SQRT1_2]]]){
 const bp=fixture();bp.parts[0].rotation=rotation;const out=proposeSurfaceMount(bp,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion,u:0,v:0,twist:0,id:'mount'});
 assert.equal(out.blueprint.version,3);assert.deepEqual(out.blueprint.parts[0],bp.parts[0]);assert.equal(compileAssembly(out.blueprint).configuration.joints.length,1);assert.equal(compileAssembly(out.blueprint).connections[0].reasonCode,'OK');
 }
});
test('invalid region and hanging mounting pad refuse without mutation',()=>{
 const bp=fixture(),before=structuredClone(bp);
 assert.throws(()=>proposeSurfaceMount(bp,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',u:4,v:0,twist:0,id:'mount'}),/SURFACE_OUT_OF_BOUNDS/);
 assert.throws(()=>proposeSurfaceMount(bp,{part:'motor',sourceRegion:'shaft',targetPart:'base',targetRegion:'top',u:0,v:0,twist:0,id:'mount'}),/UNKNOWN_SURFACE/);assert.deepEqual(bp,before);
});
test('old save versions refuse without migration',()=>{const bp=fixture();for(const version of [1,2]){bp.version=version;assert.equal(loadSave(bp).reasonCode,'SAVE_VERSION_BELOW_FLOOR');}});
test('loaded surface pad cannot overhang even with its endpoint inside the face',()=>{
 const out=proposeSurfaceMount(fixture(),{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',id:'mount'}).blueprint;
 out.connections[0].a.surface.u=.13;assert.equal(validateBlueprint(out).reasonCode,'SURFACE_OUT_OF_BOUNDS');
});
test('obstacle collision refuses while nearby empty space accepts',()=>{
 const bp=fixture();bp.parts.push(createPart('powerCell','obstacle',[0,1.13,0]));
 assert.throws(()=>proposeSurfaceMount(bp,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',id:'mount'}),/SURFACE_OVERLAP/);
 bp.parts.at(-1).position=[3,3,3];assert.equal(proposeSurfaceMount(bp,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',id:'mount'}).blueprint.connections.length,1);
});
test('core mount is atomic, stale guarded, adjustable and undoable',async()=>{
 const {createWorkshop}=await import('../src/core/workshop.mjs');const core=await createWorkshop(fixture());
 try{
 const before=core.save(),cursor=core.observe().cursor,command={type:'surface-mount',part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',u:0,v:0,twist:0,id:'mount',expectedCursor:cursor};
 assert.equal((await core.act(command)).ok,true);const mounted=core.save();
 assert.equal((await core.act(command)).reasonCode,'STALE_PROPOSAL');assert.deepEqual(core.save(),mounted);
 assert.equal((await core.act({...command,expectedCursor:core.observe().cursor,replaceConnection:'mount',u:.025})).ok,true);assert.deepEqual(core.save().parts[0],before.parts[0]);assert.notDeepEqual(core.save().parts[1].position,mounted.parts[1].position);
 assert.equal((await core.act({type:'undo'})).ok,true);assert.deepEqual(core.save(),mounted);
 assert.equal((await core.act({type:'undo'})).ok,true);assert.deepEqual(core.save(),before);
 }finally{core.dispose();}
});
test('source mounting pad remains exclusive on loaded saves',()=>{
 const bp=proposeSurfaceMount(fixture(),{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',id:'mount'}).blueprint;
 bp.parts.push(createPart('chassis','other',[3,1,0]));bp.connections.push({...structuredClone(bp.connections[0]),id:'duplicate',a:{part:'other',surface:{region:'top',u:0,v:0,twist:0}}});
 assert.equal(validateBlueprint(bp).reasonCode,'PORT_OCCUPIED');
});
test('adjust moves shaft-connected wheel and retains wire; loops refuse',async()=>{
 const {snapConnection}=await import('../src/model/assembly.mjs');let bp=fixture();bp.parts.push(createPart('gripWheel','wheel',[2,1,0]),createPart('powerCell','cell',[4,1,0]));
 bp=snapConnection(bp,{part:'motor',port:'shaft'},{part:'wheel',port:'axle'});bp.connections.push({id:'axle',kind:'shaft',a:{part:'motor',port:'shaft'},b:{part:'wheel',port:'axle'}},{id:'power',kind:'power',a:{part:'cell',port:'power'},b:{part:'motor',port:'power'}});
 const mounted=proposeSurfaceMount(bp,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',u:.05,id:'mount'}).blueprint;
 const moved=proposeSurfaceMount(mounted,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',u:.06,id:'mount',replaceConnection:'mount'});
 assert.equal(loadSave(moved.blueprint).ok,true);assert.equal(compileAssembly(moved.blueprint).configuration.joints.length,2);assert.deepEqual(moved.movingPartIds,['motor','wheel']);assert.deepEqual(moved.blueprint.parts[0],mounted.parts[0]);assert.deepEqual(moved.blueprint.connections.find(c=>c.id==='power'),mounted.connections.find(c=>c.id==='power'));
 mounted.connections.push({id:'extra',kind:'fixed',a:{part:'base',surface:{region:'left',u:0,v:0,twist:0}},b:{part:'wheel',surface:{region:'right',u:0,v:0,twist:0}}});
 assert.throws(()=>proposeSurfaceMount(mounted,{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',u:.05,id:'mount',replaceConnection:'mount'}),/MOUNT_HELD_BY_ANOTHER_CONNECTION/);
});
test('saved mounted geometry refuses intersecting obstacle but preserves unrelated loose overlap',()=>{
 const mounted=proposeSurfaceMount(fixture(),{part:'motor',sourceRegion:'bottom',targetPart:'base',targetRegion:'top',id:'mount'}).blueprint;
 mounted.parts.push(createPart('powerCell','obstacle',[0,1.08,0]));assert.equal(loadSave(mounted).reasonCode,'SURFACE_OVERLAP');assert.throws(()=>compileAssembly(mounted),/SURFACE_OVERLAP/);
 mounted.parts.at(-1).position=[3,1,0];assert.equal(loadSave(mounted).ok,true);
 mounted.connections=[];mounted.parts.at(-1).position=[0,1.08,0];assert.equal(loadSave(mounted).ok,true);
});
test('fixed socket endpoints are not an alternative mounting path',()=>{const bp=fixture();bp.connections.push({id:'bad',kind:'fixed',a:{part:'base',port:'top'},b:{part:'motor',port:'mount'}});assert.equal(validateBlueprint(bp).ok,false);});
