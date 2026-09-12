import assert from 'node:assert/strict';
import { replayBundle } from '../../scripts/replay.mjs';
import { createHash } from 'node:crypto';
import { createSession } from '../../src/simulation/session.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { deterministicProjection } from '../../src/model/tick.mjs';
import { couplerFixture } from './release.mjs';
const b = couplerFixture();
if (process.argv.includes('rename')) {
  const ids = new Map(b.parts.map((p, i) => [p.id, 'changed-' + i]));
  for (const p of b.parts) {
    p.id = ids.get(p.id);
    p.name = 'Unrelated name';
  }
  for (const c of b.connections) {
    c.id = 'other-' + c.id;
    c.a.part = ids.get(c.a.part);
    c.b.part = ids.get(c.b.part);
  }
}
const s = await createSession(compileAssembly(b, { ground: null }).configuration);
try {
  s.act({ type: 'receiver', node: 3, duty: 1 });
  const advance = () => (process.argv.includes('elapsed') ? s.advanceTime(1000 / 120) : s.step(1));
  for (let i = 0; i < 2; i++) advance();
  s.act({ type: 'receiver', node: 3, duty: 0 });
  advance();
  assert.equal(s.observe().frames.at(-1).power.couplers[0].progressJ, 0);
  s.act({ type: 'receiver', node: 3, duty: 1 });
  const cp = s.checkpoint();
  const continueRun = () => {
    const trace = [];
    for (let i = 0; i < 37; i++) {
      advance();
      trace.push(deterministicProjection(s.observe().frames.at(-1)));
    }
    return trace;
  };
  const uninterrupted = continueRun();
  s.restore(cp);
  assert.deepEqual(continueRun(), uninterrupted, 'restored trace under selected production driver');
  const frame = s.observe().frames.at(-1);
  if (!frame.power.couplers[0].opened) throw Error('release did not happen');
  s.act({ type: 'impulse', body: 1, value: [2 * Math.sqrt(Number.MAX_VALUE), 0, 0] });
  assert.throws(advance);
  const bundle = s.failureBundle();
  assert.equal((await replayBundle(bundle)).matched, true);
  const wrong = structuredClone(bundle);
  wrong.completed.power.couplers[0].opened = false;
  await assert.rejects(() => replayBundle(wrong), /projection mismatch/);
  console.log(createHash('sha256').update(JSON.stringify(uninterrupted)).digest('hex'));
} finally {
  s.dispose();
}
