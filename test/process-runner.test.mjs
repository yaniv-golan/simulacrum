import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  selectSampleTargets,
  readMemoryCounters,
  sampleProcess,
} from '../scripts/process-inventory.mjs';
import { runProcess } from '../scripts/run-check.mjs';
test('process runner captures output and kills descendants on timeout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'process-runner-')),
    marker = join(root, 'child');
  try {
    const ok = await runProcess(process.execPath, ['-e', 'console.log("positive")'], {
      timeoutMs: 3000,
    });
    assert.equal(ok.stdout.trim(), 'positive');
    const worker = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad'),600)`;
    const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(worker)}],{stdio:'ignore'});while(true){}`;
    await assert.rejects(
      runProcess(process.execPath, ['-e', source], { timeoutMs: 200 }),
      /timed out/,
    );
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(existsSync(marker), false);
    await assert.rejects(
      runProcess(process.execPath, ['-e', 'console.error("specific failure");process.exit(2)'], {
        timeoutMs: 3000,
      }),
      /specific failure/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('nested shared runners terminate their owned workers when process enumeration is unavailable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nested-process-runner-')),
    marker = join(root, 'late-worker');
  const savedPath = process.env.PATH;
  try {
    // Force the optional ps path to fail even on unrestricted hosts. Worker
    // launches use an absolute Node path and therefore remain a positive control.
    process.env.PATH = root;
    const worker = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'late'),600)`;
    const runnerURL = new URL('../scripts/run-check.mjs', import.meta.url).href;
    const nested = `import {runProcess} from ${JSON.stringify(runnerURL)};await runProcess(process.execPath,['-e',${JSON.stringify(worker)}],{timeoutMs:3000});`;
    await assert.rejects(
      runProcess(process.execPath, ['--input-type=module', '-e', nested], { timeoutMs: 200 }),
      /timed out/,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(existsSync(marker), false, 'outer deadline must terminate nested detached worker');
    const innerDeadline = nested.replace('timeoutMs:3000', 'timeoutMs:150');
    await assert.rejects(
      runProcess(process.execPath, ['--input-type=module', '-e', innerDeadline], {
        timeoutMs: 2000,
      }),
      /timed out after 150 ms/,
    );
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(existsSync(marker), false, 'inner deadline must terminate the owned check group');
    const positive = await runProcess(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {runProcess} from ${JSON.stringify(runnerURL)};const r=await runProcess(process.execPath,['-e','console.log("nested success")'],{timeoutMs:1000});console.log(r.stdout.trim());`,
      ],
      { timeoutMs: 2000 },
    );
    assert.equal(positive.stdout.trim(), 'nested success');
  } finally {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test('termination covers the native spawn-to-registration gap and leaves no live worker', async () => {
  const root = mkdtempSync(join(tmpdir(), 'runner-spawn-gap-'));
  const pidFile = join(root, 'worker.pid');
  let pid;
  try {
    const runnerURL = new URL('../scripts/run-check.mjs', import.meta.url).href;
    // Widen the synchronous native-spawn scheduling window without replacing
    // the production runner. The outer runner retains its real deadline.
    const worker = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>{},5000)`;
    const nested = `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {existsSync} from 'node:fs';const spawn=cp.spawn;cp.spawn=function(...args){const child=spawn(...args);const end=performance.now()+1500;while(!existsSync(${JSON.stringify(pidFile)})&&performance.now()<end){}if(!existsSync(${JSON.stringify(pidFile)}))throw new Error('worker did not start');process.kill(process.pid,'SIGTERM');return child;};syncBuiltinESMExports();process.env.PATH=${JSON.stringify(root)};const {runProcess}=await import(${JSON.stringify(runnerURL)});await runProcess(process.execPath,['-e',${JSON.stringify(worker)}],{timeoutMs:3000});`;
    const saved = process.env.PATH;
    try {
      process.env.PATH = root;
      await assert.rejects(
        runProcess(process.execPath, ['--input-type=module', '-e', nested], { timeoutMs: 3000 }),
        /check exited/,
      );
    } finally {
      if (saved === undefined) delete process.env.PATH;
      else process.env.PATH = saved;
    }
    assert.ok(existsSync(pidFile), 'worker must start to exercise the registration race');
    pid = Number(readFileSync(pidFile, 'utf8'));
    assert.throws(
      () => process.kill(pid, 0),
      { code: 'ESRCH' },
      'worker remains alive after terminated owner returned',
    );
  } finally {
    if (pid)
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

test('synchronous spawn rejection does not retain termination listeners', async () => {
  const before = process.listenerCount('SIGTERM');
  await assert.rejects(runProcess(null, [], { timeoutMs: 1000 }), /file|command|argument/i);
  assert.equal(process.listenerCount('SIGTERM'), before);
  const result = await runProcess(process.execPath, ['-e', 'console.log("after rejection")'], {
    timeoutMs: 3000,
  });
  assert.equal(result.stdout.trim(), 'after rejection');
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('watchdog and nonzero exit retain different failure kinds', async () => {
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'while(true){}'], { timeoutMs: 100 }),
    (e) => e.failureKind === 'watchdog',
  );
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.exit(1)'], { timeoutMs: 1000 }),
    (e) => e.failureKind === 'check-failure',
  );
});

