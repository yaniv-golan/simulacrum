import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
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
