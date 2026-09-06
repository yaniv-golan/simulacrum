import assert from 'node:assert/strict';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
export function checkIdentity() {
  for (const [type, definition] of Object.entries(CATALOG))
    for (const [material, row] of Object.entries(MATERIALS)) {
      assert.equal(row.selectable, true, 'every material must be player selectable');
      const blueprint = createEmptyBlueprint('original', 'Original');
      const part = createPart(type, 'part', [0, 2, 0]);
      part.authoredMaterial = { body: material };
      blueprint.parts.push(part);
      const original = compileAssembly(blueprint);
      const renamed = structuredClone(blueprint);
      renamed.id = 'renamed';
      renamed.name = 'A foot';
      renamed.parts[0].id = 'other';
      renamed.parts[0].name = 'wheel';
      assert.deepEqual(
        compileAssembly(renamed).configuration,
        original.configuration,
        'identity may not change physical admission',
      );
      const mapped = original.mapping[0];
      assert.equal(mapped.materialHandle, row.handle);
      const primitive = definition.primitives[0],
        [halfLength, radius, height] = primitive.halfExtents;
      const volume =
        primitive.kind === 'cylinder'
          ? 2 * Math.PI * halfLength * radius ** 2
          : 8 * halfLength * radius * height;
      assert.equal(original.configuration.bodies[0].mass, volume * row.density);
      assert.deepEqual(
        blueprint.parts[0].authoredMaterial,
        { body: material },
        'compiler must preserve authored choice',
      );
    }
}
