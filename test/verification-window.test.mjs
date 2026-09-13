import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
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
  const notices = [];
  const second = withVerificationWindow(
    async () => {
      entered = true;
    },
    {
      directory,
      waitMs: 1000,
      pollMs: 5,
      inherit: false,
      onWait: (notice) => notices.push(notice),
    },
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(entered, false);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].waitMs, 1000);
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

test('completion waits longer than focused probes without bypassing serialization', async () => {
  const { verificationWaitOptions } = await import('../scripts/verification-window.mjs');
  for (const script of [
    'verify-local.mjs',
    'verify-merge.mjs',
    'verify-final.mjs',
    'native-qualification.mjs',
  ])
    assert.equal(verificationWaitOptions('scripts/' + script).waitMs, 1800000);
  for (const script of ['test-affected.mjs', 'build-app.mjs', 'verify-browser-suite.mjs', 'ci.mjs'])
    assert.equal(verificationWaitOptions('scripts/' + script).waitMs, 300000);
});

test('contenders wait through partial owner publication and reject malformed published metadata', async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const root = mkdtempSync(join(tmpdir(), 'window-publication-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'probe.mjs');
  writeFileSync(
    script,
    `
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
const { withVerificationWindow } = await import(${JSON.stringify(new URL('../scripts/verification-window.mjs', import.meta.url).href)});
const directory = join(process.argv[2], 'lock');
const originalWrite = fs.writeFileSync;
let intercepted = false, first, second, outcome, release, observedWait = false;
const events = [];
fs.writeFileSync = (file, data, options) => {
  let metadata;
  try { metadata = JSON.parse(data); } catch {}
  if (!intercepted && metadata?.directory === directory && metadata.pid === process.pid && typeof metadata.token === 'string') {
    intercepted = true;
    originalWrite(file, '', options);
    // A real contender observes publication after the destination exists but
    // before any metadata bytes are written. No filename or rename hook is used.
    second = withVerificationWindow(() => { events.push('second'); }, {
      directory, inherit: false, waitMs: 1000, pollMs: 5,
      onWait: () => { observedWait = true; },
    }).then(value => (outcome = { value }), error => (outcome = { error }));
    originalWrite(file, data, { ...options, flag: 'w' });
    return;
  }
  return originalWrite(file, data, options);
};
syncBuiltinESMExports();
try {
  first = withVerificationWindow(async () => {
    events.push('first:start');
    await new Promise(resolve => { release = resolve; });
    events.push('first:end');
  }, { directory, inherit: false });
  assert.equal(intercepted, true, 'metadata write must be interrupted');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(outcome?.error, undefined, 'a contender must not parse partial owner metadata');
  assert.equal(observedWait, true, 'contender must observe the unpublished owner and wait');
  assert.deepEqual(events, ['first:start']);
  release();
  await first;
  await second;
  assert.equal(outcome.error, undefined);
  assert.deepEqual(events, ['first:start', 'first:end', 'second']);
} finally {
  fs.writeFileSync = originalWrite;
  syncBuiltinESMExports();
  release?.();
  await Promise.allSettled([first, second].filter(Boolean));
}
// Invalid published authority remains an error, never an implicitly free lock.
fs.mkdirSync(directory);
fs.writeFileSync(join(directory, 'owner.json'), '{');
await assert.rejects(withVerificationWindow(() => assert.fail('must not enter'), {
  directory, inherit: false, waitMs: 30, pollMs: 5,
}), SyntaxError);
`,
  );
  await promisify(execFile)(process.execPath, [script, root], { timeout: 5000 });
});

test('window owners publish verification intent and contenders observe it', async (t) => {
  const { withVerificationWindow } = await import('../scripts/verification-window.mjs');
  const directory = join(mkdtempSync(join(tmpdir(), 'window-intent-')), 'window');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const intent = {
    script: 'verify-merge.mjs',
    tier: 'merge',
    base: 'b',
    incoming: 'i',
    destination: 'd',
    destinationName: 'int1',
    origin: '/worktrees/perf',
  };
  const seen = [];
  const owner = withVerificationWindow(
    async () => {
      await new Promise((r) => setTimeout(r, 300));
      return 'owner';
    },
    { directory, inherit: false, intent },
  );
  await new Promise((r) => setTimeout(r, 50));
  const contender = withVerificationWindow(async () => 'contender', {
    directory,
    inherit: false,
    pollMs: 20,
    onWait: ({ owner }) => seen.push(owner),
  });
  assert.equal((await owner).value, 'owner');
  const result = await contender;
  assert.equal(result.value, 'contender');
  assert.deepEqual(result.contenders[0].intent, intent);
  assert.ok(seen.some((o) => o?.intent?.destinationName === 'int1'));
});

test('malformed intent is rejected before any owner file is written, including inherited mode', async (t) => {
  const module = await import('../scripts/verification-window.mjs');
  assert.equal(typeof module.validateIntent, 'function');
  const directory = join(mkdtempSync(join(tmpdir(), 'window-intent-')), 'window');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  await assert.rejects(
    () =>
      module.withVerificationWindow(async () => 1, {
        directory,
        inherit: false,
        intent: { tier: 42 },
      }),
    /intent/,
  );
  assert.equal(existsSync(directory), false);
  assert.throws(() => module.validateIntent({ nope: 'x' }), /intent/);
  assert.throws(() => module.validateIntent({ tier: '' }), /intent/);
  assert.throws(() => module.validateIntent(['tier']), /intent/);
  assert.equal(module.validateIntent(undefined), undefined);
  assert.deepEqual(module.validateIntent({ tier: 'local' }), { tier: 'local' });
  // Inherited mode takes the early-return path; it must validate too.
  const previous = process.env.SIMULACRUM_VERIFICATION_WINDOW;
  process.env.SIMULACRUM_VERIFICATION_WINDOW = JSON.stringify({
    directory,
    token: 't',
    pid: process.pid,
  });
  t.after(() => {
    if (previous === undefined) delete process.env.SIMULACRUM_VERIFICATION_WINDOW;
    else process.env.SIMULACRUM_VERIFICATION_WINDOW = previous;
  });
  await assert.rejects(
    () => module.withVerificationWindow(async () => 1, { directory, intent: { tier: 42 } }),
    /intent/,
  );
  assert.equal(existsSync(directory), false);
});
