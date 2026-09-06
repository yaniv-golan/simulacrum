import { execFileSync } from 'node:child_process';
import { readManifest } from './validate-manifest.mjs';
export const CHECKS = Object.assign(Object.create(null), {
  'no-live-state-reads': () => execFileSync(process.execPath,['--test','test/controllers.test.mjs','test/m3-session.test.mjs'],{stdio:'pipe',timeout:30000}),
  'identity-invariance-minimal': () => { execFileSync(process.execPath,['--test','test/m3-authoring.test.mjs'],{stdio:'pipe',timeout:30000}); return execFileSync(process.execPath,['scripts/verify-m3.mjs'],{stdio:'pipe',timeout:30000}); },
  'workshop-response': () => execFileSync(process.execPath,['scripts/qualify-workshop-build.mjs','f2'],{stdio:'pipe',timeout:110000,killSignal:'SIGKILL'}),
  // Seven serial browser flows include a thirty-second real-clock run. Keep
  // their aggregate watchdog below the gate's 190s process deadline.
  'production-control-path': () => { execFileSync(process.execPath,['--test','test/free-build-continuity.test.mjs'],{stdio:'pipe',timeout:30000,killSignal:'SIGKILL'}); return execFileSync(process.execPath,['scripts/qualify-workshop-build.mjs','flow'],{stdio:'pipe',timeout:170000,killSignal:'SIGKILL'}); },
  'm1-qualification': () => execFileSync(process.execPath, ['scripts/qualify-m1.mjs'], {stdio:'pipe',timeout:110_000,killSignal:'SIGKILL'}),
  'minimal-failure-bundle': () => execFileSync(process.execPath, ['scripts/replay.mjs','artifacts/m1/failure.json'], {stdio:'pipe',timeout:30_000,killSignal:'SIGKILL'}),
  'physics-library-adr': async () => { const {readFileSync}=await import('node:fs'); if(!readFileSync('docs/adr/0001-physics-library.md','utf8').includes('@dimforge/rapier3d-deterministic-compat'))throw Error('ADR missing library'); },
  'schema-rejects-malformed': async () => { const {generateSchema}=await import('./generate-schema.mjs'); generateSchema({check:true}); execFileSync(process.execPath,['--test','test/blueprint.test.mjs'],{stdio:'pipe',timeout:30000}); },
  'single-library-importer': async () => { const {checkPhysicsBoundary}=await import('./check-physics-boundary.mjs'); checkPhysicsBoundary(); },
  'no-live-object-escape': () => execFileSync(process.execPath,['--test','test/physics.test.mjs','test/workshop.test.mjs'],{stdio:'pipe',timeout:30000}),
  'milestone-breadth-reject': async () => { const {checkBreadth}=await import('./check-breadth.mjs'); checkBreadth(); },
  'manifest-validates': () => readManifest(),
  'ci-under-3min': () => execFileSync(process.execPath, ['scripts/ci.mjs'], {stdio:'pipe',timeout:180_000,killSignal:'SIGKILL'}),
  'tooling-tests': () => execFileSync(process.execPath, ['--test', 'test/manifest.test.mjs'], {stdio:'pipe',timeout:30_000,killSignal:'SIGKILL'}),
});
export function registerCheck(id, fn) {
  if (CHECKS[id]) throw new Error(`duplicate check: ${id}`);
  CHECKS[id] = fn;
}
