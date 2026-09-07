import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingMachine } from '../src/model/fixtures/driving-machine.mjs';
import { evaluateControlBinding } from '../src/model/control-bindings.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
async function measure(blueprint, keys) {
  const w = await createWorkshop(blueprint);
  try {
    assert.ok(w.observe().frames[0].metadata.connections.every((c) => c.reasonCode === 'OK'));
    assert.ok((await w.act({ type: 'run' })).ok);
    for (const receiver of blueprint.parts.filter((p) => p.type === 'commandReceiver'))
      assert.ok(
        (
          await w.act({
            type: 'control',
            id: receiver.id,
            duty: evaluateControlBinding(receiver.controlBinding, keys).duty,
          })
        ).ok,
      );
    let minUp = 1;
    for (let i = 0; i < 240; i++) {
      w.step(1);
      const [x, , z] = w.observe().frames[0].physics[0].rotation;
      minUp = Math.min(minUp, 1 - 2 * (x * x + z * z));
    }
    const f = w.observe().frames[0],
      body = f.physics[0],
      [x, y, z, a] = body.rotation;
    return {
      position: body.position,
      heading: Math.atan2(2 * (x * z + a * y), 1 - 2 * (x * x + y * y)),
      minUp,
      energy: f.power.cells[0].energyJ,
      work: f.power.motors.reduce((sum, m) => sum + m.shaftWorkJ, 0),
    };
  } finally {
    w.dispose();
  }
}
const accepts = (command, r) =>
  r.minUp > 0.99 &&
  r.position[1] > 0.08 &&
  {
    forward: r.position[2] > 1,
    reverse: r.position[2] < -1,
    right: r.heading > 0.5,
    left: r.heading < -0.5,
    neutral: Math.hypot(r.position[0], r.position[2]) < 0.02 && r.work === 0,
  }[command];
test('ordinary shared-cell machine drives and steers through authored keys with upright support', async () => {
  for (const [command, keys] of [
    ['forward', ['KeyW']],
    ['reverse', ['KeyS']],
    ['right', ['KeyD']],
    ['left', ['KeyA']],
    ['neutral', []],
  ]) {
    const r = await measure(createDrivingMachine(), keys);
    assert.ok(accepts(command, r), `${command}: ${JSON.stringify(r)}`);
  }
  const wrong = createDrivingMachine();
  for (const p of wrong.parts.filter((p) => p.type === 'commandReceiver'))
    p.controlBinding.drive.gain *= -1;
  const r = await measure(wrong, ['KeyW']);
  assert.equal(
    accepts('forward', r),
    false,
    'wrong authored drive polarity must fail the forward predicate',
  );
  assert.ok(r.position[2] < -1, 'negative control must physically reverse');
});
