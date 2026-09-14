import test from 'node:test';
import assert from 'node:assert/strict';
import { samplePressure, PRESSURE_WINDOWS } from '../scripts/host-pressure.mjs';

const cpuTicks = (idle, busy) => [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }];
const rows = [
  { pid: 1, ppid: 0, comm: 'launchd', pcpu: 0.1 },
  { pid: 400, ppid: 1, comm: 'WindowServer', pcpu: 52.3 },
  { pid: 900, ppid: 1, comm: 'zoom.us', pcpu: 38.1 },
  { pid: 1000, ppid: 1, comm: 'node', pcpu: 12 }, // the tier
  { pid: 1001, ppid: 1000, comm: 'chrome-headless-shell', pcpu: 81 }, // its browser
  { pid: 1002, ppid: 1001, comm: 'chrome-headless-shell', pcpu: 30 },
  { pid: 2000, ppid: 1, comm: 'idle-thing', pcpu: 0 },
];

test('host pressure reads idle from two cpu tick samples and ranks foreign processes only', async () => {
  let reads = 0;
  const sample = await samplePressure({
    ownPid: 1000,
    readCpus: () => (reads++ === 0 ? cpuTicks(1000, 200) : cpuTicks(1850, 350)),
    readProcesses: () => rows,
    sleep: async (ms) => assert.equal(ms, PRESSURE_WINDOWS.idleMs),
  });
  assert.equal(sample.method, 'cpus+ps');
  assert.equal(sample.idlePercent, 85); // 850 idle of 1000 ticks
  // The tier's own tree (node and the two chromium processes under it) is not foreign.
  assert.deepEqual(
    sample.foreign.map((row) => row.comm),
    ['WindowServer', 'zoom.us'],
  );
  assert.equal(sample.windows.foreignMs, 60000, 'ps pcpu is a minute-scale average; recorded');
});

test('host pressure says unavailable instead of guessing when the host cannot be read', async () => {
  const sample = await samplePressure({
    readCpus: () => {
      throw Error('no cpus');
    },
    sleep: async () => {},
  });
  assert.equal(sample.method, 'unavailable');
  assert.equal(sample.idlePercent, null);
  assert.deepEqual(sample.foreign, []);
});
