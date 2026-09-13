import { createPart, createEmptyBlueprint } from '../../src/model/blueprint.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { DT, deterministicProjection } from '../../src/model/tick.mjs';
import { digest } from './m1-run.mjs';
const bp = createEmptyBlueprint('lamp-trace', 'Lamp trace');
bp.parts = [
  createPart('powerCell', 'cell', [0, 1, 0]),
  createPart('poweredLamp', 'lamp', [1, 1, 0]),
  createPart('commandReceiver', 'receiver', [2, 1, 0]),
];
bp.connections = [
  {
    id: 'p',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'lamp', port: 'power' },
  },
  {
    id: 's',
    kind: 'signal',
    a: { part: 'receiver', port: 'signal' },
    b: { part: 'lamp', port: 'signal' },
  },
];
const { configuration } = compileAssembly(bp),
  session = await createSession(configuration),
  driver = process.argv[2],
  hashes = [];
try {
  for (let tick = 1; tick <= 120; tick++) {
    if (tick === 1 || tick === 61) {
      const result = session.act({ type: 'receiver', node: 2, duty: tick === 1 ? 0.75 : 0 });
      if (!result.ok) throw Error(result.reasonCode);
    }
    if (driver === 'step') session.step(1);
    else {
      session.advanceTime(DT * 250);
      session.advanceTime(DT * 750);
    }
    const f = session.observe().frames[0];
    if (f.tick !== tick) throw Error('clock mismatch');
    hashes.push({ tick, hash: digest(deterministicProjection(f)) });
  }
  process.stdout.write(
    JSON.stringify({
      pid: process.pid,
      driver,
      hashes,
      energy: session.observe().frames[0].power.lamps[0].deliveredEnergyJ,
    }),
  );
} finally {
  session.dispose();
}
