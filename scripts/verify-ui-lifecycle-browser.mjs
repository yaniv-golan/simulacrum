import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {appFingerprint} from './app-fingerprint.mjs';
import {sourceIdentity} from './source-identity.mjs';

const out='artifacts/ui-lifecycle';mkdirSync(out,{recursive:true});
const source=sourceIdentity(),expectedBuild=appFingerprint(),browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
page.setDefaultTimeout(10000);
const read=()=>page.evaluate(()=>({blueprint:window.workshopProbe.observe().frames[0].metadata.blueprint,ui:window.workshopProbe.readInteractionState()}));
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.workshopProbe);
 const build=await page.locator('meta[name=build-id]').getAttribute('content');assert.equal(build,expectedBuild,'served build must equal the current app fingerprint');
 await page.locator('.more-parts > summary').click();await page.locator('[data-part-type=chassis]').click();
 const canvas=page.locator('canvas').first(),box=await canvas.boundingBox();
 const center=await page.evaluate(()=>window.workshopProbe.readRenderedCenters()[0]);
 const x=box.x+(center.x*.5+.5)*box.width,y=box.y+(-center.y*.5+.5)*box.height;
 async function startDrag(type){const card=await page.locator(`[data-part-type=${type}]`).boundingBox();await page.mouse.move(card.x+card.width/2,card.y+card.height/2);await page.mouse.down();await page.mouse.move(x,y,{steps:20});}
 await startDrag('poweredMotor');assert.ok((await read()).ui.surfacePlacement);
 await page.mouse.move(20,850,{steps:10});await page.mouse.up();assert.equal((await read()).ui.surfacePlacement,null,'outside cancellation releases the palette candidate');
 await startDrag('powerCell');await page.mouse.up();await page.waitForFunction(()=>window.workshopProbe.observe().frames[0].metadata.blueprint.parts.length===2);
 const placed=await read();assert.equal(placed.blueprint.parts[1].type,'powerCell','new drag inserts the newly requested part');
 // Positive completion above; Escape must also leave no palette candidate.
 await startDrag('poweredMotor');await page.keyboard.press('Escape');await page.mouse.up();assert.equal((await read()).ui.surfacePlacement,null);assert.equal((await read()).blueprint.parts.length,2);
 // Explicit surface placement uses a different pointer path than direct body dragging.
 await page.locator('[data-part-type=poweredMotor]').click();await page.getByRole('button',{name:'Snap to surface',exact:true}).click();
 const frameBefore=await read();const base=frameBefore.blueprint.parts.find(p=>p.type==='chassis');
 await page.getByLabel('Target surface',{exact:true}).selectOption(JSON.stringify([base.id,'top']));
 const centers=await page.evaluate(()=>window.workshopProbe.readRenderedCenters());const baseCenter=centers.find(p=>p.id===base.id),currentBox=await canvas.boundingBox();
 const bx=currentBox.x+(baseCenter.x*.5+.5)*currentBox.width,by=currentBox.y+(-baseCenter.y*.5+.5)*currentBox.height;
 await page.mouse.move(bx,by);await page.mouse.down();await canvas.dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',button:0});await page.mouse.up();
 assert.equal((await read()).ui.surfacePlacement,null,'pointercancel cancels explicit placement');
 assert.deepEqual((await read()).blueprint,frameBefore.blueprint,'cancelled pointer cannot commit a mount');
 const cameraBefore=(await read()).ui.camera.position;
 await page.mouse.move(currentBox.x+currentBox.width-65,currentBox.y+currentBox.height-65);await page.mouse.down();await page.mouse.move(currentBox.x+currentBox.width-150,currentBox.y+currentBox.height-100,{steps:12});await page.mouse.up();
 assert.notDeepEqual((await read()).ui.camera.position,cameraBefore,'orbit resumes after surface cancellation');
 assert.deepEqual(errors,[]);assert.deepEqual(sourceIdentity(),source,'verification source unchanged');assert.equal(appFingerprint(),expectedBuild,'app source unchanged during browser run');
 await page.screenshot({path:`${out}/complete.png`});
 writeFileSync(`${out}/result.json`,JSON.stringify({source,build,errors,checks:['outside drag cancellation','different candidate after cancellation','successful drop','Escape cancellation','explicit surface pointercancel','orbit recovery']},null,2));console.log('PASS UI drag lifecycle and orbit recovery');
}finally{await browser.close();}
