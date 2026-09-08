import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
const engines = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).engines;

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
