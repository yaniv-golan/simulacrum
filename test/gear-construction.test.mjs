import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { normalizeFailure, explainFailure } from '../src/model/messages.mjs';
const saved = () =>
  JSON.parse(readFileSync(new URL('./fixtures/gear-construction.json', import.meta.url), 'utf8'));

test('ordinary grounded transmission runs at default motor current; dropped mesh stops honestly and Build permits repair', async () => {
  const grounded = saved();
  assert.equal(grounded.parts.find((p) => p.id === 'part-3').parameters.currentLimit, 10);
  const w = await createWorkshop(grounded);
  const read = () => w.observe().frames[0];
  try {
    assert.equal((await w.act({ type: 'run' })).ok, true);
    w.step(120);
    assert.equal(read().tick, 120);
    const small = read().physics[3].angularVelocity[0],
      large = read().physics[4].angularVelocity[0];
    assert.ok(Math.abs(small) > 0.1 && small * large < 0);
    assert.equal((await w.act({ type: 'build' })).ok, true);
    const base = grounded.parts[0];
    assert.equal(
      (
        await w.act({
          type: 'transform',
          id: base.id,
          position: [base.position[0], 0.25, base.position[2]],
          rotation: base.rotation,
        })
      ).ok,
      true,
    );
    assert.equal((await w.act({ type: 'run' })).ok, true);
    let previous;
    assert.throws(
      () => {
        for (let i = 0; i < 120; i++) {
          previous = read();
          w.step(1);
        }
      },
      { reasonCode: 'GEAR_MOTION_LIMIT' },
    );
    const failed = read(),
      bundle = w.failureBundle();
    assert.equal(bundle.reasonCode, 'GEAR_MOTION_LIMIT');
    assert.equal(normalizeFailure(failed.failure).reasonCode, 'GEAR_MOTION_LIMIT');
    assert.match(explainFailure(failed.failure), /Gear motion exceeded.*Return to Build/);
    assert.equal(bundle.failedTick, previous.tick + 1);
    assert.equal(failed.tick, previous.tick);
    assert.deepEqual(
      failed.physics,
      previous.physics,
      'failure exposes the last completed physical state',
    );
    assert.deepEqual(failed.gears, previous.gears);
    assert.equal((await w.act({ type: 'build' })).ok, true);
    assert.equal(read().tick, 0);
    assert.equal(
      (
        await w.act({
          type: 'transform',
          id: base.id,
          position: base.position,
          rotation: base.rotation,
        })
      ).ok,
      true,
    );
    assert.equal((await w.act({ type: 'run' })).ok, true);
    w.step(120);
    assert.equal(read().tick, 120);
  } finally {
    w.dispose();
  }
});
