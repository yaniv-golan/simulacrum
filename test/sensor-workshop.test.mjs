import test from 'node:test';
import assert from 'node:assert/strict';
import { createSensorWorkshop } from '../src/model/fixtures/sensor-workshop.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createProgramExecutors } from '../src/scripting/controller-executors.mjs';
test('ordinary contact rover reaches its pad and reverses from the completed touch reading', async () => {
  const bp = createSensorWorkshop('contact');
  const s = await createSession(
    compileAssembly(bp).configuration,
    undefined,
    undefined,
    undefined,
    createProgramExecutors,
  );
  try {
    s.step(3);
    for (const r of s.observe().frames[0].receiverControl.receivers)
      s.act({ type: 'receiver-mode', node: r.node, mode: 'automatic' });
    let contact = false;
    for (let i = 0; i < 800; i++) {
      s.step();
      const f = s.observe().frames[0],
        r = f.sensors.readings.find((r) => r.node === bp.parts.findIndex((p) => p.id === 'sensor'));
      if (r.channels.touching.value === 1) {
        contact = true;
        assert.ok(r.channels.normalLoad.value > 0);
        assert.deepEqual(
          f.receiverControl.receivers.map((r) => r.duty),
          [0.25, -0.25],
        );
        assert.equal(r.tick, f.tick - 1);
        break;
      }
    }
    assert.ok(contact, 'the ordinary obstacle must physically reach the sensing face');
  } finally {
    s.dispose();
  }
});
test('loaded pad experiment exposes a predictable material edit through ordinary weight', async () => {
  const loads = [];
  for (const material of ['aluminium', 'steel']) {
    const bp = createSensorWorkshop('contactLoad');
    bp.parts.find((p) => p.id === 'load').authoredMaterial.body = material;
    const config = compileAssembly(bp).configuration;
    const s = await createSession(config);
    try {
      s.step(240);
      const f = s.observe().frames[0],
        reading = f.sensors.readings.find((r) => r.node === 0);
      assert.equal(reading.channels.touching.value, 1);
      const expected = config.bodies.slice(0, 2).reduce((sum, b) => sum + b.mass, 0) * 9.81;
      assert.ok(Math.abs(reading.channels.normalLoad.value - expected) < expected * 0.03);
      loads.push(reading.channels.normalLoad.value);
    } finally {
      s.dispose();
    }
  }
  assert.ok(loads[1] > loads[0] * 2, 'heavier material must produce a larger real pad load');
});
