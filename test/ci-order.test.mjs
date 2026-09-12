import test from 'node:test';
import assert from 'node:assert/strict';
import { runCI } from '../scripts/ci.mjs';
test('CI stops at a failed structural prerequisite before any unit work', async () => {
  let units = 0,
    modules = 0;
  const context = {
    check: async (id, config, fn) => (id === 'environment:localhost' ? undefined : fn()),
    withDeadline: async (ms, fn) => fn(),
    module: async () => {
      modules++;
      throw Error('injected structural failure');
    },
    unit: async () => {
      units++;
    },
  };
  await assert.rejects(runCI(context), /structural checks failed/);
  assert.equal(units, 0);
  assert.equal(modules, 1);
});

test('a late documentation failure still precedes invariant unit execution', async () => {
  let units = 0;
  const context = {
    check: async (id, config, fn) => (id === 'environment:localhost' ? undefined : fn()),
    withDeadline: async (ms, fn) => fn(),
    module: async (id) => {
      if (id === 'structural:developer-documentation') throw Error('stale docs');
    },
    unit: async () => {
      units++;
    },
  };
  await assert.rejects(runCI(context), /structural checks failed/);
  assert.equal(units, 0);
});

test('CI admits invariant and remaining unit files through a single pool', async () => {
  const pools = [];
  const context = {
    identity: {},
    receipts: () => [],
    check: async (id, config, fn) => (id === 'environment:localhost' ? undefined : fn()),
    withDeadline: async (ms, fn) => fn(),
    module: async () => {},
    unit: async (files) => pools.push(files),
  };
  await runCI(context);
  assert.equal(pools.length, 1);
  assert.ok(pools[0].includes('test/verification-run.test.mjs'));
  assert.equal(new Set(pools[0]).size, pools[0].length);
});
