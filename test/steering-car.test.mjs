import test from 'node:test';
import assert from 'node:assert/strict';
import { createSteeringCar } from './fixtures/steering-car.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
test('ordinary rear drive and default front hinges turn a loaded car both ways and return to centre', async () => {
  for (const direction of [0.5, -0.5]) {
    const b = createSteeringCar(),
      w = await createWorkshop(b);
    try {
      await w.act({ type: 'run' });
      for (const [id, duty] of [
        ['drive', 0.4],
        ['steer', direction],
      ])
        assert.ok((await w.act({ type: 'control', id, duty })).ok);
      let minUp = 1;
      const positiveWork = [0, 0];
      for (let i = 0; i < 600; i++) {
        w.step();
        w.observe()
          .frames[0].power.motors.filter((m) => m.position)
          .forEach((m, index) => (positiveWork[index] += Math.max(0, m.mechanicalEnergy)));
        const [x, , z] = w.observe().frames[0].physics[0].rotation;
        minUp = Math.min(minUp, 1 - 2 * (x * x + z * z));
      }
      const f = w.observe().frames[0],
        [x, y, z, a] = f.physics[0].rotation,
        heading = Math.atan2(2 * (x * z + a * y), 1 - 2 * (x * x + y * y));
      assert.ok(heading * direction > 0.4, `car did not turn: ${heading}`);
      assert.ok(f.physics[0].position[0] * direction > 0.5);
      assert.ok(minUp > 0.99);
      assert.ok(
        positiveWork.every((work) => work > 0.1),
        'each hinge must deliver measured positive work during the turn',
      );
      assert.ok(
        f.power.motors
          .filter((m) => m.position)
          .every((m) => m.heatJ >= 0 && m.driverHeatJ >= 0 && Math.abs(m.energyResidualJ) < 1e-8),
      );
      await w.act({ type: 'control', id: 'steer', duty: 0 });
      w.step(120);
      assert.ok(
        w
          .observe()
          .frames[0].power.motors.filter((m) => m.position)
          .every((m) => Math.abs(m.position.angle) < 0.03),
        'moving steering must centre within one second',
      );
      for (const id of ['drive']) await w.act({ type: 'control', id, duty: 0 });
      w.step(240);
      assert.ok(
        w
          .observe()
          .frames[0].power.motors.filter((m) => m.position)
          .every((m) => Math.abs(m.position.angle) < 0.04),
      );
    } finally {
      w.dispose();
    }
  }
});
