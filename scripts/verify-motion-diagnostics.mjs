import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {appFingerprint} from './build-fingerprint.mjs';
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('requestfailed',r=>errors.push(r.url()));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
const directory='artifacts/motion-diagnostics';mkdirSync(directory,{recursive:true});
try{
 await page.goto(process.argv[2]??'http://127.0.0.1:4173/');
 await page.locator('[data-part-type=poweredMotor]').click();
 await page.locator('[data-command=check-machine]').click();
 const dialog=page.getByRole('dialog',{name:'Check machine'});
 assert.deepEqual(await dialog.locator('[data-diagnostic-code]').evaluateAll(rows=>rows.map(r=>r.dataset.diagnosticCode)),['MISSING_AXLE','MISSING_POWER']);
 await page.screenshot({path:`${directory}/missing-connections.png`});
 await dialog.locator('[data-diagnostic-code=MISSING_POWER]').getByRole('button').click();
 assert.equal(await dialog.isVisible(),false);assert.match(await page.locator('.port-explanation').textContent(),/Carries electrical power/);
 await page.keyboard.press('Escape');await page.locator('[data-command=new]').click();
 await page.locator('[data-command=start-guide]').click();for(let i=0;i<16;i++)await page.locator('[data-command=guide-step]').click();
 await page.locator('[data-command=check-machine]').click();assert.equal(await dialog.locator('[data-diagnostic-code]').count(),0);assert.match(await dialog.textContent(),/Run the machine to test/);await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('.machine-picker > summary').click();await page.locator('.part-list-item').filter({hasText:/^Motor$/}).click();
 const drive=page.getByRole('spinbutton',{name:'Drive setting',exact:true});await drive.fill('0');await drive.press('Tab');
 await page.locator('[data-command=check-machine]').click();assert.equal(await dialog.locator('[data-diagnostic-code=COMMAND_OFF]').count(),1);await dialog.getByRole('button',{name:'Inspect Motor',exact:true}).click();
 assert.equal(await drive.inputValue(),'0');
 assert.deepEqual(errors,[]);const build=await page.locator('meta[name=build-id]').getAttribute('content');assert.equal(build,appFingerprint());
 writeFileSync(`${directory}/browser.json`,JSON.stringify({build,errors,checks:['both missing connections explained','Inspect opens actual power port','ready guided build has no false blocker','zero command points to editable motor']},null,2));console.log('motion diagnostic browser passed');
}finally{await browser.close();}
