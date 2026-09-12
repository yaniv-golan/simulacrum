import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir, loadavg } from 'node:os';
import { join, resolve, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runProcess } from './run-check.mjs';
import { assertRuntime } from './runtime-preflight.mjs';

const defaultDirectory = () =>
  join(tmpdir(), `simulacrum-verification-${process.getuid?.() ?? 'user'}`);
const ownerFile = (directory) => join(directory, 'owner.json');
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
function readOwner(directory) {
  try {
    return JSON.parse(readFileSync(ownerFile(directory), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
function removeOwned(directory, token) {
  const owner = readOwner(directory);
  if (owner?.token !== token) throw Error('verification window owner changed; refusing removal');
  // No other contender removes a live lease. Rename fences cleanup from the next owner.
  const retired = `${directory}.released-${token}`;
  renameSync(directory, retired);
  rmSync(retired, { recursive: true });
}
export function recoverVerificationWindow({
  directory = defaultDirectory(),
  token,
  processTreeStopped = false,
}) {
  if (!processTreeStopped)
    throw Error('confirm the abandoned process tree has stopped before recovery');
  const owner = readOwner(directory);
  if (!owner || owner.token !== token) throw Error('verification window owner mismatch');
  if (alive(owner.pid)) throw Error('owner PID is live (possibly reused); recovery refused');
  removeOwned(directory, token);
}
export function verificationWaitOptions(script) {
  return {
    waitMs: /^(verify-(local|merge|final)|native-qualification)\.mjs$/.test(basename(script))
      ? 1800000
      : 300000,
  };
}
/** Cooperative host-wide window; never treats elapsed time as proof an owner stopped. */
export async function withVerificationWindow(
  execute,
  {
    directory = defaultDirectory(),
    waitMs = 1800000,
    pollMs = 100,
    inherit = true,
    onWait = () => {},
  } = {},
) {
  if (!Number.isFinite(waitMs) || waitMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0)
    throw Error('positive window deadlines required');
  const started = performance.now(),
    contenders = new Map();
  const inherited = inherit && process.env.SIMULACRUM_VERIFICATION_WINDOW;
  if (inherited) {
    const claim = JSON.parse(inherited),
      owner = readOwner(directory);
    if (claim.directory === directory) {
      if (!owner || owner.token !== claim.token || owner.pid !== claim.pid || !alive(owner.pid))
        throw Error('inherited verification window is stale');
      return {
        value: await execute(),
        queueMs: 0,
        runMs: performance.now() - started,
        inherited: true,
        contenders: [],
      };
    }
  }
  const owner = {
    token: randomUUID(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
    directory,
    cwd: process.cwd(),
  };
  let nextNoticeMs = 0;
  while (true) {
    try {
      mkdirSync(directory, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const current = readOwner(directory);
    if (current) {
      contenders.set(current.token, {
        pid: current.pid,
        startedAt: current.startedAt,
        cwd: current.cwd,
      });
      if (!alive(current.pid))
        throw Error(
          `abandoned verification window needs explicit recovery: ${directory} owner ${current.token}; establish process-tree quiescence first`,
        );
    }
    if (performance.now() - started >= waitMs)
      throw Error(
        `verification window wait exceeded ${waitMs}ms; owner ${current?.token ?? 'unpublished (inspect before recovery)'}`,
      );
    const elapsedMs = performance.now() - started;
    if (elapsedMs >= nextNoticeMs) {
      onWait({ waitMs, elapsedMs, owner: current });
      nextNoticeMs = elapsedMs + 30000;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const pendingOwner = join(directory, `owner-${owner.token}.tmp`);
  writeFileSync(pendingOwner, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
  renameSync(pendingOwner, ownerFile(directory));
  const queueMs = performance.now() - started,
    runStart = performance.now();
  const previous = process.env.SIMULACRUM_VERIFICATION_WINDOW;
  if (inherit)
    process.env.SIMULACRUM_VERIFICATION_WINDOW = JSON.stringify({
      directory,
      token: owner.token,
      pid: owner.pid,
    });
  try {
    return {
      value: await execute(),
      queueMs,
      runMs: performance.now() - runStart,
      contenders: [...contenders.values()],
      inherited: false,
    };
  } catch (error) {
    error.verificationWindow = {
      queueMs,
      runMs: performance.now() - runStart,
      contenders: [...contenders.values()],
    };
    throw error;
  } finally {
    if (inherit) {
      if (previous === undefined) delete process.env.SIMULACRUM_VERIFICATION_WINDOW;
      else process.env.SIMULACRUM_VERIFICATION_WINDOW = previous;
    }
    removeOwned(directory, owner.token);
  }
}
export function checkVerificationConfiguration(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const command of [
    'ci',
    'verify:local',
    'verify:final',
    'test:unit',
    'test:browser',
    'test:performance',
    'build',
  ]) {
    if (!pkg.scripts[command]?.startsWith('node scripts/verification-window.mjs '))
      throw Error(`${command} bypasses the verification window`);
  }
  return { ok: true };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href
) {
  if (process.argv[2] === 'recover') {
    if (process.argv.length !== 5 || process.argv[4] !== '--process-tree-stopped')
      throw Error('Usage: verification-window.mjs recover <owner-token> --process-tree-stopped');
    assertRuntime();
    recoverVerificationWindow({ token: process.argv[3], processTreeStopped: true });
  } else {
    const [script, ...args] = process.argv.slice(2);
    if (!script) throw Error('verification script required');
    const report = {
      status: 'running',
      script: basename(script),
      startedAt: new Date().toISOString(),
      hostLoadAtStart: loadavg(),
    };
    const summary = args.some((a) => ['--summary', '--explain'].includes(a));
    const tier = /^verify-(local|final)\.mjs$/.exec(basename(script))?.[1];
    const canonical =
      !summary &&
      (tier
        ? `artifacts/verification-${tier}.json`
        : basename(script) === 'verify-browser-suite.mjs'
          ? 'artifacts/browser-suite/last-run.json'
          : null);
    const admission = (status, failure) => {
      if (!canonical) return;
      mkdirSync(dirname(canonical), { recursive: true });
      writeFileSync(
        canonical,
        JSON.stringify(
          {
            status,
            phase: 'admission',
            failure,
            outcome: {
              automation: { status: 'FAIL' },
              humanAcceptance: { status: 'NOT_EVALUATED' },
              qualification: { status: 'NOT_EVALUATED' },
              exitCode: 1,
            },
          },
          null,
          2,
        ) + '\n',
      );
    };
    const directory = 'artifacts/verification-windows';
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${process.pid}-${Date.now()}.json`);
    writeFileSync(file, JSON.stringify(report));
    let childStarted = false;
    try {
      admission('running');
      assertRuntime();
      const run = () => {
        childStarted = true;
        return runProcess(process.execPath, [script, ...args], {
          timeoutMs: 3600000,
          inheritOutput: true,
        });
      };
      const result = args.some((a) => ['--summary', '--explain'].includes(a))
        ? { value: await run(), queueMs: 0, runMs: 0, contenders: [], inherited: false }
        : await withVerificationWindow(run, {
            ...verificationWaitOptions(script),
            onWait: ({ elapsedMs, waitMs, owner }) =>
              console.error(
                `Waiting for verification window (${Math.round(elapsedMs / 1000)}s of ${waitMs / 1000}s limit; owner PID ${owner?.pid ?? 'unpublished'}). Cancel to return to editing.`,
              ),
          });
      Object.assign(report, {
        status: 'passed',
        queueMs: result.queueMs,
        runMs: result.runMs,
        contenders: result.contenders,
        inherited: result.inherited,
      });
    } catch (error) {
      if (!childStarted) admission('failed', error.message);
      Object.assign(report, {
        status: 'failed',
        error: error.message,
        ...error.verificationWindow,
      });
      process.exitCode = Number.isInteger(error.code) && error.code > 0 ? error.code : 1;
      console.error(error.output ?? error.message);
    } finally {
      report.hostLoadAtEnd = loadavg();
      writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    }
  }
}
