import { createHash } from 'node:crypto';
import { createBallDrop } from '../../src/model/fixtures/ball-drop.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
const s = await createSession(compileAssembly(createBallDrop()).configuration),
  hashes = [];
try {
  for (let tick = 0; tick < 180; tick++) {
    if (process.argv[2] === 'elapsed') s.advanceTime(DT * 1000);
    else s.step();
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
