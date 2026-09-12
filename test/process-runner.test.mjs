import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
      assert.ok(fired.elapsedMs >= fired.dueMs);
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
