import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
test('short slack rope on ordinary contact supports remains usable', async () => {
  const bp = createEmptyBlueprint('short', 'Short');
  bp.parts = [
    createPart('beam', 'a', [-0.9, 0.32, 0]),
    createPart('powerCell', 'c1', [-0.9, 0.05, 0]),
    createPart('powerCell', 'c2', [-0.9, 0.15, 0]),
    createPart('powerCell', 'c3', [-0.9, 0.25, 0]),
    createPart('spacerBlock', 'b', [-0.7, 0.055, 0]),
  ];
  bp.connections = [
    {
      id: 'r',
      kind: 'rope',
      a: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      b: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 0.27, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  const w = await createWorkshop(bp);
  try {
    await w.act({ type: 'run' });
    for (let i = 0; i < 600; i++) {
      w.step(1);
      const f = w.observe().frames[0];
      assert.notEqual(
        f.status,
        'failed',
        JSON.stringify({ tick: f.tick, status: f.status, reason: f.reason }),
      );
    }
  } finally {
    w.dispose();
  }
});
