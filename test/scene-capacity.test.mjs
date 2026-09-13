import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
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
