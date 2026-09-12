import { createSession } from '../../src/simulation/session.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createGearLift } from '../../src/model/fixtures/gear-lift.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { createHash } from 'node:crypto';
const session = await createSession(compileAssembly(createGearLift()).configuration);
try {
  const hashes = [];
  for (let i = 0; i < 180; i++) {
    if (process.argv[2] === 'elapsed') {
      session.advanceTime(DT * 250);
      session.advanceTime(DT * 750);
    } else session.step(1);
    hashes.push(
      createHash('sha256')
        .update(JSON.stringify(deterministicProjection(session.observe().frames[0])))
        .digest('hex'),
    );
  }
  console.log(JSON.stringify({ pid: process.pid, hashes }));
} finally {
  session.dispose();
}
