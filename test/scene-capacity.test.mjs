import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBlueprint,
  createPart,
  loadSave,
  validateBlueprint,
} from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createSceneObject, sceneLayout } from '../src/model/environment.mjs';
import { createSceneLibrary } from '../src/application/scene-library.mjs';
import { assertRejectedEditUnchanged } from './contracts/editing.mjs';

test('valid nearly full workshop rejects scene replacement, duplication, import and full load atomically', async () => {
  const blueprint = createEmptyBlueprint('capacity-transaction', 'Capacity transaction');
  // Disjoint ordinary beams, not overlapping schema-only placeholders.
  for (let i = 0; i < 4095; i++)
    blueprint.parts.push(
      createPart('beam', `beam-${i}`, [(i % 64) * 0.5 - 16, 2, Math.floor(i / 64) * 0.1 - 3.2]),
    );
  blueprint.environment = sceneLayout('flat');
  blueprint.environment.objects.push({
    ...createSceneObject('block', 'first'),
    position: [9, 0.025, 9],
  });
  assert.equal(loadSave(blueprint).ok, true, 'the boundary fixture must be physically admissible');
  const workshop = await createWorkshop(blueprint);
  try {
    assert.equal(
      (await workshop.act({ type: 'rename', id: 'beam-0', name: 'History control' })).ok,
      true,
    );
    const original = workshop.save();
    const duplicated = structuredClone(original.environment);
    duplicated.objects.push({ ...duplicated.objects[0], id: 'second', position: [8, 0.025, 9] });
    const values = new Map(),
      library = createSceneLibrary({
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      });
    library.add('Imported scene', duplicated);
    for (const environment of [duplicated, library.list()[0].scene]) {
      const command = {
        type: 'replace-scene',
        environment,
        expectedCursor: workshop.observe().cursor,
      };
      const outcome = await workshop.act(command);
      assert.equal(outcome.reasonCode, 'SCENE_BODY_LIMIT');
      assert.deepEqual(workshop.save(), original);
      await assertRejectedEditUnchanged(workshop, command);
    }
    await assertRejectedEditUnchanged(workshop, {
      type: 'load',
      save: { ...original, environment: duplicated },
    });
    assert.equal((await workshop.act({ type: 'undo' })).ok, true);
    assert.deepEqual(workshop.save(), blueprint, 'capacity rejections did not consume history');
  } finally {
    workshop.dispose();
  }
});

test('scene capacity includes every distributed rope node', () => {
  const bp = createEmptyBlueprint('rope-capacity', 'Rope capacity');
  bp.parts = [createPart('beam', 'a', [0, 3, 0]), createPart('plate', 'b', [0, 1, 0])];
  bp.connections = [
    {
      id: 'r',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 1.97, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  for (let i = 0; i < 4084; i++)
    bp.parts.push(
      createPart('beam', `f-${i}`, [(i % 64) * 0.5 - 16, 5, Math.floor(i / 64) * 0.1 - 3.2]),
    );
  bp.environment = sceneLayout('flat');
  bp.environment.objects.push({ ...createSceneObject('block', 'first'), position: [9, 0.025, 9] });
  assert.equal(validateBlueprint(bp).ok, true);
  assert.equal(compileAssembly(bp).configuration.bodies.length, 4097);
  bp.environment.objects.push({ ...createSceneObject('block', 'second'), position: [8, 0.025, 9] });
  assert.equal(validateBlueprint(bp).reasonCode, 'SCENE_BODY_LIMIT');
});
