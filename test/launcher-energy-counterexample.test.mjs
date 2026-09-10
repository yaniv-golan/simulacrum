import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchControls, assertReleaseEnergy } from './contracts/launcher-energy.mjs';

test('launcher energy acceptance rejects a funded gate even when its unloaded controls stay quiet', async () => {
  const old = JSON.parse(
    readFileSync(
      new URL('./fixtures/spring-reference/powered-gate-counterexample.json', import.meta.url),
    ),
  );
  const [strike, ...quiet] = await launchControls(() => structuredClone(old));
  assert.ok(
    quiet.every((control) => control.gain <= 0.1 * strike.gain),
    'quiet controls alone cannot establish a release',
  );
  assert.throws(
    () => assertReleaseEnergy(strike),
    /release energy/,
    'real funded gate fails even with quiet controls',
  );
});
