import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { gearCapacityFixture } from './fixtures/gear-capacity.mjs';

const latest = (s) => s.observe().frames[0];
function ratioError(f) {
  const input = f.physics[1].angularVelocity[0];
  assert.ok(Math.abs(input) > 0.2, 'healthy driven input is required');
  return Math.max(
    ...f.physics
      .slice(1, 10)
      .map((b, i) => Math.abs(b.angularVelocity[0] / input - (i % 2 ? -0.5 : 1))),
  );
}

test('maximum eight-mesh chain transmits through all rotors and replays a dense apparatus', async () => {
  for (const bodies of [12, 34]) {
    const session = await createSession(gearCapacityFixture({ bodies }));
    try {
      session.step(600);
      const f = latest(session);
      assert.equal(f.gears.length, 8);
      assert.ok(ratioError(f) < 0.03);
      assert.ok(f.gears.every((g) => Math.abs(g.strain) < 0.001));
      const cp = session.checkpoint();
      session.step(12);
      const expected = deterministicProjection(latest(session));
      session.restore(cp);
      session.step(12);
      assert.deepEqual(deterministicProjection(latest(session)), expected);
    } finally {
      session.dispose();
    }
  }
});
test('ninth independently supported aligned mesh is rejected at the physical capacity boundary', async () => {
  const c = gearCapacityFixture(),
    last = structuredClone(c.bodies[8]);
  last.position = [0, 1, 1.62];
  c.bodies.push(last);
  c.joints.push({
    kind: 'revolute',
    a: 0,
    b: 12,
    anchorA: [0.1, 0, 0.9],
    anchorB: [0, 0, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
  });
  const control = await createSession(c);
  control.dispose();
  c.joints.push({
    kind: 'gear',
    a: 9,
    b: 12,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
    radiusA: 0.06,
    radiusB: 0.12,
    stiffness: 20000,
    damping: 20,
  });
  await assert.rejects(() => createSession(c), /at most 8 gear meshes/);
});
