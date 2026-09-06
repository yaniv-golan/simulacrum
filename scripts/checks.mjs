import {readManifest} from './validate-manifest.mjs';
import {runProcess} from './run-check.mjs';
import {suiteDeadline} from './browser-registry.mjs';
const node=(args,timeoutMs=30000)=>runProcess(process.execPath,args,{timeoutMs});
export const CHECKS=Object.freeze({
 'no-live-state-reads':()=>node(['--test','test/controllers.test.mjs','test/m3-session.test.mjs']),
 'identity-invariance-minimal':async()=>{await node(['--test','test/m3-authoring.test.mjs']);return node(['scripts/verify-m3.mjs']);},
 'workshop-response':()=>node(['scripts/verify-browser-suite.mjs','performance','--reuse-build'],suiteDeadline('performance')),
 'production-control-path':async()=>{await node(['--test','test/free-build-continuity.test.mjs']);return node(['scripts/verify-browser-suite.mjs','smoke','--reuse-build'],suiteDeadline('smoke'));},
 'm1-qualification':()=>node(['scripts/qualify-m1.mjs'],110000),
 'minimal-failure-bundle':()=>node(['scripts/replay.mjs','artifacts/m1/failure.json']),
 'physics-library-adr':async()=>{const {readFileSync}=await import('node:fs');if(!readFileSync('docs/adr/0001-physics-library.md','utf8').includes('@dimforge/rapier3d-deterministic-compat'))throw Error('ADR missing library');},
 'schema-rejects-malformed':async()=>{const {generateSchema}=await import('./generate-schema.mjs');generateSchema({check:true});return node(['--test','test/blueprint.test.mjs']);},
 'single-library-importer':async()=>{const {checkPhysicsBoundary}=await import('./check-physics-boundary.mjs');checkPhysicsBoundary();},
 'no-live-object-escape':()=>node(['--test','test/physics.test.mjs','test/workshop.test.mjs']),
 'milestone-breadth-reject':async()=>{const {checkBreadth}=await import('./check-breadth.mjs');checkBreadth();},
 'manifest-validates':()=>readManifest(),
 'ci-under-3min':()=>node(['scripts/ci.mjs'],180000),
 'tooling-tests':()=>node(['--test','test/manifest.test.mjs','test/browser-registry.test.mjs','test/process-runner.test.mjs']),
});
export function checkDeadline(id){return id==='production-control-path'?suiteDeadline('smoke')+40000:id==='workshop-response'?suiteDeadline('performance')+10000:id==='ci-under-3min'?190000:120000;}
