import test from 'node:test';
import assert from 'node:assert/strict';
import { machine } from './fixtures/linear-machine.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { resolveSurfaceEndpoint } from '../src/model/surfaces.mjs';
import { rotateVector } from '../src/model/transforms.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
const frame = (s) => s.observe().frames.at(-1);
function fixture(mode) {
  const bp = machine();
  bp.parts.push(createPart('spacerBlock', 'load', [0.3, 0.8, 0]));
  const a = { part: 'output', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    b = { part: 'load', surface: { region: 'top', u: 0, v: 0, twist: 0 } };
  const endpoint = (e) => {
    const p = bp.parts.find((p) => p.id === e.part);
    return rotateVector(p.rotation, resolveSurfaceEndpoint(p, e).position).map(
      (v, k) => v + p.position[k],
    );
  };
  const pa = endpoint(a),
    pb = endpoint(b),
    restLength = Math.hypot(...pa.map((v, k) => v - pb[k]));
  if (mode !== 'no-rope')
    bp.connections.push({
      id: 'tow',
      kind: 'rope',
      a,
      b,
      rope: { restLength, diameter: 0.02, segments: 8, material: 'nylon' },
    });
  const c = compileAssembly(bp, { ground: null, gravity: [0, 0, 0] }).configuration;
  c.bodies[0].fixed = true;
  c.power.receivers[0].duty = mode === 'neutral' ? 0 : 1;
  if (mode === 'no-power') c.power.wires = [];
  return c;
}
test('powered linear actuator pulls a Rope load with causal controls and exact checkpoint continuation', async () => {
  const outcomes = {};
  for (const mode of ['powered', 'neutral', 'no-power', 'no-rope']) {
    const s = await createSession(fixture(mode));
    try {
      const initial = frame(s),
        y0 = initial.physics[4].position[1],
        x0 = initial.physics[4].position[0],
        stroke0 = initial.springs[0].length,
        energy0 = initial.power.cells[0].energyJ;
      let peakTension = 0;
      for (let t = 0; t < 60; t++) {
        s.step(1);
        const f = frame(s);
        peakTension = Math.max(peakTension, ...(f.ropes ?? []).map((r) => r.appliedTension));
        assert.equal(f.status, 'ready');
      }
      const f = frame(s);
      outcomes[mode] = {
        loadRise: f.physics[4].position[1] - y0,
        loadPull: x0 - f.physics[4].position[0],
        stroke: f.springs[0].length - stroke0,
        peakTension,
        chargeUsed: energy0 - f.power.cells[0].energyJ,
      };
      if (mode === 'powered') {
        const cp = s.checkpoint(),
          cpFrame = deterministicProjection(frame(s));
        s.step(23);
        const expected = deterministicProjection(frame(s));
        s.restore(cp);
        assert.deepEqual(deterministicProjection(frame(s)), cpFrame);
        s.step(23);
        assert.deepEqual(deterministicProjection(frame(s)), expected);
      }
    } finally {
      s.dispose();
    }
  }

  assert.ok(
    outcomes.powered.loadRise > 0.005,
    'powered rope must move the gravity-free load by more than5mm',
  );
  assert.ok(outcomes.powered.loadPull > 0.002, 'load must move toward the rope attachment');
  assert.ok(outcomes.powered.peakTension > 0.01, 'rope must transmit measured nonzero tension');
  assert.ok(outcomes.powered.stroke > 0.01, 'funded linear actuator must extend');
  assert.ok(outcomes.powered.chargeUsed > 0, 'actuation must consume stored energy');
  for (const mode of ['neutral', 'no-power', 'no-rope'])
    assert.ok(
      Math.abs(outcomes[mode].loadRise) < 1e-8,
      mode + ' cannot move this gravity-free load',
    );
  assert.ok(outcomes['no-rope'].stroke > 0.01, 'rope-absent control must still drive the actuator');
});
