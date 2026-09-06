import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>errors.push(r.url()));
mkdirSync('artifacts/recording-browser',{recursive:true});
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:4173/');await page.waitForFunction(()=>window.workshopProbe);
 await page.locator('[data-command=start-guide]').click();
 const first=await page.locator('[data-command=guide-step]').boundingBox();
 for(let i=0;i<16;i++){
  const box=await page.locator('[data-command=guide-step]').boundingBox();assert.equal(box.y,first.y,'guide action must not move between steps');
  await page.mouse.click(first.x+first.width/2,first.y+first.height/2);
  await page.waitForFunction(n=>{const b=window.workshopProbe.observe().frames[0].metadata.blueprint;return b.parts.length+b.connections.length===n;},i+1);
 }
 assert.equal(await page.evaluate(()=>localStorage.getItem('simulacrum.interaction-recording.v1')),null);
 await page.locator('.recording-panel summary').click();await page.locator('[data-command=record-session]').click();
 if(!await page.locator('.machine-picker').evaluate(el=>el.open))await page.locator('.machine-picker > summary').click();await page.locator('.part-list-item').first().click();await page.keyboard.press('ArrowRight');await page.keyboard.press('e');await page.keyboard.press('Escape');
 await page.locator('[data-command=record-session]').click();
 const download=page.waitForEvent('download');await page.locator('[data-command=export-session]').click();const file=await download;const capture=JSON.parse(readFileSync(await file.path(),'utf8'));
 assert.equal(capture.status,'stopped');assert.equal(capture.terminationReason,'user-stop');assert.ok(capture.initialContext.checkpoint);assert.ok(capture.events.some(e=>e.kind==='input'&&e.data.key==='ArrowRight'));assert.ok(capture.events.some(e=>e.kind==='command-result'&&e.data.result.ok));assert.ok(capture.events.some(e=>e.kind==='tool'));assert.ok(capture.events.some(e=>e.kind==='selection'));
 assert.equal(capture.build,await page.locator('meta[name=build-id]').getAttribute('content'));assert.ok(capture.events.every((e,i)=>e.seq===i+1&&e.context.cursor));
 await page.screenshot({path:'artifacts/recording-browser/recording.png'});
 await page.reload();await page.waitForFunction(()=>window.workshopProbe);await page.locator('.recording-panel summary').click();const second=page.waitForEvent('download');await page.locator('[data-command=export-session]').click();assert.deepEqual(JSON.parse(readFileSync(await (await second).path(),'utf8')),capture);
 assert.deepEqual(errors,[]);writeFileSync('artifacts/recording-browser/result.json',JSON.stringify({build:capture.build,events:capture.events.length,errors,checks:['stationary guide action across all steps','opt-in only','keys and command results','selection and tools','checkpoint and cursor','export survives reload']},null,2));console.log('guide and local recording browser passed');
}finally{await browser.close();}
