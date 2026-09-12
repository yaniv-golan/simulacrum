import { createEmptyBlueprint, createPart } from '../../src/model/blueprint.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { createHash } from 'node:crypto';
const bp = createEmptyBlueprint('clock', 'Clock');
bp.parts = [createPart('beam', 'a', [0, 3, 0]), createPart('plate', 'b', [0, 1, 0])];
bp.connections = [
  {
    id: 'r',
    kind: 'rope',
    a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
    b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
    rope: { restLength: 1.97, diameter: 0.02, segments: 8, material: 'nylon' },
  },
];
const c = compileAssembly(bp, { ground: null }).configuration;
c.bodies[0].fixed = true;
const s = await createSession(c);
try {
  const hashes = [];
  for (let i = 0; i < 120; i++) {
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
