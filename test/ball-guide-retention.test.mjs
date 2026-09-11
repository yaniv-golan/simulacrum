import test from 'node:test';
import assert from 'node:assert/strict';

test('ball side guides retain a held projectile; removing them permits sideways escape', async () => {
  const { createSpringLauncher } = await import('../src/model/fixtures/spring-launcher.mjs');
  const { compileAssembly } = await import('../src/model/assembly.mjs');
  const { createSession } = await import('../src/simulation/session.mjs');
  for (const guided of [true, false]) {
    const bp = createSpringLauncher();
    if (!guided) {
      bp.parts = bp.parts.filter((p) => !p.id.startsWith('ball-guide-'));
      bp.connections = bp.connections.filter(
        (c) => !c.a.part.startsWith('ball-guide-') && !c.b.part.startsWith('ball-guide-'),
      );
    }
    const s = await createSession(compileAssembly(bp).configuration),
      i = bp.parts.findIndex((p) => p.id === 'projectile'),
      base = bp.parts.findIndex((p) => p.id === 'base');
    const start = bp.parts[i].position[0] - bp.parts[base].position[0];
    let escaped = false;
    try {
      for (let tick = 1; tick <= 2400; tick++) {
        s.step();
        const f = s.observe().frames[0];
        escaped ||= Math.abs(f.physics[i].position[0] - f.physics[base].position[0] - start) > 0.02;
        if (escaped) break;
      }
      assert.equal(escaped, !guided, 'twenty-second hold needs actual lateral support');
    } finally {
      s.dispose();
    }
  }
});
