import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostReadiness, ADVISORY } from '../scripts/verify-host.mjs';

// The probe evaluates one sample through the admission's own code for both reaches, reads the
// window owner, and holds nothing: no attempt, no report, no lock.
test('verify:host reports both reaches and the window from one sample without holding anything', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'verify-host-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const windows = join(tmpdir(), `simulacrum-verification-${process.getuid()}`);
  const listing = () => (existsSync(windows) ? readdirSync(windows).sort() : []);
  const before = listing();
  let samples = 0;
  const pressure = async () => {
    samples += 1;
    return {
      method: 'cpus+ps',
      idlePercent: 86,
      foreign: [
        { comm: 'WindowServer', pcpu: 48, pid: 400 },
        { comm: 'Google Chrome Helper', pcpu: 35, pid: 9 },
      ],
    };
  };
  const policy = { mode: 'enforce', idleBound: 80, foreignBound: 40 };
  const quiet = { cores: 14, load1: () => 2.5, pressure, owner: () => null, policy };
  const byId = (result) => Object.fromEntries(result.rows.map((row) => [row.id, row]));
  // The window server at 48 % refuses a timing-reach launch and admits a structural one, exactly
  // as the launch admission would; the exit verdict follows the requested reach.
  const timing = await hostReadiness({ ...quiet, reach: 'timing' });
  assert.equal(samples, 1);
  assert.equal(timing.admitted, false);
  assert.equal(timing.advisory, ADVISORY);
  const rows = byId(timing);
  assert.match(
    rows.pressure.detail,
    /idle 86 %, load1 2\.5 of 14 cores; busiest foreign: WindowServer 48 %, Google Chrome Helper 35 %/,
  );
  assert.match(rows['admission:timing'].error, /WindowServer 48 % \(foreign ≥ 40 %\)/);
  assert.equal(rows['admission:structural'].ok, true);
  assert.equal(rows.window.detail, 'free');
  const structural = await hostReadiness({ ...quiet, reach: 'structural' });
  assert.equal(structural.admitted, true);
  // A held window is named the way the wait notice names it, and refuses readiness.
  const held = await hostReadiness({
    ...quiet,
    reach: 'structural',
    owner: () => ({
      pid: 77,
      cwd: '/tmp/elsewhere',
      intent: { tier: 'merge', head: 'feature-x', destinationName: 'main', origin: '/tmp/wt-x' },
    }),
  });
  assert.equal(held.admitted, false);
  assert.equal(
    byId(held).window.error,
    'held by PID 77, merge on feature-x → destination main, /tmp/wt-x',
  );
  // An unavailable sampler is a row; the admission decides on load alone, as at launch.
  const blind = await hostReadiness({
    ...quiet,
    reach: 'timing',
    pressure: async () => ({
      method: 'unavailable',
      error: 'ps failed',
      idlePercent: null,
      foreign: [],
    }),
  });
  assert.equal(blind.admitted, true);
  assert.match(
    byId(blind).pressure.detail,
    /sampler unavailable \(ps failed\); the admission decides on load alone/,
  );
  // The default owner reader is the live window, read and never acquired.
  const live = await hostReadiness({ ...quiet, reach: 'structural', owner: undefined });
  assert.ok(['free', undefined].includes(byId(live).window.detail));
  // Load above the bound refuses either reach.
  const loaded = await hostReadiness({ ...quiet, reach: 'structural', load1: () => 9 });
  assert.equal(loaded.admitted, false);
  assert.match(byId(loaded)['admission:structural'].error, /host load 9 above bound 7/);
  await assert.rejects(hostReadiness({ ...quiet, reach: 'nightly' }), /needs a reach/);
  // Nothing was written: no window report, no lock, nothing in the scratch root.
  assert.deepEqual(listing(), before);
  assert.deepEqual(readdirSync(root), []);
});
