import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const worldUrl = new URL('../src/simulation/physics/world.mjs', import.meta.url).href;
const fixtureUrl = new URL('./fixtures/load-cell-physical-matrix.mjs', import.meta.url).href;
// A loader fixture changes only temporal subdivisions, leaving the production
// 1/120 s clock and all solver code unchanged. No player tuning API is introduced.
function run(
  subdivisions,
  path,
  mode,
  mutant = process.env.LOAD_CELL_MATRIX_WRONG_RECEIPT ?? 'none',
) {
  const source = `
 import {registerHooks} from 'node:module';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
 let adapted=false;
 registerHooks({load(url,context,nextLoad){if(url!==${JSON.stringify(worldUrl)})return nextLoad(url,context);let source=readFileSync(new URL(url),'utf8');const marker='world.integrationParameters.numSolverIterations = 4;';assert.equal(source.split(marker).length,2,'subdivision fixture requires owner review');source=source.replace(marker,'world.integrationParameters.numSolverIterations = ${subdivisions};');if(${JSON.stringify(mutant === 'no-linear-drive' || process.env.LOAD_CELL_MATRIX_NO_LINEAR_DRIVE === '1')}){const driveMarker='applyLinearDrive(index, forceN) {';assert.equal(source.split(driveMarker).length,2);source=source.replace(driveMarker,driveMarker+' return;');}if(${JSON.stringify(mutant === 'no-torque-drive' || process.env.LOAD_CELL_MATRIX_NO_TORQUE_DRIVE === '1')}){const driveMarker='applyTorquePair(a, b, axisWorld, torqueNm) {';assert.equal(source.split(driveMarker).length,2);source=source.replace(driveMarker,driveMarker+' return;');}adapted=true;return {format:'module',shortCircuit:true,source};}});
 const {createPhysicsWorld}=await import(${JSON.stringify(worldUrl)});const {runPhysicalCase}=await import(${JSON.stringify(fixtureUrl)});const result=await runPhysicalCase(createPhysicsWorld,${JSON.stringify(path)},${JSON.stringify(mode)},{mutant:${JSON.stringify(mutant)}});assert.ok(adapted);process.stdout.write(JSON.stringify(result));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (mutant !== 'none' && !process.env.LOAD_CELL_MATRIX_WRONG_RECEIPT) {
    assert.notEqual(child.status, 0, 'wrong receipt must fail the same physical oracle');
    assert.match(
      child.stderr,
      ['no-linear-drive', 'no-torque-drive'].includes(mutant)
        ? /physical-drive-witness/
        : /physical-force-account/,
    );
    return null;
  }
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
for (const path of ['spring', 'rotary', 'gear', 'linear'])
  for (const subdivisions of [4, 8]) {
    test(`load-cell ${path} physical matrix closes independent moving and stalled accounts at ${subdivisions} subdivisions`, (t) => {
      const moving = run(subdivisions, path, 'moving'),
        stalled = run(subdivisions, path, 'stall'),
        free = run(subdivisions, path, 'free');
      assert.equal(moving.ticks, 240);
      assert.equal(stalled.ticks, 360);
      assert.equal(free.ticks, 240);
      assert.ok(free.wrongAngularTicks > 0);
      t.diagnostic(JSON.stringify({ subdivisions, moving, stalled, free }));
    });
  }
for (const mutant of ['zero', 'divide-substeps', 'double-count'])
  test(`load-cell physical matrix rejects ${mutant} receipt with the independent force oracle`, () => {
    run(4, 'linear', 'moving', mutant);
  });

for (const subdivisions of [4, 8])
  for (const mode of ['moving', 'free'])
    test(`load-cell linear ${mode} drive witness rejects no-op at ${subdivisions} subdivisions`, () => {
      run(subdivisions, 'linear', mode, 'no-linear-drive');
    });

for (const path of ['rotary', 'gear'])
  for (const subdivisions of [4, 8])
    for (const mode of ['moving', 'free'])
      test(`load-cell ${path} ${mode} drive witness rejects no-op at ${subdivisions} subdivisions`, () => {
        run(subdivisions, path, mode, 'no-torque-drive');
      });
