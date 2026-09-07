import { build, preview, createServer } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sourceIdentity } from './source-identity.mjs';
import { appFingerprint } from './app-fingerprint.mjs';
import { selectChecks, validateBrowserCoverage } from './browser-registry.mjs';
import { runProcess } from './run-check.mjs';
import { checkBreadth } from './check-breadth.mjs';
import {
  createVerificationContext,
  initializeVerificationEnvironment,
} from './verification-run.mjs';
import { runCheckSequence } from './check-sequence.mjs';
const stamp = 'dist/.verification-source.json';
export async function prepareBrowserBuild(context) {
  initializeVerificationEnvironment();
  if (context)
    return context.check('build:browser', { mode: 'production' }, () => prepareBrowserBuild());
  const source = sourceIdentity();
  checkBreadth();
  validateBrowserCoverage();
  await build({ logLevel: 'error' });
  if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest)
    throw Error('source changed during build');
  const identity = { source, app: appFingerprint() };
  writeFileSync(stamp, JSON.stringify(identity));
  return identity;
}
export async function verifyBrowserSuite(
  mode = 'all',
  { reuseBuild = false, context = createVerificationContext() } = {},
) {
  const checks = selectChecks(mode),
    source = sourceIdentity(),
    identity =
      reuseBuild && existsSync(stamp)
        ? JSON.parse(readFileSync(stamp))
        : await prepareBrowserBuild(context);
  if (
    identity.source.workingTreeDigest !== source.workingTreeDigest ||
    identity.app !== appFingerprint()
  )
    throw Error('browser build does not match current source');
  const server = await preview({ preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  let probe;
  let failure;
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`,
    runs = [];
  mkdirSync('artifacts/browser-suite', { recursive: true });
  try {
    const outcomes = await runCheckSequence(
      checks,
      async (check) => {
        let target = url;
        if (check.environment === 'probe') {
          probe ??= await createServer({
            server: { host: '127.0.0.1', port: 0 },
            logLevel: 'error',
          });
          if (!probe.httpServer.listening) await probe.listen();
          target = `http://127.0.0.1:${probe.httpServer.address().port}/test/browser/`;
        }
        console.log(`RUN ${check.id}`);
        try {
          const result = await context.check(
            `browser:${check.id}`,
            {
              script: check.script,
              timeoutMs: check.timeoutMs,
              environment: check.environment ?? 'workshop',
            },
            () =>
              runProcess(process.execPath, [check.script, target], { timeoutMs: check.timeoutMs }),
          );
          runs.push({ id: check.id, ok: true, elapsedMs: result.elapsedMs });
          writeFileSync(`artifacts/browser-suite/${check.id}.log`, result.output);
          console.log(`PASS ${check.id} ${Math.round(result.elapsedMs)}ms`);
        } catch (error) {
          runs.push({ id: check.id, ok: false, elapsedMs: error.elapsedMs });
          writeFileSync(`artifacts/browser-suite/${check.id}.log`, error.output ?? error.message);
          console.log(`FAIL ${check.id}: ${error.summary ?? error.message}`);
          throw error;
        } finally {
          if (check.environment === 'probe') {
            await probe?.close();
            probe = undefined;
          }
        }
      },
      () => {
        if (sourceIdentity().workingTreeDigest !== source.workingTreeDigest)
          throw Error('source changed during browser verification');
      },
    );
    const failures = outcomes.filter((outcome) => !outcome.ok);
    if (failures.length)
      throw new AggregateError(
        failures.map((outcome) => outcome.error),
        `Browser checks failed: ${failures.map((outcome) => outcome.id).join(', ')}`,
      );
  } catch (error) {
    failure = error.message;
    throw error;
  } finally {
    await probe?.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
    writeFileSync(
      `artifacts/browser-suite/${mode}.json`,
      JSON.stringify({ source, build: identity.app, mode, ok: !failure, failure, runs }, null, 2),
    );
  }
  return runs;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await verifyBrowserSuite(process.argv[2] ?? 'all', {
    reuseBuild: process.argv.includes('--reuse-build'),
  });
