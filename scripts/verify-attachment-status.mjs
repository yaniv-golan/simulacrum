import {createBrowserEvidence} from './browser-evidence.mjs';
import {mkdirSync} from 'node:fs';mkdirSync('artifacts/ux-repairs',{recursive:true});
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browserEvidence=createBrowserEvidence();

const b=await chromium.launch(),p=await b.newPage();try{await browserEvidence.goto(p,process.argv[2]??'http://127.0.0.1:4173/');await p.waitForFunction(()=>window.workshopProbe);await p.locator('[data-command=start-guide]').click();for(let i=0;i<16;i++)await p.locator('[data-command=guide-step]').click();await p.locator('.machine-picker > summary').click();await p.locator('.part-list-item').filter({hasText:/^Drive wheel$/}).click();assert.match(await p.locator('.mount-status').innerText(),/Axle attached to/);assert.doesNotMatch(await p.locator('.mount-status').innerText(),/Not mounted|Snap to surface/);await p.screenshot({path:'artifacts/ux-repairs/attached.png'});console.log('PASS axle status');}finally{try{browserEvidence.assertUnchanged();}finally{await b.close();}}
