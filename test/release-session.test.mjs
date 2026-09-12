import test from 'node:test';
import assert from 'node:assert/strict';
import { couplerFixture } from './contracts/release.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
const state = (s) => s.observe().frames.at(-1);
const configuration = () =>
  compileAssembly(couplerFixture(), { gravity: [0, -9.81, 0], ground: null }).configuration;
test('checkpoints before during ready and after release continue exactly with both production clocks', async () => {
  for (const at of [0, 2, 6, 9, 15]) {
    const a = await createSession(configuration()),
      b = await createSession(configuration());
    try {
      assert.equal(a.act({ type: 'receiver', node: 3, duty: 1 }).ok, true);
      assert.equal(b.act({ type: 'receiver', node: 3, duty: 1 }).ok, true);
      a.step(at);
      for (let i = 0; i < at; i++) b.advanceTime(1000 / 120);
      assert.deepEqual(a.checkpoint().physics, b.checkpoint().physics);
      const cp = a.checkpoint();
      a.step(30);
      const expected = a.checkpoint();
      a.restore(cp);
      a.step(30);
      b.restore(cp);
      for (let i = 0; i < 30; i++) b.advanceTime(1000 / 120);
      assert.deepEqual(b.checkpoint().physics, expected.physics);
      assert.deepEqual(b.checkpoint().power, expected.power);
      assert.deepEqual(a.checkpoint().physics, expected.physics);
      assert.deepEqual(a.checkpoint().power, expected.power);
      assert.equal(state(a).power.couplers[0].opened, true);
      const bad = structuredClone(expected);
      bad.power.couplers[0].opened = false;
      bad.power.couplers[0].reasonCode = 'OFF';
      const before = a.checkpoint();
      assert.throws(() => a.restore(bad));
      assert.deepEqual(a.checkpoint(), before);
    } finally {
      a.dispose();
      b.dispose();
    }
  }
});
test('moving released cargo keeps independent momentum and gravity energy accounting', async () => {
  const c = configuration();
  for (const body of c.bodies) body.velocity = [2, 1, 0];
  const s = await createSession(c);
  try {
    const before = state(s).physics;
    assert.equal(s.act({ type: 'receiver', node: 3, duty: 1 }).ok, true);
    s.step(12);
    assert.equal(state(s).power.couplers[0].opened, true);
    const after = state(s).physics,
      t = 12 / 120;
    for (let i = 0; i < after.length; i++) {
      assert.ok(Math.abs(after[i].velocity[0] - 2) < 1e-9);
      assert.ok(Math.abs(after[i].velocity[1] - (1 - 9.81 * t)) < 1e-8);
      const m = c.bodies[i].mass,
        ke = 0.5 * m * after[i].velocity.reduce((n, v) => n + v * v, 0),
        initial = 0.5 * m * 5;
      const potential = m * 9.81 * (after[i].position[1] - before[i].position[1]);
      assert.ok(
        Math.abs(ke - initial + potential) < m * 0.011,
        'discrete gravity energy error bounded independently',
      );
    }
  } finally {
    s.dispose();
  }
});
test('Build restores authored latch and receiver controls after release and saves stay authored', async () => {
  const bp = couplerFixture(),
    w = await createWorkshop(bp);
  try {
    assert.equal((await w.act({ type: 'run' })).ok, true);
    assert.equal((await w.act({ type: 'control', id: 'keys', duty: 1 })).ok, true);
    w.step(12);
    assert.equal(state(w).power.couplers[0].opened, true);
    assert.deepEqual(w.save(), bp);
    assert.equal((await w.act({ type: 'build' })).ok, true);
    assert.equal(state(w).power.couplers[0].opened, false);
    assert.deepEqual(w.save(), bp);
    assert.equal((await w.act({ type: 'run' })).ok, true);
    w.step(12);
    assert.equal(state(w).power.couplers[0].opened, false);
  } finally {
    w.dispose();
  }
});
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';
test('shared-cell motor funds the changed rotor response on the opening tick without stale allocation', async () => {
  let b = createEmptyBlueprint('rotating-load', 'Rotating load');
  for (const [i, type] of [
    'poweredMotor',
    'gripWheel',
    'releaseCoupler',
    'spacerBlock',
    'powerCell',
    'commandReceiver',
  ].entries())
    b.parts.push(createPart(type, 'p' + i, [i, 2, 0]));
  const shaft = {
    id: 'shaft',
    kind: 'shaft',
    a: { part: 'p0', port: 'shaft' },
    b: { part: 'p1', port: 'axle' },
  };
  b = snapConnection(b, shaft.a, shaft.b);
  b.connections.push(shaft);
  for (const [id, part, targetPart] of [
    ['mount', 'p2', 'p1'],
    ['latch', 'p3', 'p2'],
  ])
    b = proposeSurfaceMount(b, {
      id,
      part,
      sourceRegion: 'left',
      targetPart,
      targetRegion: 'right',
      u: 0,
      v: 0,
      twist: 0,
    }).blueprint;
  for (const part of ['p0', 'p2'])
    b.connections.push({
      id: 'power-' + part,
      kind: 'power',
      a: { part: 'p4', port: 'power' },
      b: { part, port: 'power' },
    });
  b.connections.push({
    id: 'keys',
    kind: 'signal',
    a: { part: 'p5', port: 'signal' },
    b: { part: 'p2', port: 'signal' },
  });
  const c = compileAssembly(b, { ground: null, gravity: [0, 0, 0] }).configuration,
    s = await createSession(c);
  try {
    s.step(10);
    assert.ok(Math.abs(state(s).physics[1].angularVelocity[0]) > 0.1);
    s.act({ type: 'receiver', node: 5, duty: 1 });
    s.step(20);
    assert.equal(state(s).power.couplers[0].opened, true);
    assert.equal(s.failureBundle(), null);
    const p = state(s).power,
      cell = c.power.cells[0],
      motor = p.motors[0],
      coil = p.couplers[0];
    assert.ok(
      Math.abs(
        cell.initialJ -
          p.cells[0].energyJ -
          p.cells[0].heatJ -
          motor.heatJ -
          motor.driverHeatJ -
          motor.shaftWorkJ -
          coil.heatJ -
          motor.energyResidualJ,
      ) < 1e-7,
    );
    const cp = s.checkpoint();
    s.step(10);
    const expected = s.checkpoint();
    s.restore(cp);
    s.step(10);
    assert.deepEqual(s.checkpoint().physics, expected.physics);
  } finally {
    s.dispose();
  }
});

