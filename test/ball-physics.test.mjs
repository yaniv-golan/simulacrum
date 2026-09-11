import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { compileBody } from '../src/model/compile-body.mjs';
const sphere = (y = 1) => compileBody(createPart('ball', 'ball', [0, y, 0]));
const floor = {
  ...sphere(0),
  shape: 'box',
  halfExtents: [10, 0.01, 10],
  fixed: true,
  restitution: 0,
  friction: 1,
  position: [0, -0.01, 0],
};

test('sphere free fall and contact restitution follow analytic motion; checkpoint crosses impact', async () => {
  const body = { ...sphere(1), restitution: 0.8 };
  const w = await createPhysicsWorld({ gravity: [0, -9.81, 0], bodies: [body, floor], joints: [] });
  try {
    for (let i = 0; i < 24; i++) w.step();
    assert.ok(Math.abs(w.read()[0].position[1] - (1 - (9.81 * 0.2 ** 2) / 2)) < 0.01);
    const snapshot = w.snapshot();
    let previous = w.read()[0].velocity[1],
      bounce = null;
    for (let t = 0; t < 96; t++) {
      w.step();
      const v = w.read()[0].velocity[1];
      if (previous < -1 && v > 0) bounce = v / -previous;
      previous = v;
    }
    assert.ok(Math.abs(bounce - 0.4) < 0.04, 'default pair average gives e=0.4, not ball e=0.8');
    const expected = w.snapshot();
    w.restore(snapshot);
    for (let i = 0; i < 96; i++) w.step();
    assert.deepEqual(w.snapshot(), expected);
  } finally {
    w.dispose();
  }
});

test('solid sphere rolls down an incline; zero grip slides instead', async () => {
  const theta = 0.1,
    normal = [-Math.sin(theta), Math.cos(theta), 0];
  const run = async (friction) => {
    const ball = { ...sphere(), position: normal.map((v) => v * 0.05), friction };
    const plane = {
      ...floor,
      position: normal.map((v) => -v * 0.01),
      rotation: [0, 0, Math.sin(theta / 2), Math.cos(theta / 2)],
      friction,
    };
    const w = await createPhysicsWorld({
      gravity: [0, -9.81, 0],
      bodies: [ball, plane],
      joints: [],
    });
    try {
      for (let t = 0; t < 120; t++) w.step();
      return w.read()[0];
    } finally {
      w.dispose();
    }
  };
  const rolling = await run(1),
    sliding = await run(0);
  const speed = -rolling.velocity[0] * Math.cos(theta) - rolling.velocity[1] * Math.sin(theta);
  assert.ok(Math.abs(speed - (5 * 9.81 * Math.sin(theta)) / 7) < 0.035);
  assert.ok(Math.abs(speed - Math.abs(rolling.angularVelocity[2]) * 0.05) < 0.01);
  assert.ok(Math.abs(sliding.angularVelocity[2]) < 1e-6);
  assert.ok(-sliding.velocity[0] > -rolling.velocity[0] * 1.3);
});

test('minimum ball cannot tunnel through a thin plate at the default spring energy bound', async () => {
  const part = createPart('ball', 'fast', [0, 0.2, 0]);
  part.parameters.diameter = 0.02;
  const body = { ...compileBody(part), velocity: [0, -54, 0] };
  for (const fixed of [true, false]) {
    const w = await createPhysicsWorld({
      gravity: [0, 0, 0],
      bodies: [body, { ...floor, fixed, mass: 100 }],
      joints: [],
    });
    try {
      w.step();
      assert.ok(
        w.read()[0].position[1] - w.read()[1].position[1] >= 0.018,
        '54 m/s into fixed or moving 2cm plate must remain above its surface',
      );
    } finally {
      w.dispose();
    }
  }
});

test('rolling drop agrees in four fresh processes and both production clock paths', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const execute = promisify(execFile);
  const runs = await Promise.all(
    ['step', 'step', 'elapsed', 'elapsed'].map(async (driver) => {
      const { stdout } = await execute(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/ball-run.mjs', import.meta.url)), driver],
        { timeout: 30000 },
      );
      return JSON.parse(stdout);
    }),
  );
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  for (const run of runs) {
    assert.equal(run.hashes.length, 180);
    assert.deepEqual(run.hashes, runs[0].hashes);
  }
});

test('rolling drop leaves its beam, flies and contacts the moving spring plate', async () => {
  const { createBallDrop } = await import('../src/model/fixtures/ball-drop.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  const bp = createBallDrop(),
    s = await createSession(compileAssembly(bp).configuration);
  const ball = bp.parts.findIndex((p) => p.id === 'ball'),
    ramp = bp.parts.findIndex((p) => p.id === 'ramp'),
    plate = bp.parts.findIndex((p) => p.id === 'platform');
  let rolled = false,
    flight = false,
    landed = false,
    hitLength = null,
    compressed = false;
  try {
    for (let t = 0; t < 210; t++) {
      s.step();
      const f = s.observe().frames[0],
        rows = f.contacts.rows.filter((c) => c.available && c.solved && [c.a, c.b].includes(ball));
      const b = f.physics[ball];
      rolled ||=
        rows.some((c) => [c.a, c.b].includes(ramp)) &&
        b.position[0] > -0.4 &&
        Math.hypot(...b.angularVelocity) > 1;
      flight ||= rolled && !rows.length && b.velocity[1] < -0.1;
      if (flight && rows.some((c) => [c.a, c.b].includes(plate))) {
        landed = true;
        hitLength ??= f.springs[0].length;
      }
      compressed ||= landed && f.springs[0].length < hitLength - 0.001;
    }
    assert.ok(
      rolled && flight && landed && compressed,
      JSON.stringify({ rolled, flight, landed, compressed }),
    );
  } finally {
    s.dispose();
  }
});
