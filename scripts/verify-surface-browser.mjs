import {chromium} from 'playwright';
import * as THREE from 'three';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createEmptyBlueprint,createPart} from '../src/model/blueprint.mjs';
const out='artifacts/surface-browser';mkdirSync(out,{recursive:true});
const fixture={...createEmptyBlueprint('surface-test','Surface test'),parts:[createPart('chassis','base',[0,.35,0]),createPart('poweredMotor','motor',[.45,.35,0])]};writeFileSync(`${out}/fixture.json`,JSON.stringify(fixture));
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()));
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:4173/');
 await page.locator('[data-part-type=poweredMotor]').click();
 assert.equal(await page.getByRole('button',{name:'Snap to surface',exact:true}).count(),1,'selected motor must expose surface placement');
 await page.locator('input[type=file]').setInputFiles(`${out}/fixture.json`);
 const read=()=>page.evaluate(()=>window.workshopProbe.observe().frames[0].metadata.blueprint);
 async function select(id){if(!await page.locator('.machine-picker').evaluate(e=>e.open))await page.locator('.machine-picker > summary').click();await page.locator(`.part-list [data-part-id="${id}"]`).click();}
 await select('motor');const before=await read();
 await page.getByRole('button',{name:'Snap to surface',exact:true}).click();
 assert.equal(await page.getByLabel('Mounting face').count(),1);await page.locator('.surface-precise summary').click();
 await page.getByLabel('Target surface').selectOption(JSON.stringify(['base','top']));
 assert.deepEqual(await read(),before,'preview must leave authored state unchanged');
 await page.getByLabel('Along surface (mm)').fill('500');
 assert.equal(await page.locator('[data-command=apply-surface]').isDisabled(),true,'overhanging pad refuses');
 assert.match(await page.locator('.surface-placement [role=status]').innerText(),/extends beyond/);
 await page.getByLabel('Along surface (mm)').fill('50');
 assert.equal(await page.locator('[data-command=apply-surface]').isDisabled(),false);
 const previewUI=await page.evaluate(()=>window.workshopProbe.readInteractionState()),camera=new THREE.PerspectiveCamera(previewUI.camera.fov,previewUI.camera.aspect,.01,100);camera.position.fromArray(previewUI.camera.position);camera.lookAt(new THREE.Vector3(...previewUI.camera.target));camera.updateMatrixWorld();const previewPoint=new THREE.Vector3(...previewUI.surfacePlacement.previewParts[0].position).project(camera),canvas=await page.locator('canvas[aria-label="Machine view"]').boundingBox(),px=canvas.x+(previewPoint.x*.5+.5)*canvas.width,py=canvas.y+(-previewPoint.y*.5+.5)*canvas.height;
 await page.mouse.move(px,py);await page.mouse.down();await page.mouse.move(px+20,py,{steps:6});await page.mouse.up();const draggedUI=await page.evaluate(()=>window.workshopProbe.readInteractionState());assert.deepEqual(draggedUI.camera,previewUI.camera,'dragging preview must not orbit camera');assert.notDeepEqual([draggedUI.surfacePlacement.u,draggedUI.surfacePlacement.v],[previewUI.surfacePlacement.u,previewUI.surfacePlacement.v],'dragging preview slides on face');assert.deepEqual(await read(),before);await page.getByLabel('Along surface (mm)').fill('50');await page.getByLabel('Across surface (mm)').fill('0');
 await page.screenshot({path:`${out}/preview.png`});
 await page.locator('[data-command=apply-surface]').click();
 const mounted=await read();assert.equal(mounted.connections.length,1);assert.deepEqual(mounted.parts[0],before.parts[0]);
 assert.match(await page.locator('.mount-status').innerText(),/Bolted to Chassis · Top/);
 await page.getByRole('button',{name:'Adjust mount',exact:true}).click();if(!await page.locator('.surface-precise').evaluate(e=>e.open))await page.locator('.surface-precise summary').click();await page.getByLabel('Across surface (mm)').fill('50');
 await page.locator('[data-command=apply-surface]').click();const adjusted=await read();assert.notDeepEqual(adjusted.parts[1],mounted.parts[1]);assert.deepEqual(adjusted.parts[0],mounted.parts[0]);
 await page.locator('[data-command=undo]').click();assert.deepEqual(await read(),mounted);
 await page.getByRole('button',{name:'Adjust mount',exact:true}).click();if(!await page.locator('.surface-precise').evaluate(e=>e.open))await page.locator('.surface-precise summary').click();await page.getByLabel('Across surface (mm)').fill('40');await page.keyboard.press('Escape');assert.deepEqual(await read(),mounted);
 await page.getByRole('button',{name:'Detach',exact:true}).click();
 await page.getByRole('button',{name:'Snap to surface',exact:true}).click();await page.getByLabel('Target surface').selectOption(JSON.stringify(['base','bottom']));await page.locator('[data-command=apply-surface]').click();
 const underside=await read();assert.ok(underside.parts[1].position[1]<underside.parts[0].position[1]);assert.equal(underside.connections[0].a.surface.region,'bottom');
 await page.screenshot({path:`${out}/underside.png`});
 const rendered=await page.evaluate(()=>window.workshopProbe.readRenderedTransforms());const observation=await page.evaluate(()=>window.workshopProbe.observe().frames[0]);for(const [i,p] of observation.metadata.blueprint.parts.entries()){assert.deepEqual(rendered.find(r=>r.id===p.id).position,observation.physics[i].position);}
 await page.getByRole('button',{name:'Detach',exact:true}).click();await page.getByRole('button',{name:'Snap to surface',exact:true}).click();await page.getByLabel('Target surface').selectOption(JSON.stringify(['base','top']));await page.getByLabel('Attach after snapping').uncheck();await page.locator('[data-command=apply-surface]').click();assert.equal((await read()).connections.length,0);
 assert.deepEqual(errors,[]);
 writeFileSync(`${out}/result.json`,JSON.stringify({build:await page.locator('meta[name=build-id]').getAttribute('content'),checks:['surface control','read-only preview','invalid overhang','top attachment','adjust and undo','cancel','underside attachment','render agrees with physics','place without attachment'],errors},null,2));
 console.log('surface browser passed');
}finally{await browser.close();}
