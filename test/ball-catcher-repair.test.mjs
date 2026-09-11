import test from 'node:test';
import assert from 'node:assert/strict';

test('an ordinary preload edit repairs a real shortfall after moving the catcher farther', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  for (const [restLength, expectCatch] of [
    [0.25, false],
    [0.3, true],
  ]) {
    const bp = createSpringLauncher();
    for (const part of bp.parts) if (part.id.startsWith('catcher-')) part.position[0] -= 0.1;
    bp.parts.find((p) => p.id === 'guide').parameters.restLength = restLength;
    const s = await createSession(compileAssembly(bp).configuration),
      ball = bp.parts.findIndex((p) => p.id === 'projectile'),
      receiver = bp.parts.findIndex((p) => p.id === 'release');
    let contact = false,
      retained = 0,
      caught = false;
    try {
      for (let tick = 1; tick <= 1440; tick++) {
        if (tick === 241) s.act({ type: 'receiver', node: receiver, duty: 1 });
        s.step();
        const f = s.observe().frames[0],
          p = f.physics[ball].position;
        contact ||= f.contacts.rows.some(
          (c) =>
            c.available &&
            c.solved &&
            Math.hypot(...c.normalImpulse) > 1e-8 &&
            [c.a, c.b].includes(ball) &&
            [c.a, c.b].some((n) => bp.parts[n]?.id.startsWith('catcher-')),
        );
        if (contact && p[0] > -1.95 && p[0] < -1.44 && p[2] > -0.31 && p[2] < 0.21 && p[1] < 0.22)
          retained++;
        else retained = 0;
        caught ||= retained >= 240;
      }
      assert.equal(caught, expectCatch, 'same farther catcher; only authored restLength changes');
    } finally {
      s.dispose();
    }
  }
});
