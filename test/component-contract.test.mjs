import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { assertComponentContract } from './contracts/component.mjs';

for (const type of Object.keys(CATALOG))
  test(`${type}: common geometry/material/endpoints/mass/inertia contract`, async () => {
    await assertComponentContract({ type });
    for (const material of Object.keys(MATERIALS))
      await assertComponentContract({ type, material });
  });
test('dimensioned wheel uses authored dimensions through save, compiler and physics', async () => {
  for (const diameter of [0.1, 0.6, 1])
    await assertComponentContract({
      type: 'gripWheel',
      parameters: { diameter },
      expectedHalfExtents: [0.025, diameter / 2, diameter / 2],
    });
});
test('dimensioned beam uses authored length through save, compiler and physics', async () => {
  for (const length of [0.1, 0.65, 1])
    for (const material of [undefined, 'steel'])
      await assertComponentContract({
        type: 'beam',
        parameters: { length },
        material,
        expectedHalfExtents: [length / 2, 0.02, 0.02],
      });
});
test('parametric spur gear uses authored teeth and module through save, compiler and physics', async () => {
  // The one test that proves collider, mass and inertia follow the authored tooth count all the
  // way through save, compiler and the physics door, at both module choices and every material.
  for (const [teeth, module] of [
    [12, 0.01],
    [13, 0.01],
    [24, 0.01],
    [36, 0.01],
    [12, 0.005],
    [36, 0.005],
  ]) {
    const radius = (module * (teeth - 2)) / 2;
    for (const material of [undefined, ...Object.keys(MATERIALS)])
      await assertComponentContract({
        type: 'spurGear',
        parameters: { teeth, module },
        material,
        expectedHalfExtents: [0.01, radius, radius],
      });
  }
});
test('common suite rejects plausible wrong geometry and discarded material', async () => {
  const wrongGeometry = (bp, options) => {
    const compiled = compileAssembly(bp, options);
    compiled.configuration.bodies[0].halfExtents[1] *= 2;
    return compiled;
  };
  await assert.rejects(
    assertComponentContract({ type: 'gripWheel', compile: wrongGeometry }),
    /compiler preserves geometry/,
  );
  const discardedMaterial = (bp, options) => {
    const copy = structuredClone(bp);
    copy.parts[0].authoredMaterial = {};
    return compileAssembly(copy, options);
  };
  await assert.rejects(
    assertComponentContract({ type: 'beam', material: 'steel', compile: discardedMaterial }),
    /material and volume determine mass/,
  );
});
