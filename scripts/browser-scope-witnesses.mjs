import { mkdirSync, writeFileSync } from 'node:fs';
import { candidateIdentity } from './candidate.mjs';
import { readManifest } from './validate-manifest.mjs';
import { createVerificationContext } from './verification-run.mjs';
import { checkInvariantControls } from './check-invariant-controls.mjs';
import { verifyBrowserSuite } from './verify-browser-suite.mjs';
const manifest = readManifest(),
  context = createVerificationContext();
const requested = JSON.parse(process.argv[2]);
const spec = requested.scopes;
const report = {
  ok: false,
  ...context.identity,
  requested,
  candidateIdentity: candidateIdentity(process.cwd()),
};
try {
  if (
    !requested.proposalDigest ||
    !Array.isArray(spec) ||
    !spec.length ||
    spec.some(
      (r) =>
        !['local', 'metadata'].includes(r.kind) ||
        !Array.isArray(r.witnesses) ||
        !r.witnesses.length,
    )
  )
    throw Error('Invalid scope witness request');
  const metadata = [
    ...new Set(spec.filter((r) => r.kind === 'metadata').flatMap((r) => r.witnesses)),
  ];
  const browser = [...new Set(spec.filter((r) => r.kind === 'local').flatMap((r) => r.witnesses))];
  for (const id of metadata) {
    const row = manifest.checks.find((c) => c.id === id);
    if (!row) throw Error(`Unknown metadata witness ${id}`);
    if (
      row.module === 'scripts/check-invariant-controls.mjs' &&
      row.export === 'checkInvariantControls'
    )
      await context.check(`scope:${id}`, { row }, () =>
        checkInvariantControls(process.cwd(), { executeTests: (files) => context.unit(files) }),
      );
    else
      await context.module(
        `scope:${id}`,
        row.module,
        row.export,
        row.args ?? [],
        row.timeoutMs ?? 30000,
      );
  }
  if (browser.length) await verifyBrowserSuite(browser, { context });
  report.ok = true;
} catch (error) {
  report.failure = error.message;
  throw error;
} finally {
  report.checks = context.receipts();
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/scope-witness-result.json', JSON.stringify(report, null, 2) + '\n');
}