test('process diagnostics distinguish exit, close and watchdog signal outcomes', async () => {
  const ok = await runProcess(process.execPath, ['-e', 'process.exit(0)'], { timeoutMs: 1000 });
  const names = ok.processDiagnostics.events.map((event) => event.type);
  assert.ok(names.indexOf('spawn-return') < names.indexOf('exit'));
  assert.ok(names.indexOf('exit') < names.indexOf('close'));
  assert.equal(names.at(-1), 'settlement');
  assert.equal(names.includes('watchdog-fired'), false);
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'while(true){}'], { timeoutMs: 100 }),
    (error) => {
      const events = error.processDiagnostics.events;
      const fired = events.find((event) => event.type === 'watchdog-fired');
      // dueMs is stamped from performance.now() when the timer is armed, but setTimeout fires
      // off libuv's millisecond loop clock, so the callback can observe a fraction of a
      // millisecond less than dueMs (more under load). The sleep signature cares about
      // seconds, not this skew.
      assert.ok(fired.elapsedMs >= fired.dueMs - 2, `${fired.elapsedMs} vs due ${fired.dueMs}`);
      assert.equal(error.failureKind, 'watchdog');
      if (process.platform !== 'win32') {
        assert.ok(
          events.some(
            (event) =>
              event.type === 'signal' &&
              event.signal === 'SIGTERM' &&
              event.target === -error.processDiagnostics.pid,
          ),
        );
        assert.ok(events.some((event) => event.type === 'escalation-fired'));
        assert.ok(
          events.some(
            (event) => event.type === 'enumeration-finished' || event.type === 'enumeration-error',
          ),
        );
      }
      assert.equal(events.at(-1).type, 'settlement');
      assert.ok(
        events.every(
          (event, index) => index === 0 || event.elapsedMs >= events[index - 1].elapsedMs,
        ),
      );
      return true;
    },
  );
});

const SNAPSHOT_ROW_KEYS = [
  'comm',
  'etime',
  'pcpu',
  'pid',
  'ppid',
  'rssKb',
  'stat',
  'time',
  'wchan',
];
test('watchdog records a bounded process snapshot with the child in its tree', async (t) => {
  const error = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 10)'], {
    timeoutMs: 300,
  }).catch((e) => e);
  assert.equal(error.failureKind, 'watchdog');
  const { snapshot, pid, events } = error.processDiagnostics;
  if (process.platform === 'win32') {
    assert.deepEqual(snapshot, { at: 'watchdog', unsupported: 'win32' });
    return;
  }
  assert.equal(snapshot.at, 'watchdog');
  assert.equal(snapshot.loadAverage.length, 3);
  assert.ok(
    snapshot.snapshotMs >= 0 && snapshot.snapshotMs < 1000,
    `snapshotMs ${snapshot.snapshotMs}`,
  );
  assert.ok(snapshot.topCpu.length <= 8 && snapshot.topRss.length <= 8);
  assert.ok(snapshot.watch.length <= 32 && snapshot.tree.length <= 32, 'lists are bounded');
  assert.ok(snapshot.enumerationMs >= 0 && snapshot.enumerationMs < 1000, 'ps cost is measured');
  assert.ok(
    snapshot.tree.some((row) => row.pid === pid),
    'child appears in its own tree',
  );
  if (process.platform === 'darwin') {
    // H1 signal: the stalled executable's quarantine/provenance attributes (a hypothesis
    // input, not attribution). The child here is the node binary itself.
    assert.equal(snapshot.firstExecHint.path, process.execPath);
    assert.equal(typeof snapshot.firstExecHint.quarantined, 'boolean');
    assert.equal(typeof snapshot.firstExecHint.provenance, 'boolean');
    assert.ok(snapshot.hintMs >= 0 && snapshot.hintMs < 1000, 'xattr cost is measured');
  }
  for (const row of [...snapshot.topCpu, ...snapshot.topRss, ...snapshot.tree, ...snapshot.watch])
    assert.deepEqual(Object.keys(row).sort(), SNAPSHOT_ROW_KEYS);
  assert.ok(Array.isArray(snapshot.watch));
  // Blocked-syscall evidence: memory counters at start and at the watchdog, and a bounded
  // stack sample of every descendant in uninterruptible wait (none for a sleeping child).
  // A 300 ms row is too short to stall, so it records no start counters; the snapshot
  // always reads them so a real stall's page-in is a delta against memoryAtStart.
  assert.equal(error.processDiagnostics.memoryAtStart.unsupported, 'short row');
  const memory = snapshot.memory;
  if (['darwin', 'linux'].includes(process.platform)) {
    assert.equal(memory.unsupported, undefined, `memory counters read (${memory.unsupported})`);
    for (const key of ['pageins', 'pageouts', 'free'])
      assert.ok(Number.isInteger(memory[key]) && memory[key] >= 0, `${key} ${memory[key]}`);
    assert.ok(['pages', 'kB'].includes(memory.unit));
  }
  assert.ok(snapshot.memoryMs >= 0 && snapshot.memoryMs < 1000, 'counter cost is measured');
  assert.deepEqual(snapshot.samples, [], 'a sleeping child is never sampled');
  assert.ok(snapshot.sampleMs >= 0 && snapshot.sampleMs < 1000, 'sampling cost is measured');
  assert.ok(
    events.findIndex((e) => e.type === 'snapshot') <
      events.findIndex((e) => e.type === 'settlement'),
    'snapshot is observed before settlement',
  );
  assert.equal(events.at(-1).type, 'settlement');
  t.diagnostic(
    `enumerationMs ${snapshot.enumerationMs.toFixed(1)} snapshotMs ${snapshot.snapshotMs.toFixed(1)} hintMs ${(snapshot.hintMs ?? 0).toFixed(1)} tree ${snapshot.tree.length} watch ${snapshot.watch.length}`,
  );
});

