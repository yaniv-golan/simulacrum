import { createSensorWorkshop } from '../src/model/fixtures/sensor-workshop.mjs';
import { createActiveSuspensionBench } from '../src/model/fixtures/articulated-suspension.mjs';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createProgramExecutors } from '../src/scripting/controller-executors.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';

const rotation = createEmptyBlueprint('rotation', 'Rotation');
rotation.parts = [
  createPart('rotationSensor', 'sensor', [0, 1, 0]),
  createPart('powerCell', 'supply', [1, 1, 0]),
];
rotation.connections = [
  {
    id: 'power',
    kind: 'power',
    a: { part: 'supply', port: 'power' },
    b: { part: 'sensor', port: 'power' },
  },
];
test('all seven powered sensor families and installed WASM restore exact next-tick continuation', async () => {
  for (const [kind, bp] of [
    ...['range', 'contact', 'tilt', 'jointAngle', 'linearMotion'].map((k) => [
      k,
      createSensorWorkshop(k),
    ]),
    ['travel', createActiveSuspensionBench()],
    ['rotation', rotation],
  ]) {
    const s = await createSession(
      compileAssembly(bp).configuration,
      undefined,
      undefined,
      undefined,
      createProgramExecutors,
    );
    try {
      s.step(14);
      const prior = s.observe().frames[0];
      const retained = structuredClone(prior);
      s.step(1);
      const completed = s.observe().frames[0];
      assert.equal(completed.sensors.bodies, prior.physics, `${kind}: reuse admitted bodies`);
      assert.throws(() => {
        completed.sensors.bodies[0].position[0] = 999;
      }, TypeError);
      assert.deepEqual(prior, retained, `${kind}: retained observation stays unchanged`);
      const cp = s.checkpoint();
      s.step(5);
      const expected = deterministicProjection(s.observe().frames[0]);
      s.restore(cp);
      s.step(5);
      assert.deepEqual(deterministicProjection(s.observe().frames[0]), expected);
      const bad = structuredClone(cp);
      bad.sensors.readings[0].channels[Object.keys(bad.sensors.readings[0].channels)[0]] = {
        status: 'ok',
        value: NaN,
      };
      const before = s.checkpoint();
      assert.throws(() => s.restore(bad));
      assert.deepEqual(s.checkpoint(), before);
    } finally {
      s.dispose();
    }
  }
});
