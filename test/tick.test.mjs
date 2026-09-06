import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTick } from '../scripts/check-tick.mjs';
const originals=Object.fromEntries(['src/model/tick.mjs','src/simulation/session.mjs'].map(path=>[path,readFileSync(new URL(`../${path}`,import.meta.url),'utf8')]));
function fixture(edit){const root=mkdtempSync(join(tmpdir(),'sim-tick-'));try{for(const [path,content] of Object.entries(originals)){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),edit(path,content));}return checkTick(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('actual frozen phases and single integration/clock owner pass',()=>assert.doesNotThrow(()=>fixture((p,s)=>s)));
test('reordered phases refuse',()=>assert.throws(()=>fixture((p,s)=>p.endsWith('tick.mjs')?s.replace("'sensor-snapshot', 'controller-commands'","'controller-commands', 'sensor-snapshot'"):s),/phase order/));
test('second synchronous integration refuses',()=>assert.throws(()=>fixture((p,s)=>p.endsWith('session.mjs')?s.replace('world.step();','world.step();world.step();'):s),/integration/));
test('second clock advance refuses',()=>assert.throws(()=>fixture((p,s)=>p.endsWith('session.mjs')?s.replace('world.step();','world.step();tick++;'):s),/clock/));
test('integration in wrong phase refuses',()=>assert.throws(()=>fixture((p,s)=>p.endsWith('session.mjs')?s.replace("case 'integration-contacts':","case 'wrong-phase':"):s),/integration/));
test('reconfiguration may reset clock only to zero',()=>assert.throws(()=>fixture((p,s)=>p.endsWith('session.mjs')?s.replace('tick=0;accumulator=0;','tick=1;accumulator=0;'):s),/clock/));
