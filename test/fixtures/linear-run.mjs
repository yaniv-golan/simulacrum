import { createSession } from '../../src/simulation/session.mjs';
import { configuration } from './linear-machine.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { createHash } from 'node:crypto';
const s = await createSession(configuration());
try {
  const hashes = [];
  for (let i = 0; i < 180; i++) {
    if (i === 60) s.act({ type: 'receiver', node: 3, duty: -1 });
    if (i === 120) s.act({ type: 'receiver', node: 3, duty: 0 });
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
