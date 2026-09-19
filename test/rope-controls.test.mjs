import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { freeSurfaceAnchor } from '../src/presentation/rope-controls.mjs';

test('a new rope end uses a free face point when the centre is occupied', () => {
  const blueprint = createEmptyBlueprint('rope-anchor', 'Rope anchor');
  blueprint.parts = [
    createPart('chassis', 'a', [0, 0.4, 0]),
    createPart('chassis', 'b', [1, 0.4, 0]),
  ];
  blueprint.connections = [
    {
      id: 'rope-1',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 1, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  const first = freeSurfaceAnchor(blueprint, 'a', 'top');
  assert.deepEqual(first, { u: 0, v: 0 });
  const second = freeSurfaceAnchor(blueprint, 'a', 'right');
  assert.notDeepEqual(second, { u: 0, v: 0 });
  assert.equal(Number.isFinite(second.u) && Number.isFinite(second.v), true);
});
