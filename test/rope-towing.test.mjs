import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingMachine } from '../src/model/fixtures/driving-machine.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
async function tow(powered) {
  const bp = createDrivingMachine();
  bp.parts.push(createPart('spacerBlock', 'load', [0, 0.015, -1.2]));
  bp.connections.push({
    id: 'tow',
    kind: 'rope',
    a: { part: 'frame', surface: { region: 'back', u: 0, v: 0, twist: 0 } },
    b: { part: 'load', surface: { region: 'front', u: 0, v: 0, twist: 0 } },
    rope: { restLength: 1.1, diameter: 0.02, segments: 8, material: 'nylon' },
  });
  const w = await createWorkshop(bp);
  try {
    await w.act({ type: 'run' });
    for (const side of ['left', 'right'])
      await w.act({
        type: 'control',
        id: side + '-control',
        duty: powered ? (side === 'left' ? -0.08 : 0.08) : 0,
      });
    w.step(480);
    const f = w.observe().frames[0];
    return {
      travel: f.physics[12].position[2] + 1.2,
      work: f.power.motors.reduce((s, m) => s + m.shaftWorkJ, 0),
      tension: Math.max(...f.ropes.map((r) => r.appliedTension)),
    };
  } finally {
    w.dispose();
  }
}
test('ordinary powered wheels tow a separate load while the neutral apparatus stays still', async () => {
  const on = await tow(true),
    off = await tow(false);
  assert.ok(on.travel > 0.1, JSON.stringify(on));
  assert.ok(on.work > 0);
  assert.ok(on.tension > 0);
  assert.ok(Math.abs(off.travel) < 0.02, JSON.stringify(off));
});
