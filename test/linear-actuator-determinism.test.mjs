import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('powered linear reversal and release match four processes and both production clocks', () => {
  const runs = ['step', 'step', 'elapsed', 'elapsed'].map((driver) =>
    JSON.parse(
      execFileSync(process.execPath, ['test/fixtures/linear-run.mjs', driver], {
        encoding: 'utf8',
      }),
    ),
  );
  assert.equal(new Set(runs.map((r) => r.pid)).size, 4);
  for (const r of runs) assert.deepEqual(r.hashes, runs[0].hashes);
  const wrong = structuredClone(runs[0]);
  wrong.hashes[60] = 'wrong';
  assert.notDeepEqual(wrong.hashes, runs[0].hashes);
});

import { configuration } from './fixtures/linear-machine.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { replayBundle } from '../scripts/replay.mjs';
test('powered linear failure bundle replays reversal and rejects a missing failure input', async () => {
  const s = await createSession(configuration(), { build: 'linear-replay-test' });
  try {
    s.step(120);
    s.act({ type: 'receiver', node: 3, duty: -1 });
    s.step(20);
    s.act({ type: 'impulse', body: 1, value: [2 * Math.sqrt(Number.MAX_VALUE), 0, 0] });
    assert.throws(() => s.step());
    const bundle = s.failureBundle();
    assert.equal((await replayBundle(bundle)).matched, true);
    const wrong = structuredClone(bundle);
    wrong.inputs.find((x) => x.command.type === 'impulse').command.value = [0, 0, 0];
    await assert.rejects(() => replayBundle(wrong), /did not fail/);
    const wrongReversal = structuredClone(bundle);
    const reversal = wrongReversal.inputs.find((x) => x.command.type === 'receiver');
    assert.equal(reversal.command.duty, -1);
    reversal.command.duty = 1;
    await assert.rejects(
      () => replayBundle(wrongReversal),
      /completed deterministic projection mismatch/,
    );
  } finally {
    s.dispose();
  }
});
