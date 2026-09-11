import test from 'node:test';
import assert from 'node:assert/strict';

test('default ball launcher enters and remains in its ordinary catcher for two seconds', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  const bp = createSpringLauncher(),
    cfg = compileAssembly(bp).configuration;
  const session = await createSession(cfg),
    i = bp.parts.findIndex((p) => p.id === 'projectile');
  const receiver = bp.parts.findIndex((p) => p.id === 'release');
  let contact = false,
    retained = 0;
  try {
    for (let tick = 1; tick <= 840; tick++) {
      if (tick === 241) session.act({ type: 'receiver', node: receiver, duty: 1 });
      session.step();
      const f = session.observe().frames[0],
        p = f.physics[i].position;
      contact ||= f.contacts.rows.some(
        (c) =>
          c.available &&
          c.solved &&
          [c.a, c.b].includes(i) &&
          [c.a, c.b].some((n) => bp.parts[n]?.id.startsWith('catcher-')),
      );
      if (contact && p[0] > -1.85 && p[0] < -1.34 && p[2] > -0.31 && p[2] < 0.21 && p[1] < 0.22)
        retained++;
      else retained = 0;
      if (retained >= 240) break;
    }
    assert.equal(contact, true);
    assert.ok(retained >= 240, 'retention is consecutive completed ticks, not passing the opening');
  } finally {
    session.dispose();
  }
});

test('ball launch energy exceeds all accounted non-spring sources without creating energy', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { launchTrial, assertReleaseEnergy } = await import('./contracts/launcher-energy.mjs');
  const trial = await launchTrial(createSpringLauncher());
  assertReleaseEnergy(trial);
  assert.ok(trial.transfer > 0);
  // Energy is measured at one second. The heavier sphere stays on the pusher longer;
  // independently require separation within the existing journey's 2.5-second bound.
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  const bp = createSpringLauncher(),
    session = await createSession(compileAssembly(bp).configuration);
  const ball = bp.parts.findIndex((p) => p.id === 'projectile'),
    pusher = bp.parts.findIndex((p) => p.id === 'pusher-roller'),
    receiver = bp.parts.findIndex((p) => p.id === 'release');
  try {
    for (let tick = 1; tick <= 570; tick++) {
      if (tick === 241) session.act({ type: 'receiver', node: receiver, duty: 1 });
      session.step();
      if (tick >= 540) {
        const f = session.observe().frames[0];
        assert.ok(f.physics[pusher].position[0] - f.physics[ball].position[0] > 0.15);
        assert.ok(
          !f.contacts.rows.some(
            (c) =>
              c.available &&
              c.solved &&
              [c.a, c.b].includes(ball) &&
              [c.a, c.b].includes(pusher) &&
              Math.hypot(...c.normalImpulse) > 1e-8,
          ),
        );
      }
    }
  } finally {
    session.dispose();
  }
  assert.throws(() => assertReleaseEnergy({ ...trial, alternative: trial.gain }), /alternative/);
});
