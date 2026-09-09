import { createSession } from '../../src/simulation/session.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createSpringPlayground } from '../../src/model/fixtures/spring-playground.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { createHash } from 'node:crypto';
const s = await createSession(compileAssembly(createSpringPlayground()).configuration);
try {
  const hashes = [];
  for (let i = 0; i < 240; i++) {
    if (process.argv[2] === 'elapsed') {
      s.advanceTime(DT * 250);
      s.advanceTime(DT * 750);
    } else s.step(1);
    hashes.push(
      createHash('sha256')
        .update(JSON.stringify(deterministicProjection(s.observe().frames[0])))
        .digest('hex'),
    );
  }
  console.log(JSON.stringify({ pid: process.pid, hashes }));
} finally {
  s.dispose();
}