import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
import { createRetry } from '../src/application/retry.mjs';
test('every authored material releases with its own mass and post-release ground contacts', async () => {
  for (const material of Object.keys(MATERIALS)) {
    const b = couplerFixture();
    for (const part of b.parts.slice(0, 2)) part.authoredMaterial.body = material;
    const c = compileAssembly(b).configuration,
      s = await createSession(c);
    const expectedMass = b.parts.slice(0, 2).map((part) => {
      const h = CATALOG[part.type].primitives[0].halfExtents;
      return 8 * h[0] * h[1] * h[2] * MATERIALS[material].density;
    });
    for (let i = 0; i < 2; i++)
      assert.ok(
        Math.abs(c.bodies[i].mass - expectedMass[i]) < 1e-12,
        material + ' density times volume',
      );
    try {
      s.act({ type: 'receiver', node: 3, duty: 1 });
      s.step(12);
      assert.equal(state(s).power.couplers[0].opened, true, material);
      const cp = s.checkpoint();
      s.act({ type: 'impulse', body: 1, value: [0.01, 0, 0] });
      s.step(1);
      assert.ok(
        Math.abs(state(s).physics[1].velocity[0] - 0.01 / expectedMass[1]) < 1e-9,
        material,
      );
      assert.ok(Math.abs(state(s).physics[0].velocity[0]) < 1e-9, 'coupler is detached');
      let contacted = false;
      for (let i = 0; i < 120; i++) {
        s.step(1);
        contacted ||= state(s).contacts.rows.some(
          (r) => (r.a === 1 && r.b === b.parts.length) || (r.b === 1 && r.a === b.parts.length),
        );
      }
      assert.ok(contacted, material + ' cargo contacts environment');
      s.restore(cp);
      assert.equal(state(s).power.couplers[0].opened, true);
    } finally {
      s.dispose();
    }
  }
});
test('Try again clears partial and opened latch state and permits a new powered release', async () => {
  for (const ticks of [2, 12]) {
    const w = await createWorkshop(couplerFixture());
    const retry = createRetry({ prepare() {}, execute: (c) => w.act(c), finish() {} });
    try {
      await w.act({ type: 'run' });
      await w.act({ type: 'control', id: 'keys', duty: 1 });
      w.step(ticks);
      assert.ok(
        ticks === 2 ? state(w).power.couplers[0].progressJ > 0 : state(w).power.couplers[0].opened,
      );
      await w.act({ type: 'control', id: 'keys', duty: 0 });
      assert.equal((await retry.run()).ok, true);
      const reset = state(w).power.couplers[0];
      assert.equal(reset.opened, false);
      assert.equal(reset.progressJ, 0);
      assert.equal(reset.heatJ, 0);
      w.step(12);
      assert.equal(state(w).power.couplers[0].opened, false);
      await w.act({ type: 'control', id: 'keys', duty: 1 });
      w.step(12);
      assert.equal(state(w).power.couplers[0].opened, true);
    } finally {
      w.dispose();
    }
  }
});
