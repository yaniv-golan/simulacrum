import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint, validateBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createPowerNetwork } from '../src/simulation/power.mjs';
import { createSteeringCar } from './fixtures/steering-car.mjs';
const dt = 1 / 120;
test('optional actuator polarity is strict and old authored motors retain positive input', () => {
  for (const type of ['poweredMotor', 'poweredHinge']) {
    const b = createEmptyBlueprint('test', 'Test');
    b.parts = [createPart(type, 'actuator', [0, 1, 0])];
    delete b.parts[0].parameters.inputPolarity;
    assert.ok(validateBlueprint(b).ok);
    for (const value of [-1, 1]) {
      b.parts[0].parameters.inputPolarity = value;
      assert.ok(validateBlueprint(b).ok);
    }
    for (const value of [0, 0.5, 2, '-1']) {
      b.parts[0].parameters.inputPolarity = value;
      assert.equal(validateBlueprint(b).ok, false);
    }
  }
});
function firstKick(b) {
  const c = compileAssembly(b, { gravity: [0, 0, 0], ground: null }).configuration;
  const p = createPowerNetwork(c.power),
    sources = c.power.receivers.map((r) => ({ node: r.node, duty: 0.4 }));
  const torques = p.step(
    dt,
    c.power.motors.map((m) => ({
      node: m.node,
      speed: 0,
      ...(m.positionControl ? { angle: 0 } : {}),
    })),
    sources,
    c.power.motors.map((m) => ({ node: m.node, inertia: 1 })),
  ).torques;
  return { c, torques };
}
test('one receiver drives opposing mounted motors consistently only with explicit polarity', () => {
  const b = createSteeringCar(),
    good = firstKick(b),
    indices = good.c.power.motors.map((m, i) => (m.positionControl ? -1 : i)).filter((i) => i >= 0);
  const [a, z] = indices;
  assert.equal(good.torques[a].value, -good.torques[z].value);
  b.parts.find((p) => p.id === 'left-motor').parameters.inputPolarity = 1;
  const wrong = firstKick(b);
  assert.equal(wrong.torques[a].value, wrong.torques[z].value);
  assert.notEqual(
    wrong.torques[a].value,
    -wrong.torques[z].value,
    'wrong polarity control escaped',
  );
  for (const p of b.parts) if (p.type === 'poweredHinge') p.parameters.inputPolarity = -1;
  const reversed = firstKick(b);
  for (const [i, m] of good.c.power.motors.entries())
    if (m.positionControl) assert.equal(reversed.torques[i].value, -good.torques[i].value);
});
