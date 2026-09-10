import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpringLauncher } from '../src/model/fixtures/spring-launcher.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';

test('launcher release checkpoint repeats exactly and a half-turn reverses its physical trajectory', async () => {
  const { deterministicProjection } = await import('../src/model/tick.mjs');
  const runs = [];
  for (const turned of [false, true]) {
    const bp = createSpringLauncher();
    if (turned)
      for (const p of bp.parts) {
        const [x, y, z, w] = p.rotation;
        p.rotation = [z, w, -x, -y]; // proper 180 degree world-Y rotation
        p.position = [-p.position[0], p.position[1], -p.position[2]];
      }
    const s = await createSession(compileAssembly(bp).configuration);
    const projectile = bp.parts.findIndex((p) => p.id === 'projectile');
    const node = bp.parts.findIndex((p) => p.id === 'release');
    try {
      s.step(240);
      const held = s.observe().frames[0].physics[projectile].position;
      s.act({ type: 'receiver', node, duty: 1 });
      const cp = s.checkpoint();
      s.step(360);
      const expected = deterministicProjection(s.observe().frames[0]);
      s.restore(cp);
      s.step(360);
      assert.deepEqual(deterministicProjection(s.observe().frames[0]), expected);
      const end = s.observe().frames[0].physics[projectile].position;
      runs.push(end.map((v, k) => (v - held[k]) * (turned && k !== 1 ? -1 : 1)));
      assert.ok(runs.at(-1)[0] < -0.4, 'restoring queued release still clears the bed');
      // A second command cannot replenish the spent spring or rewind the projectile.
      const beforeRepeat = end[0];
      s.act({ type: 'receiver', node, duty: 1 });
      s.step();
      assert.ok(
        Math.abs(s.observe().frames[0].physics[projectile].position[0] - beforeRepeat) < 0.02,
      );
    } finally {
      s.dispose();
    }
  }
  for (let k = 0; k < 3; k++)
    assert.ok(
      Math.abs(runs[0][k] - runs[1][k]) < 0.01,
      'rotated physical launch agrees within one quarter gate thickness',
    );
});