test('a non-zero exit records a post-hoc snapshot without a tree; success records none', async () => {
  const exit = await runProcess(process.execPath, ['-e', 'process.exit(3)'], {
    timeoutMs: 5000,
  }).catch((e) => e);
  assert.equal(exit.failureKind, 'check-failure');
  if (process.platform !== 'win32') {
    assert.equal(exit.processDiagnostics.snapshot.at, 'exit');
    assert.deepEqual(exit.processDiagnostics.snapshot.tree, []);
    assert.equal(exit.processDiagnostics.snapshot.firstExecHint, undefined);
    assert.ok(exit.processDiagnostics.snapshot.enumerationMs > 0, 'the exit path pays its own ps');
    assert.ok(
      exit.elapsedMs < exit.processDiagnostics.events.at(-1).elapsedMs,
      'elapsed excludes the snapshot',
    );
    assert.equal(exit.processDiagnostics.events.at(-1).type, 'settlement');
  }
  const ok = await runProcess(process.execPath, ['-e', '0'], { timeoutMs: 5000 });
  assert.equal(ok.processDiagnostics.snapshot, undefined);
});

test('an unavailable ps records snapshotError and leaves the failure outcome unchanged', async () => {
  if (process.platform === 'win32') return;
  const savedPath = process.env.PATH;
  const empty = mkdtempSync(join(tmpdir(), 'no-ps-'));
  process.env.PATH = empty;
  try {
    const error = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 10)'], {
      timeoutMs: 300,
    }).catch((e) => e);
    assert.equal(error.failureKind, 'watchdog');
    assert.match(error.summary, /timed out after 300 ms/);
    assert.equal(error.processDiagnostics.snapshot.at, 'watchdog');
    assert.ok(
      error.processDiagnostics.snapshot.snapshotError,
      'ps failure is recorded, not thrown',
    );
    const exit = await runProcess(process.execPath, ['-e', 'process.exit(2)'], {
      timeoutMs: 5000,
    }).catch((e) => e);
    assert.equal(exit.failureKind, 'check-failure');
    assert.ok(exit.processDiagnostics.snapshot.snapshotError);
  } finally {
    process.env.PATH = savedPath;
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a host sleep during a check is named as such, not reported as a timeout or a failure', async () => {
  // A wall clock that jumps 15 minutes between two heartbeats: the host slept. Every platform
  // sees this (Date.now counts sleep; the monotonic clock may or may not).
  const sleepingClock = (jumpAfterBeats, jumpMs) => {
    let beats = 0,
      base = Date.now();
    return () => (++beats === jumpAfterBeats ? (base += jumpMs) : base);
  };
  // The child dies on its own after the "sleep" (exit 3): failure branch → host-slept.
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'setTimeout(()=>process.exit(3),150)'], {
      timeoutMs: 3000,
      heartbeatMs: 20,
      sleepGapMs: 60_000,
      wallClock: sleepingClock(2, 900_000),
    }),
    (error) => {
      assert.equal(error.failureKind, 'host-slept');
      assert.equal(error.hostSleptMs, 900_000);
      assert.match(error.summary, /^host slept 900 s during the check \(exit 3\): not evaluated/);
      assert.ok(error.processDiagnostics.events.some((e) => e.type === 'host-slept'));
      return true;
    },
  );
  // A watchdog that fires after a sleep is also the sleep's, not a hung check.
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'while(true){}'], {
      timeoutMs: 150,
      heartbeatMs: 20,
      sleepGapMs: 60_000,
      wallClock: sleepingClock(2, 900_000),
    }),
    (error) => {
      assert.equal(error.failureKind, 'host-slept');
      assert.match(error.summary, /host slept 900 s during the check \(watchdog after 150 ms\)/);
      return true;
    },
  );
  // A pass that spanned a sleep records it and stays a pass.
  const passed = await runProcess(process.execPath, ['-e', 'setTimeout(()=>0,150)'], {
    timeoutMs: 3000,
    heartbeatMs: 20,
    sleepGapMs: 60_000,
    wallClock: sleepingClock(2, 900_000),
  });
  assert.equal(passed.hostSleptMs, 900_000);
  assert.equal(passed.processDiagnostics.hostSleptMs, 900_000);
  // Control: ordinary timer lateness (a 2 s gap) is not a sleep; a timeout stays a timeout.
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'while(true){}'], {
      timeoutMs: 150,
      heartbeatMs: 20,
      sleepGapMs: 60_000,
      wallClock: sleepingClock(2, 2000),
    }),
    (error) => {
      assert.equal(error.failureKind, 'watchdog');
      assert.match(error.summary, /^timed out after 150 ms/);
      return true;
    },
  );
});

