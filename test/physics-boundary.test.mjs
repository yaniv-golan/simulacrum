import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPhysicsBoundary } from '../scripts/check-physics-boundary.mjs';
const library='@dimforge/rapier3d-deterministic-compat';
function fixture(files,fn){const root=mkdtempSync(join(tmpdir(),'physics-boundary-'));try{const contents={'scripts/manifest.json':JSON.stringify({physicsPackages:[library]}),...files};for(const [path,value] of Object.entries(contents)){mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),value);}fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
test('sole owned physics door passes; zero importers refuses',()=>fixture({'src/simulation/physics/world.mjs':`import R from '${library}';`},root=>{assert.doesNotThrow(()=>checkPhysicsBoundary(root));writeFileSync(join(root,'src/simulation/physics/world.mjs'),'export {};');assert.throws(()=>checkPhysicsBoundary(root),/exactly one/);}));
test('second importer inside physics still refuses',()=>fixture({'src/simulation/physics/world.mjs':`import R from '${library}';`,'src/simulation/physics/second.mjs':`export * from '${library}';`},root=>assert.throws(()=>checkPhysicsBoundary(root),/exactly one/)));
test('wrong owner refuses even with exactly one importer',()=>fixture({'src/simulation/physics/other.mjs':`import('${library}');`},root=>assert.throws(()=>checkPhysicsBoundary(root),/owned door/)));
