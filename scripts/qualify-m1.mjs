import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { verifyM1 } from './verify-m1.mjs';
import { replayBundle } from './replay.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './build-fingerprint.mjs';
const execute = promisify(execFile),
  source = sourceIdentity(),
  identity = { build: appFingerprint(), runtime: process.version };
const node = await verifyM1();
const session = await createSession(node.configuration, identity);
let bundle;
try {
  session.act({ type: 'impulse', body: 0, value: [2 * Math.sqrt(Number.MAX_VALUE), 0, 0] });
  try {
    session.step(1);
  } catch {}
  bundle = session.failureBundle();
  if (!bundle) throw Error('failure witness did not fail');
} finally {
  session.dispose();
}
const replay = await replayBundle(bundle, {
  expectedBuild: identity.build,
  expectedRuntime: identity.runtime,
});
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/test/browser/`,
  browser = [];
try {
  for (let i = 0; i < 2; i++) {
    const { stdout } = await execute(process.execPath, ['scripts/verify-browser.mjs', url], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    browser.push(JSON.parse(stdout.trim()));
  }
} finally {
  await server.close();
}
if (browser[0].digest !== browser[1].digest) throw Error('browser process determinism mismatch');
if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest)
  throw Error('source changed during qualification');
mkdirSync('artifacts/m1', { recursive: true });
writeFileSync('artifacts/m1/failure.json', JSON.stringify(bundle, null, 2) + '\n');
writeFileSync(
  'artifacts/m1/qualification.json',
  JSON.stringify({ source, identity, node, browser, replay }, null, 2) + '\n',
);
console.log(
  `M1 verified: four Node processes, two browser processes, replay at tick ${replay.failedTick}`,
);
