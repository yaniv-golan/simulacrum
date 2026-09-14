import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { getPriority } from 'node:os';
import { spawn } from 'node:child_process';
const engines = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).engines;

/** A tier that derives its workers from the host must run at the host's ordinary priority: a
 * niced launch (zsh's bgnice on any `&` job, `nice`, or an already-niced parent) loses to every
 * other process regardless of idle cores and reports that as check failures. Refuse with the
 * fix text; the value is recorded so a report can name it. */
export function assertUnnicedLaunch({ priority = getPriority() } = {}) {
  if (!(Number.isFinite(priority) && priority <= 0))
    throw Error(
      `This tier was launched at nice ${priority}; a niced tier loses to every other process regardless of idle cores. ` +
        'Relaunch un-niced: zsh -c "unsetopt bgnice; nohup caffeinate -dis npm run … &" — a child cannot ' +
        'lower an inherited nice, so an already-niced parent shell or tool must itself be relaunched.',
    );
  return priority;
}

/** Keep the host awake for the life of this tier. `caffeinate -i` alone did not hold a Mac
 * whose display had gone to sleep (the assertion registered on a dark wake); `-dis` holds the
 * display, idle and system-on-AC assertions, and `-w <pid>` releases them with the tier. The
 * tier asserts this itself so the launch recipe cannot be forgotten; elsewhere it is recorded
 * as unavailable, never fatal. */
export function assertAwake({
  pid = process.pid,
  platform = process.platform,
  launch = (command, args) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.once('error', () => {}); // a missing binary is recorded below, never an uncaught exception
    child.unref();
  },
} = {}) {
  if (platform !== 'darwin') return { method: 'unavailable', platform };
  try {
    launch('caffeinate', ['-dis', '-w', String(pid)]);
    return { method: 'caffeinate -dis -w', pid };
  } catch (error) {
    return { method: 'unavailable', platform, error: error.message };
  }
}

/** The package owns the range. Accept comparator intersections; fail closed on new syntax. */
export function assertRuntime({ version = process.versions.node, range = engines.node } = {}) {
  const clauses = typeof range === 'string' ? range.trim().split(/\s+/) : [];
  if (!clauses.length || clauses.some((c) => !/^(>=|>|<=|<|=)\d+(?:\.\d+){0,2}$/.test(c)))
    throw Error(`Unsupported engine range in package.json: ${range}`);
  const valid =
    /^\d+\.\d+\.\d+$/.test(version) &&
    clauses.every((clause) => {
      const [, operator, target] = clause.match(/^(>=|>|<=|<|=)(.*)$/);
      const actual = version.split('.').map(Number),
        expected = target.split('.').map(Number);
      const comparison = actual.reduce(
        (result, n, i) => result || Math.sign(n - (expected[i] ?? 0)),
        0,
      );
      return {
        '>=': comparison >= 0,
        '>': comparison > 0,
        '<=': comparison <= 0,
        '<': comparison < 0,
        '=': comparison === 0,
      }[operator];
    });
  if (!valid)
    throw Error(
      `Unsupported Node ${version}; package.json requires ${range}. Switch Node from the repository root with nvm install && nvm use; verify node --version, then rerun the command. No checks were started.`,
    );
}

/** Probe only loopback, with an ephemeral port; never request broader network access. */
export function assertLocalServerAccess({ create = createServer } = {}) {
  return new Promise((resolve, reject) => {
    const server = create();
    server.once('error', (error) => {
      const permission = ['EPERM', 'EACCES'].includes(error.code);
      reject(
        new Error(
          permission
            ? `Environment: localhost server permission denied (${error.code}). Allow loopback server access in the execution environment and rerun. Browser and server checks have not run.`
            : `Environment: localhost preflight failed (${error.code}): ${error.message}`,
          { cause: error },
        ),
      );
    });
    server.listen({ host: '127.0.0.1', port: 0 }, () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
