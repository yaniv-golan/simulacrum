import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>errors.push(r.url()));
const out='artifacts/camera-recovery';mkdirSync(out,{recursive:true});
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:4173/');await page.locator('[data-command=start-guide]').click();for(let i=0;i<16;i++)await page.locator('[data-command=guide-step]').click();await page.getByRole('button',{name:'Leave guide',exact:true}).click();await page.keyboard.press('Escape');
 const state=()=>page.evaluate(()=>window.workshopProbe.readInteractionState());
 const canvas=await page.locator('canvas').boundingBox();
 const x=canvas.x+canvas.width*.85,y=canvas.y+canvas.height*.6;
 for(let attempt=0;attempt<6&&(await state()).camera.position[1]>=0;attempt++){await page.mouse.move(x,y);await page.mouse.down({button:'left'});await page.mouse.move(x,y-100,{steps:12});await page.mouse.up({button:'left'});await page.waitForTimeout(300);}
 const below=await state();assert.ok(below.camera.position[1]<0,'ordinary orbit must reach underside');await page.screenshot({path:`${out}/underside.png`});
 await page.getByRole('button',{name:'Exploded view',exact:true}).click();await page.waitForTimeout(800);const inspected=await state();assert.ok(inspected.camera.position[1]<inspected.camera.target[1],'exploding preserves underside heading');await page.screenshot({path:`${out}/exploded-underside.png`});
 await page.getByRole('button',{name:'Frame machine · F',exact:true}).click();await page.waitForTimeout(400);const recovered=await state();assert.ok(recovered.camera.position[1]>recovered.camera.target[1],'Frame must recover above-floor angle');await page.screenshot({path:`${out}/recovered.png`});
 assert.deepEqual(errors,[]);writeFileSync(`${out}/result.json`,JSON.stringify({build:await page.locator('meta[name=build-id]').getAttribute('content'),below:below.camera,recovered:recovered.camera,errors},null,2));console.log('camera recovery browser checks passed');
}finally{await browser.close();}