test('sample targets are the owned descendants blocked in uninterruptible wait, bounded to one', () => {
  const rows = [
    { pid: 1, ppid: 0, stat: 'Ss', comm: 'node' },
    { pid: 2, ppid: 1, stat: 'S+', comm: 'workerd' },
    { pid: 3, ppid: 1, stat: 'U', comm: 'esbuild' },
    { pid: 4, ppid: 1, stat: 'D+', comm: 'child' },
    { pid: 9, ppid: 0, stat: 'U', comm: 'ls' },
  ];
  assert.deepEqual(
    selectSampleTargets(rows, 1).map((row) => row.pid),
    [3],
    'only the tree, only an uninterruptible state, never a foreign process, one target',
  );
  assert.deepEqual(
    selectSampleTargets(
      rows.filter((row) => row.pid !== 3),
      1,
    ).map((row) => row.pid),
    [4],
    'Linux spells the state D',
  );
  assert.deepEqual(selectSampleTargets(rows, 2), []);
  const memory = readMemoryCounters();
  if (['darwin', 'linux'].includes(process.platform)) {
    assert.equal(memory.unsupported, undefined, String(memory.unsupported));
    assert.ok(memory.pageins >= 0 && memory.pageouts >= 0 && memory.free >= 0);
  } else assert.equal(typeof memory.unsupported, 'string');
});

test('a stack sample names the sampled process by its leaf frames and records a dead pid as an error', (t) => {
  if (process.platform !== 'darwin') {
    assert.equal(sampleProcess(process.pid).unsupported, process.platform);
    return;
  }
  const started = performance.now();
  const own = sampleProcess(process.pid, { durationSeconds: 1 });
  const elapsed = performance.now() - started;
  t.diagnostic(`sample of own pid took ${elapsed.toFixed(0)} ms`);
  assert.equal(own.pid, process.pid);
  assert.equal(own.error, undefined, String(own.error));
  assert.ok(own.topOfStack.length >= 1 && own.topOfStack.length <= 16, 'bounded leaf frames');
  assert.ok(own.callGraph.length <= 8);
  assert.ok(
    own.topOfStack.some((line) => /\(in libsystem_kernel\.dylib\)|\(in /.test(line)),
    own.topOfStack.join('\n'),
  );
  assert.ok(elapsed < 3500, 'sampling is bounded');
  const dead = sampleProcess(2 ** 22 - 7);
  assert.ok(typeof dead.error === 'string' && dead.error.length, 'a missing pid is an error');
});
