import { createLearningDelivery } from '../../src/model/fixtures/learning-delivery.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createProgramExecutors } from '../../src/scripting/controller-executors.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../../src/model/tick.mjs';
import { createHash } from 'node:crypto';
const bp = createLearningDelivery(),
  l = compileAssembly(bp).configuration.power.controllers.find((c) => c.learning).learning,
  defs = (rows) => rows.map(({ node, ...r }) => r);
const weights = Array(68).fill(0);
weights[1] = 1;
weights[55] = -0.4;
weights[62] = 0.4;
bp.parts.find((p) => p.type === 'learningController').learningModel = {
  version: 2,
  inputs: defs(l.inputs),
  outputs: defs(l.outputs),
  hidden: 6,
  weights,
  scaling: 'fixed-physical-status-v2',
};
if (process.argv[3] === 'rename') {
  const ids = new Map(bp.parts.map((p, i) => [p.id, `renamed-${i}`]));
  bp.name = 'Different task';
  bp.id = 'different';
  for (const p of bp.parts) {
    p.id = ids.get(p.id);
    p.name = 'Unrelated ' + p.id;
    if (p.targetBinding) p.targetBinding = ids.get(p.targetBinding);
  }
  for (const [i, c] of bp.connections.entries()) {
    c.id = `edge-${i}`;
    c.a.part = ids.get(c.a.part);
    c.b.part = ids.get(c.b.part);
  }
}
const session = await createSession(
    compileAssembly(bp).configuration,
    undefined,
    undefined,
    undefined,
    createProgramExecutors,
  ),
  hashes = [],
  duties = [];
try {
  for (let t = 1; t <= 120; t++) {
    if (t === 3)
      for (const o of l.outputs)
        session.act({ type: 'receiver-mode', node: o.node, mode: 'learned' });
    if (process.argv[2] === 'elapsed') {
      session.advanceTime(DT * 1000 * 0.25);
      session.advanceTime(DT * 1000 * 0.75);
    } else session.step();
    const f = session.observe().frames[0];
    if (f.tick !== t) throw Error('Clock did not reach tick');
    hashes.push(
      createHash('sha256')
        .update(JSON.stringify(deterministicProjection(f)))
        .digest('hex'),
    );
    duties.push(f.receiverControl.receivers[0].duty);
  }
  console.log(JSON.stringify({ pid: process.pid, hashes, duties }));
} finally {
  session.dispose();
}
