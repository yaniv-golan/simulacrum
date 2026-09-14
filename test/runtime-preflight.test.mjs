import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRuntime, assertUnnicedLaunch, assertAwake } from '../scripts/runtime-preflight.mjs';
test('runtime admission uses the package range and rejects unsupported or ambiguous versions', () => {
  for (const version of ['24.18.0', '24.19.2'])
    assert.doesNotThrow(() => assertRuntime({ version }));
  for (const version of ['24.17.9', '25.0.0', '24.18.0-rc.1', 'invalid'])
    assert.throws(() => assertRuntime({ version }), /Unsupported Node.*package.json.*Switch/s);
  assert.doesNotThrow(() => assertRuntime({ version: '26.1.0', range: '>=26.1 <27' }));
  assert.throws(
    () => assertRuntime({ version: '24.18.0', range: '*' }),
    /Unsupported engine range/,
  );
});

test('localhost preflight labels permission failures without swallowing other failures and closes its probe', async () => {
  const { assertLocalServerAccess } = await import('../scripts/runtime-preflight.mjs');
  const { EventEmitter } = await import('node:events');
  for (const code of [null, 'EPERM', 'EACCES', 'EADDRNOTAVAIL']) {
    let closed = false;
    const server = Object.assign(new EventEmitter(), {
      listen(options, ready) {
        assert.equal(options.host, '127.0.0.1');
        assert.equal(options.port, 0);
        queueMicrotask(() =>
          code ? this.emit('error', Object.assign(Error('bind failed'), { code })) : ready(),
        );
      },
      close(done) {
        closed = true;
        done();
      },
    });
    const result = assertLocalServerAccess({ create: () => server });
    if (code)
      await assert.rejects(
        result,
        code === 'EPERM' || code === 'EACCES'
          ? /Environment.*localhost.*permission/s
          : /EADDRNOTAVAIL/,
      );
    else {
      await result;
      assert.ok(closed);
    }
  }
});

test('verification context rejects an unsupported runtime before identity reads or environment mutation', async () => {
  const { createVerificationContext } = await import('../scripts/verification-run.mjs');
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'node');
  const environment = process.env.NODE_ENV;
  let read = false;
  try {
    delete process.env.NODE_ENV;
    Object.defineProperty(process.versions, 'node', { value: '25.0.0', configurable: true });
    assert.throws(
      () =>
        createVerificationContext({
          readIdentity: () => {
            read = true;
            return {};
          },
        }),
      /Unsupported Node/,
    );
    assert.equal(read, false);
    assert.equal(process.env.NODE_ENV, undefined);
  } finally {
    Object.defineProperty(process.versions, 'node', descriptor);
    if (environment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = environment;
  }
});

test('conventional Node pin stays inside the package-owned runtime range', async () => {
  const { readFileSync } = await import('node:fs');
  const pin = readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim();
  assert.doesNotThrow(() => assertRuntime({ version: pin }));
});

test('runtime rejection gives the exact repository bootstrap without starting checks', () => {
  assert.throws(
    () => assertRuntime({ version: '25.0.0' }),
    /Node 25\.0\.0.*requires.*nvm install && nvm use.*No checks were started/s,
  );
});

test('a tier that derives its workers refuses a niced launch and names the fix', () => {
  assert.equal(assertUnnicedLaunch({ priority: 0 }), 0);
  assert.equal(assertUnnicedLaunch({ priority: -5 }), -5, 'raised priority is fine');
  // zsh's bgnice backgrounds a job at nice 5; the 1b tier on 421a2b1 failed exactly this way.
  assert.throws(() => assertUnnicedLaunch({ priority: 5 }), /nice 5.*unsetopt bgnice/s);
  assert.throws(() => assertUnnicedLaunch({ priority: NaN }), /unsetopt bgnice/);
});

test('the tier keeps the host awake with caffeinate -dis bound to its own pid on macOS only', () => {
  const launches = [];
  const launch = (command, args) => launches.push([command, args]);
  assert.deepEqual(assertAwake({ pid: 4242, platform: 'darwin', launch }), {
    method: 'caffeinate -dis -w',
    pid: 4242,
  });
  assert.deepEqual(launches, [['caffeinate', ['-dis', '-w', '4242']]]);
  // Elsewhere: recorded as unavailable, never a failure; nothing launched.
  assert.equal(assertAwake({ pid: 1, platform: 'linux', launch }).method, 'unavailable');
  assert.equal(launches.length, 1);
  // A missing caffeinate binary is recorded, not thrown.
  const missing = assertAwake({
    platform: 'darwin',
    launch: () => {
      throw Error('spawn caffeinate ENOENT');
    },
  });
  assert.equal(missing.method, 'unavailable');
  assert.match(missing.error, /ENOENT/);
});
