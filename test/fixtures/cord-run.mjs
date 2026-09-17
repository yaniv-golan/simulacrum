import { createEmptyBlueprint, createPart } from '../../src/model/blueprint.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { createHash } from 'node:crypto';
// The second argument selects the mid-domain cord or the stiffest authored
// corner, whose rows are the stiffest and whose nodes the lightest a player can
// author; both must project identically across processes and clock drivers.
const corner = process.argv[3] === 'corner';
const bp = createEmptyBlueprint('clock', 'Clock');
bp.parts = [
  createPart('beam', 'a', [0, 1, 0]),
  createPart(corner ? 'beam' : 'plate', 'b', [0, corner ? 0.9 : 0.6, 0]),
];
if (corner) bp.parts[1].parameters.length = 0.1;
bp.connections = [
  {
    id: 'c',
    kind: 'cord',
    a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
    b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
    cord: corner
      ? {
          restLength: 0.08,
          stiffness: 300,
          damping: 0,
          diameter: 0.004,
          segments: 8,
          material: 'bungee',
        }
      : {
          restLength: 0.3,
          stiffness: 300,
          damping: 8,
          diameter: 0.008,
          segments: 4,
          material: 'rubber',
        },
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
