import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  withVerificationWindow,
  recoverVerificationWindow,
} from '../scripts/verification-window.mjs';

test('verification windows serialize contenders, retain timing and release after failure', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'verification-window-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'lock');
  let release,
    entered = false;
  const first = withVerificationWindow(() => new Promise((r) => (release = r)), {
    directory,
    waitMs: 1000,
    pollMs: 5,
    inherit: false,
  });
  while (!release) await new Promise((r) => setTimeout(r, 1));
  const second = withVerificationWindow(
    async () => {
      entered = true;
    },
    { directory, waitMs: 1000, pollMs: 5, inherit: false },
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(entered, false);
  release();
  await first;
  const result = await second;
  assert.equal(entered, true);
  assert.ok(result.queueMs >= 15);
  assert.equal(result.contenders.length, 1);
  await assert.rejects(
    withVerificationWindow(
      () => {
        throw Error('check failed');
      },
      { directory, inherit: false },
    ),
    /check failed/,
  );
  assert.equal((await withVerificationWindow(() => 42, { directory, inherit: false })).value, 42);
});
test('waiting is bounded; stale windows require explicit recovery and exact ownership', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'verification-window-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'lock');
  mkdirSync(directory);
  writeFileSync(
    join(directory, 'owner.json'),
    JSON.stringify({ token: 'dead', pid: 2147483647, startedAt: 'old' }),
  );
  await assert.rejects(
    withVerificationWindow(() => {}, { directory, waitMs: 15, pollMs: 5, inherit: false }),
    /recovery/,
  );
  assert.throws(
    () => recoverVerificationWindow({ directory, token: 'wrong', processTreeStopped: true }),
    /owner/,
  );
  assert.throws(
    () => recoverVerificationWindow({ directory, token: 'dead', processTreeStopped: false }),
    /process tree/,
  );
  recoverVerificationWindow({ directory, token: 'dead', processTreeStopped: true });
  assert.equal(
    (await withVerificationWindow(() => true, { directory, inherit: false })).value,
    true,
  );
});

test('supported commands enter the same host window, including CI, builds and focused browsers', async () => {
  const { readFileSync } = await import('node:fs');
  const p = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const command of [
    'ci',
    'verify:local',
    'verify:final',
    'test:unit',
    'test:browser',
    'test:performance',
    'build',
  ])
    assert.match(p.scripts[command], /^node scripts\/verification-window\.mjs /, command);
});

test('independent processes in different worktrees cannot overlap their verification windows', async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFileSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'window-processes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'a'));
  mkdirSync(join(root, 'b'));
  const script = join(root, 'probe.mjs'),
    events = join(root, 'events');
  writeFileSync(
    script,
    `import {withVerificationWindow} from ${JSON.stringify(new URL('../scripts/verification-window.mjs', import.meta.url).href)}; import{appendFileSync}from'node:fs'; await withVerificationWindow(async()=>{appendFileSync(process.argv[3],'start\\n');await new Promise(r=>setTimeout(r,30));appendFileSync(process.argv[3],'end\\n');},{directory:process.argv[2],inherit:false});`,
  );
  await Promise.all(
    ['a', 'b'].map((cwd) =>
      promisify(execFile)(process.execPath, [script, join(root, 'lock'), events], {
        cwd: join(root, cwd),
      }),
    ),
  );
  assert.deepEqual(readFileSync(events, 'utf8').trim().split('\n'), [
    'start',
    'end',
    'start',
    'end',
  ]);
});

test('unsupported runtime invalidates canonical completion evidence before child admission', async (t) => {
  const { copyFileSync, readFileSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const root = mkdtempSync(join(tmpdir(), 'window-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'artifacts'));
  for (const file of ['verification-window.mjs', 'run-check.mjs', 'runtime-preflight.mjs'])
    copyFileSync(new URL('../scripts/' + file, import.meta.url), join(root, 'scripts', file));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module', engines: { node: '>=999' } }),
  );
  for (const tier of ['local', 'final']) {
    const report = join(root, `artifacts/verification-${tier}.json`);
    writeFileSync(
      report,
      JSON.stringify({ status: 'passed', outcome: { automation: { status: 'PASS' } } }),
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ['scripts/verification-window.mjs', `scripts/verify-${tier}.mjs`],
          { cwd: root, stdio: 'pipe' },
        ),
      /failed/,
    );
    const result = JSON.parse(readFileSync(report));
    assert.equal(result.status, 'failed');
    assert.notEqual(result.outcome?.automation?.status, 'PASS');
    assert.match(result.failure, /Unsupported Node/);
  }
});
