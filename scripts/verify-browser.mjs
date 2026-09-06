import { chromium } from 'playwright';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { appFingerprint } from './build-fingerprint.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const identity=appFingerprint();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`));
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
try {
 await page.goto(process.argv[2]??'http://127.0.0.1:5173/test/browser/');
 await page.waitForFunction(()=>window.probe);
 await page.click('#start-btn');
 await page.waitForFunction(()=>window.probe.session.observe().cursor.tick>=120);
 await page.click('#pause');
 const data=await page.evaluate(()=>({trace:window.probe.trace(),configuration:window.probe.configuration,text:JSON.parse(window.render_game_to_text())}));
 const reference=await createSession(data.configuration);
 try {
  const expected=[];
  for(let tick=0;tick<=120;tick++){expected.push(deterministicProjection(reference.observe().frames.at(-1)));if(tick<120)reference.step(1);}
  const actual=data.trace.filter(f=>f.tick<=120);
  assert.deepEqual(actual,expected,'real requestAnimationFrame trace must equal fixed-tick trace');
  assert.deepEqual(data.text.physics,data.trace.at(-1).physics,'text mirror must match last published frame');
  assert.deepEqual(errors,[]);
  assert.equal(appFingerprint(),identity,'source changed during browser verification');
  mkdirSync('artifacts/browser-m1',{recursive:true});
  await page.screenshot({path:'artifacts/browser-m1/raf.png'});
  const result={app:identity,runtime:process.version,browser:browser.version(),ticks:120,clock:'real-requestAnimationFrame',digest:createHash('sha256').update(JSON.stringify(actual)).digest('hex'),errors};
  writeFileSync('artifacts/browser-m1/raf.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
 } finally {reference.dispose();}
} finally {await browser.close();}
